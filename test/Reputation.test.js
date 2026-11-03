const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const C = ethers.parseEther("0.1");
const DAY = 24 * 60 * 60;

function decodeDataUri(uri, prefix) {
  expect(uri.startsWith(prefix)).to.equal(true);
  return Buffer.from(uri.slice(prefix.length), "base64").toString("utf8");
}

describe("Reputation & badges", function () {
  async function setup() {
    const signers = await ethers.getSigners();
    const sc = await ethers.deployContract("SavingsCircles");
    const badges = await ethers.getContractAt("SavingsBadges", await sc.badges());
    return { sc, badges, signers };
  }

  /** Runs a full circle; `skip` = [round, memberIndex] pairs that miss their payment. */
  async function runCircle(sc, members, name = "Chama", skip = []) {
    const id = await sc.circleCount();
    await sc.createCircle(name, members.map((m) => m.address), C, DAY);
    for (const m of members) await sc.connect(m).join(id, "", { value: C });
    for (let r = 0; r < members.length; r++) {
      for (const [i, m] of members.entries()) {
        if (skip.some(([sr, si]) => sr === r && si === i)) continue;
        await sc.connect(m).contribute(id, { value: C });
      }
      if (skip.some(([sr]) => sr === r)) await time.increase(DAY);
      await sc.settleRound(id);
    }
    return id;
  }

  it("records completed circles and on-time payments", async function () {
    const { sc, signers } = await setup();
    const [, a, b, c] = signers;
    await runCircle(sc, [a, b, c]);
    const r = await sc.getReputation(a.address);
    expect(r.joined).to.equal(1);
    expect(r.completed).to.equal(1);
    expect(r.onTimePayments).to.equal(3);
    expect(r.missedPayments).to.equal(0);
    expect(r.defaulted).to.equal(0);
  });

  it("records missed payments and repeat defaults", async function () {
    const { sc, signers } = await setup();
    const [, a, b, c] = signers;
    // c misses round 1 (covered by deposit) and the circle still completes
    await runCircle(sc, [a, b, c], "Chama", [[0, 2]]);
    let r = await sc.getReputation(c.address);
    expect(r.missedPayments).to.equal(1);
    expect(r.completed).to.equal(1);
    expect(r.onTimePayments).to.equal(2);

    // new circle: c misses twice -> dissolves, c gets a default
    await sc.createCircle("Second", [a.address, c.address], C, DAY);
    await sc.connect(a).join(1, "", { value: C });
    await sc.connect(c).join(1, "", { value: C });
    await sc.connect(a).contribute(1, { value: C });
    await time.increase(DAY); await sc.settleRound(1);
    await sc.connect(a).contribute(1, { value: C });
    await time.increase(DAY);
    await expect(sc.settleRound(1)).to.emit(sc, "CircleCancelled");
    r = await sc.getReputation(c.address);
    expect(r.defaulted).to.equal(1);
    expect(r.missedPayments).to.equal(2);
    expect((await sc.getReputation(a.address)).defaulted).to.equal(0);
  });

  it("does not count circles a member left before the start", async function () {
    const { sc, signers } = await setup();
    const [, a] = signers;
    await sc.createOpenCircle("Open", 3, C, DAY, 0);
    await sc.connect(a).join(0, "", { value: C });
    expect((await sc.getReputation(a.address)).joined).to.equal(1);
    await sc.connect(a).leave(0);
    expect((await sc.getReputation(a.address)).joined).to.equal(0);
  });

  describe("track-record requirements", function () {
    it("only lets members with enough completed circles and no defaults join", async function () {
      const { sc, signers } = await setup();
      const [, a, b, c, newbie] = signers;
      await runCircle(sc, [a, b, c], "Chama", [[0, 2]]); // c missed once (no default)

      await expect(sc.createOpenCircle("x", 3, C, DAY, 101)).to.be.revertedWithCustomError(sc, "InvalidRequirement");
      await expect(sc.connect(a).createOpenCircle("Trusted", 3, C, DAY, 1))
        .to.emit(sc, "CircleCreated").withArgs(1, a.address, "Trusted", true, 3, C, DAY, 1);
      expect(await sc.requirementOf(1)).to.equal(1);
      expect(await sc.isEligible(1, newbie.address)).to.equal(false);
      expect(await sc.isEligible(1, c.address)).to.equal(true);

      await expect(sc.connect(newbie).join(1, "", { value: C })).to.be.revertedWithCustomError(sc, "NotEligible");
      await sc.connect(a).join(1, "", { value: C });
      await sc.connect(c).join(1, "", { value: C });
    });

    it("excludes members with a default", async function () {
      const { sc, signers } = await setup();
      const [, a, b] = signers;
      await runCircle(sc, [a, b]);
      // b defaults twice in a new circle
      await sc.createCircle("Bad", [a.address, b.address], C, DAY);
      await sc.connect(a).join(1, "", { value: C });
      await sc.connect(b).join(1, "", { value: C });
      await sc.connect(a).contribute(1, { value: C });
      await time.increase(DAY); await sc.settleRound(1);
      await sc.connect(a).contribute(1, { value: C });
      await time.increase(DAY); await sc.settleRound(1);
      await sc.createOpenCircle("Trusted", 2, C, DAY, 1);
      expect(await sc.isEligible(2, b.address)).to.equal(false);
      await expect(sc.connect(b).join(2, "", { value: C })).to.be.revertedWithCustomError(sc, "NotEligible");
    });

    it("never restricts invite-only circles", async function () {
      const { sc, signers } = await setup();
      const [, a, b] = signers;
      await sc.createCircle("Family", [a.address, b.address], C, DAY);
      expect(await sc.requirementOf(0)).to.equal(0);
      await sc.connect(a).join(0, "", { value: C });
    });
  });

  describe("badges", function () {
    it("mints a soulbound badge to every member on completion", async function () {
      const { sc, badges, signers } = await setup();
      const [, a, b, c] = signers;
      const id = await sc.circleCount();
      await sc.createCircle("Chama", [a, b, c].map((m) => m.address), C, DAY);
      for (const m of [a, b, c]) await sc.connect(m).join(id, "", { value: C });
      for (let r = 0; r < 2; r++) { for (const m of [a, b, c]) await sc.connect(m).contribute(id, { value: C }); await sc.settleRound(id); }
      for (const m of [a, b, c]) await sc.connect(m).contribute(id, { value: C });
      await expect(sc.settleRound(id))
        .to.emit(sc, "BadgeAwarded").withArgs(id, a.address, 1n)
        .and.to.emit(sc, "BadgeAwarded").withArgs(id, c.address, 3n);

      expect(await badges.totalSupply()).to.equal(3n);
      expect(await badges.ownerOf(2n)).to.equal(b.address);
      expect(await badges.tokensOf(a.address)).to.deep.equal([1n]);
      expect(await badges.balanceOf(c.address)).to.equal(1n);
      expect(await badges.name()).to.equal("ETN Savings Circle Badge");
    });

    it("cannot be transferred or minted by anyone else", async function () {
      const { sc, badges, signers } = await setup();
      const [, a, b] = signers;
      await runCircle(sc, [a, b]);
      await expect(badges.connect(a).transferFrom(a.address, b.address, 1n)).to.be.revertedWithCustomError(badges, "Soulbound");
      await expect(badges.connect(a).mint(a.address, 0, 2, 0, C)).to.be.revertedWithCustomError(badges, "NotCircles");
    });

    it("has on-chain JSON metadata and SVG art with safely escaped names", async function () {
      const { sc, badges, signers } = await setup();
      const [, a, b, c] = signers;
      const tricky = `Kibera "Mama's" <Chama> & \\ Friends`;
      await runCircle(sc, [a, b, c], tricky, [[1, 2]]);

      const meta = JSON.parse(decodeDataUri(await badges.tokenURI(1n), "data:application/json;base64,"));
      expect(meta.name).to.equal("Savings Circle Badge #1");
      expect(meta.description).to.include(tricky);
      const attrs = Object.fromEntries(meta.attributes.map((x) => [x.trait_type, x.value]));
      expect(attrs).to.deep.include({ Circle: tricky, "Circle ID": 0, Rounds: 3, "Contribution (ETN)": "0.1", "Missed payments": 0, "Perfect record": "Yes" });

      const svg = decodeDataUri(meta.image, "data:image/svg+xml;base64,");
      expect(svg).to.include("&quot;Mama&#39;s&quot; &lt;Chama&gt; &amp;");
      expect(svg).to.include("PERFECT RECORD");
      expect(svg).not.to.include("<Chama>");

      const missed = JSON.parse(decodeDataUri(await badges.tokenURI(3n), "data:application/json;base64,"));
      expect(missed.attributes.find((x) => x.trait_type === "Perfect record").value).to.equal("No");
      expect(decodeDataUri(missed.image, "data:image/svg+xml;base64,")).to.include("COMPLETED");
      await expect(badges.tokenURI(99n)).to.be.revertedWithCustomError(badges, "ERC721NonexistentToken");
    });

    it("formats contribution amounts", async function () {
      const { sc, badges, signers } = await setup();
      const [, a, b] = signers;
      for (const [amt, want] of [["2.5", "2.5"], ["1000", "1000"], ["0.0001", "0.0001"], ["0.12345", "0.1234"]]) {
        const v = ethers.parseEther(amt);
        const id = await sc.circleCount();
        await sc.createCircle("Amt", [a.address, b.address], v, DAY);
        await sc.connect(a).join(id, "", { value: v }); await sc.connect(b).join(id, "", { value: v });
        for (let r = 0; r < 2; r++) { await sc.connect(a).contribute(id, { value: v }); await sc.connect(b).contribute(id, { value: v }); await sc.settleRound(id); }
        const supply = await badges.totalSupply();
        const meta = JSON.parse(decodeDataUri(await badges.tokenURI(supply), "data:application/json;base64,"));
        expect(meta.attributes.find((x) => x.trait_type === "Contribution (ETN)").value).to.equal(want);
      }
    });
  });
});
