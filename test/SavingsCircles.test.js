const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const C = ethers.parseEther("1");
const DAY = 24 * 60 * 60;
const Status = { Forming: 0n, Active: 1n, Completed: 2n, Cancelled: 3n };

describe("SavingsCircles", function () {
  async function setup(n = 3) {
    const signers = await ethers.getSigners();
    const creator = signers[0];
    const members = signers.slice(1, 1 + n);
    const sc = await ethers.deployContract("SavingsCircles");
    return { sc, creator, members, signers, outsider: signers[10] };
  }

  async function activeCircle(n = 3) {
    const ctx = await setup(n);
    const { sc, members } = ctx;
    await sc.createCircle("Market Women Chama", members.map((m) => m.address), C, 7 * DAY);
    for (const m of members) await sc.connect(m).join(0, "", { value: C });
    return ctx;
  }

  async function contractBalance(sc) {
    return ethers.provider.getBalance(await sc.getAddress());
  }

  async function totalOwed(sc, accounts) {
    let sum = 0n;
    for (const a of accounts) sum += await sc.withdrawable(a.address);
    return sum;
  }

  describe("creation", function () {
    it("validates parameters", async function () {
      const { sc, members } = await setup();
      const addrs = members.map((m) => m.address);
      await expect(sc.createCircle("", addrs, C, DAY)).to.be.revertedWithCustomError(sc, "InvalidName");
      await expect(sc.createCircle("x".repeat(65), addrs, C, DAY)).to.be.revertedWithCustomError(sc, "InvalidName");
      await expect(sc.createCircle("x", [addrs[0]], C, DAY)).to.be.revertedWithCustomError(sc, "InvalidMemberCount");
      await expect(sc.createCircle("x", addrs, 0, DAY)).to.be.revertedWithCustomError(sc, "InvalidContribution");
      await expect(sc.createCircle("x", addrs, C, 10)).to.be.revertedWithCustomError(sc, "InvalidDuration");
      await expect(sc.createCircle("x", [addrs[0], addrs[0]], C, DAY))
        .to.be.revertedWithCustomError(sc, "DuplicateMember").withArgs(addrs[0]);
      await expect(sc.createCircle("x", [addrs[0], ethers.ZeroAddress], C, DAY))
        .to.be.revertedWithCustomError(sc, "ZeroAddressMember");
      await expect(sc.createOpenCircle("x", 1, C, DAY)).to.be.revertedWithCustomError(sc, "InvalidMemberCount");
      await expect(sc.createOpenCircle("x", 51, C, DAY)).to.be.revertedWithCustomError(sc, "InvalidMemberCount");
    });

    it("starts only when every member has joined with the exact deposit", async function () {
      const { sc, members, outsider } = await setup();
      await expect(sc.createCircle("Chama", members.map((m) => m.address), C, DAY)).to.emit(sc, "CircleCreated");
      await expect(sc.connect(outsider).join(0, "", { value: C })).to.be.revertedWithCustomError(sc, "NotInvited");
      await expect(sc.connect(members[0]).join(0, "", { value: C - 1n })).to.be.revertedWithCustomError(sc, "WrongAmount");
      await sc.connect(members[0]).join(0, "Amina", { value: C });
      await expect(sc.connect(members[0]).join(0, "", { value: C })).to.be.revertedWithCustomError(sc, "AlreadyJoined");
      await sc.connect(members[1]).join(0, "", { value: C });
      expect((await sc.getCircle(0)).status).to.equal(Status.Forming);
      await expect(sc.connect(members[2]).join(0, "", { value: C })).to.emit(sc, "CircleStarted");
      expect((await sc.getCircle(0)).status).to.equal(Status.Active);
    });

    it("lets the creator cancel a forming circle and refunds deposits", async function () {
      const { sc, members } = await setup();
      await sc.createCircle("Chama", members.map((m) => m.address), C, DAY);
      await sc.connect(members[0]).join(0, "", { value: C });
      await expect(sc.connect(members[0]).cancelForming(0)).to.be.revertedWithCustomError(sc, "NotCreator");
      await sc.cancelForming(0);
      expect(await sc.withdrawable(members[0].address)).to.equal(C);
      expect(await sc.withdrawable(members[1].address)).to.equal(0n);
      await expect(sc.connect(members[1]).join(0, "", { value: C })).to.be.revertedWithCustomError(sc, "WrongStatus");
    });

    it("tracks circles per user", async function () {
      const { sc, creator, members, outsider } = await setup();
      await sc.createCircle("A", members.map((m) => m.address), C, DAY);
      await sc.connect(members[0]).createOpenCircle("B", 2, C, DAY);
      await sc.connect(outsider).join(1, "", { value: C });
      expect(await sc.getUserCircles(creator.address)).to.deep.equal([0n]);
      expect(await sc.getUserCircles(members[0].address)).to.deep.equal([0n, 1n]);
      expect(await sc.getUserCircles(members[1].address)).to.deep.equal([0n]);
      expect(await sc.getUserCircles(outsider.address)).to.deep.equal([1n]);
    });
  });

  describe("open circles", function () {
    it("fills seats in join order and starts when full", async function () {
      const { sc, signers } = await setup();
      const [, a, b, c, d] = signers;
      await expect(sc.connect(a).createOpenCircle("Open Susu", 3, C, DAY))
        .to.emit(sc, "CircleCreated").withArgs(0, a.address, "Open Susu", true, 3, C, DAY);
      await sc.connect(c).join(0, "Chidi", { value: C });
      await sc.connect(a).join(0, "Ama", { value: C });
      expect((await sc.getCircle(0)).status).to.equal(Status.Forming);
      await expect(sc.connect(b).join(0, "Bola", { value: C })).to.emit(sc, "CircleStarted");
      await expect(sc.connect(d).join(0, "", { value: C })).to.be.revertedWithCustomError(sc, "WrongStatus");

      const details = await sc.getMemberDetails(0);
      expect(details.addrs).to.deep.equal([c.address, a.address, b.address]);
      expect(details.nicknames).to.deep.equal(["Chidi", "Ama", "Bola"]);
      expect(await sc.currentRecipient(0)).to.equal(c.address);
    });

    it("lets members leave before the start, keeping everyone else's order", async function () {
      const { sc, signers } = await setup();
      const [, a, b, c, d] = signers;
      await sc.connect(a).createOpenCircle("Open", 4, C, DAY);
      for (const s of [a, b, c]) await sc.connect(s).join(0, "", { value: C });
      await expect(sc.connect(d).leave(0)).to.be.revertedWithCustomError(sc, "NotMember");
      await expect(sc.connect(b).leave(0)).to.emit(sc, "MemberLeft").withArgs(0, b.address);
      expect(await sc.withdrawable(b.address)).to.equal(C);
      let circle = await sc.getCircle(0);
      expect(circle.members).to.deep.equal([a.address, c.address]);
      expect(circle.joinedCount).to.equal(2);
      // seat is free again; b can rejoin at the back
      await sc.connect(d).join(0, "", { value: C });
      await sc.connect(b).join(0, "", { value: C });
      circle = await sc.getCircle(0);
      expect(circle.members).to.deep.equal([a.address, c.address, d.address, b.address]);
      expect(circle.status).to.equal(Status.Active);
      await expect(sc.connect(a).leave(0)).to.be.revertedWithCustomError(sc, "WrongStatus");
    });

    it("lets an invited member leave and rejoin an invite-only circle", async function () {
      const { sc, members } = await setup();
      await sc.createCircle("Chama", members.map((m) => m.address), C, DAY);
      await sc.connect(members[1]).join(0, "", { value: C });
      await sc.connect(members[1]).leave(0);
      expect((await sc.getCircle(0)).members.length).to.equal(3); // payout order unchanged
      expect((await sc.getMember(0, members[1].address)).invited).to.equal(true);
      await sc.connect(members[1]).join(0, "", { value: C });
      expect((await sc.getCircle(0)).joinedCount).to.equal(1);
    });
  });

  describe("nicknames", function () {
    it("sets and validates nicknames", async function () {
      const { sc, members, outsider } = await activeCircle(3);
      await expect(sc.connect(members[0]).setNickname(0, "Mama Njeri"))
        .to.emit(sc, "NicknameSet").withArgs(0, members[0].address, "Mama Njeri");
      expect((await sc.getMember(0, members[0].address)).nickname).to.equal("Mama Njeri");
      await expect(sc.connect(members[0]).setNickname(0, "x".repeat(33))).to.be.revertedWithCustomError(sc, "NicknameTooLong");
      await expect(sc.connect(outsider).setNickname(0, "hi")).to.be.revertedWithCustomError(sc, "NotMember");
    });
  });

  describe("rounds", function () {
    it("runs a full circle: everyone receives the pot once and gets their deposit back", async function () {
      const { sc, members } = await activeCircle(3);
      for (let r = 0; r < 3; r++) {
        expect(await sc.currentRecipient(0)).to.equal(members[r].address);
        await expect(sc.settleRound(0)).to.be.revertedWithCustomError(sc, "RoundStillOpen");
        for (const m of members) await sc.connect(m).contribute(0, { value: C });
        await expect(sc.settleRound(0)).to.emit(sc, "RoundSettled").withArgs(0, r, members[r].address, C * 3n);
      }
      const c = await sc.getCircle(0);
      expect(c.status).to.equal(Status.Completed);
      expect(await sc.totalPaidOut()).to.equal(C * 9n);
      expect(await sc.roundsSettled()).to.equal(3n);
      expect(await sc.circlesCompleted()).to.equal(1n);
      // each member: 3C pot + 1C deposit back = 4C, exactly what they put in (3C + 1C)
      for (const m of members) expect(await sc.withdrawable(m.address)).to.equal(C * 4n);
      expect(await totalOwed(sc, members)).to.equal(await contractBalance(sc));

      for (const m of members) {
        await expect(sc.connect(m).withdraw()).to.changeEtherBalances([m, sc], [C * 4n, -C * 4n]);
      }
      expect(await contractBalance(sc)).to.equal(0n);
      await expect(sc.connect(members[0]).withdraw()).to.be.revertedWithCustomError(sc, "NothingToWithdraw");
    });

    it("reports per-member payment status in one call", async function () {
      const { sc, members } = await activeCircle(3);
      await sc.connect(members[1]).contribute(0, { value: C });
      const d = await sc.getMemberDetails(0);
      expect(d.paidThisRound).to.deep.equal([false, true, false]);
      expect(d.joined).to.deep.equal([true, true, true]);
    });

    it("rejects double payment, wrong amounts, outsiders and late payments", async function () {
      const { sc, members, outsider } = await activeCircle(3);
      await expect(sc.connect(outsider).contribute(0, { value: C })).to.be.revertedWithCustomError(sc, "NotMember");
      await expect(sc.connect(members[0]).contribute(0, { value: C * 2n })).to.be.revertedWithCustomError(sc, "WrongAmount");
      await sc.connect(members[0]).contribute(0, { value: C });
      await expect(sc.connect(members[0]).contribute(0, { value: C })).to.be.revertedWithCustomError(sc, "AlreadyPaid");
      await time.increase(7 * DAY);
      await expect(sc.connect(members[1]).contribute(0, { value: C })).to.be.revertedWithCustomError(sc, "RoundClosed");
    });

    it("covers a first missed payment from the deposit", async function () {
      const { sc, members } = await activeCircle(3);
      await sc.connect(members[0]).contribute(0, { value: C });
      await sc.connect(members[1]).contribute(0, { value: C });
      await time.increase(7 * DAY);
      await expect(sc.settleRound(0))
        .to.emit(sc, "DepositUsed").withArgs(0, 0, members[2].address)
        .and.to.emit(sc, "RoundSettled").withArgs(0, 0, members[0].address, C * 3n);
      const m2 = await sc.getMember(0, members[2].address);
      expect(m2.depositUsed).to.equal(true);
      expect(m2.defaults).to.equal(1);
      expect(await totalOwed(sc, members)).to.be.lte(await contractBalance(sc));
    });

    it("dissolves on a repeat default and refunds this round's payments and unused deposits", async function () {
      const { sc, members } = await activeCircle(3);
      await sc.connect(members[0]).contribute(0, { value: C });
      await sc.connect(members[1]).contribute(0, { value: C });
      await time.increase(7 * DAY);
      await sc.settleRound(0); // member 0 credited 3C, member 2's deposit used
      await sc.connect(members[0]).contribute(0, { value: C });
      await time.increase(7 * DAY);
      await expect(sc.settleRound(0)).to.emit(sc, "CircleCancelled").withArgs(0, 1, members[2].address);
      expect((await sc.getCircle(0)).status).to.equal(Status.Cancelled);

      expect(await sc.withdrawable(members[0].address)).to.equal(C * 5n);
      expect(await sc.withdrawable(members[1].address)).to.equal(C);
      expect(await sc.withdrawable(members[2].address)).to.equal(0n);
      expect(await totalOwed(sc, members)).to.equal(await contractBalance(sc));
    });

    it("keeps circles independent", async function () {
      const { sc, members } = await activeCircle(2);
      await sc.createCircle("Second", [members[0].address, members[1].address], C * 2n, DAY);
      await sc.connect(members[0]).join(1, "", { value: C * 2n });
      await sc.connect(members[1]).join(1, "", { value: C * 2n });
      await sc.connect(members[0]).contribute(1, { value: C * 2n });
      expect((await sc.getMember(0, members[0].address)).paidThisRound).to.equal(false);
      expect((await sc.getMember(1, members[0].address)).paidThisRound).to.equal(true);
      await expect(sc.getCircle(5)).to.be.revertedWithCustomError(sc, "UnknownCircle");
    });
  });
});
