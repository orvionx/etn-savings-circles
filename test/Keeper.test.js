const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, mine } = require("@nomicfoundation/hardhat-network-helpers");
const { draw, secretOf, commitOf } = require("./helpers");
const { runKeeper, reminderLead } = require("../scripts/keeper-lib");

const C = ethers.parseEther("1");
const DAY = 24 * 60 * 60;
const WEEK = 7 * DAY;

describe("Keeper", function () {
  async function setup() {
    const [keeper, a, b, c] = await ethers.getSigners();
    const sc = await ethers.deployContract("SavingsCircles");
    await sc.connect(a).createOpenCircle("Weekly Chama", 3, C, WEEK, 0);
    await sc.connect(a).join(0, "Amina", commitOf(0, a), { value: C });
    await sc.connect(b).join(0, "Kofi", commitOf(0, b), { value: C });
    await sc.connect(c).join(0, "", commitOf(0, c), { value: C });
    await draw(sc, 0);
    return { sc: sc.connect(keeper), keeper, a, b, c };
  }
  const nowOf = async () => (await ethers.provider.getBlock("latest")).timestamp;

  it("does nothing while a round is open and far from its deadline", async function () {
    const { sc } = await setup();
    const r = await runKeeper({ contract: sc });
    expect(r.scanned).to.equal(1);
    expect(r.settled).to.have.length(0);
    expect(r.reminders).to.have.length(0);
  });

  it("settles a round as soon as everyone has paid", async function () {
    const { sc, a, b, c } = await setup();
    for (const m of [a, b, c]) await sc.connect(m).contribute(0, { value: C });
    const r = await runKeeper({ contract: sc, appUrl: "https://app.example" });
    expect(r.settled).to.have.length(1);
    const first = (await sc.getMemberDetails(0)).addrs[0];
    const name = { [a.address]: "Amina", [b.address]: "Kofi", [c.address]: "0x90F7…b906" }[first];
    expect(r.messages[0]).to.include(`round 1 settled: 3 ETN sent to ${name}. https://app.example/#/circle/0`);
    expect((await sc.getCircle(0)).round).to.equal(1);
    expect(await sc.withdrawable(first)).to.equal(C * 3n);
  });

  it("settles after the deadline, reporting who was covered by their deposit", async function () {
    const { sc, a, b } = await setup();
    await sc.connect(a).contribute(0, { value: C });
    await sc.connect(b).contribute(0, { value: C });
    await time.increase(WEEK);
    const r = await runKeeper({ contract: sc });
    expect(r.settled).to.have.length(1);
    expect(r.messages[0]).to.include("Covered by deposit: 0x90F7");
  });

  it("sends one reminder when the deadline gets close, listing unpaid members", async function () {
    const { sc, a } = await setup();
    await sc.connect(a).contribute(0, { value: C });
    const deadline = Number((await sc.getCircle(0)).roundDeadline);
    const lead = reminderLead(WEEK);
    expect(lead).to.equal(DAY);

    // just inside the reminder window -> one reminder
    let r = await runKeeper({ contract: sc, now: deadline - lead + 60, interval: 900 });
    expect(r.reminders).to.have.length(1);
    expect(r.messages[0]).to.match(/closes in 24 hours\. 1\/3 paid\. Still to pay 1 ETN: /);
    expect(r.messages[0]).to.include("Kofi").and.to.include("0x90F7…b906").and.not.to.include("Amina");
    // a later run (outside this interval window) stays quiet
    r = await runKeeper({ contract: sc, now: deadline - lead + 1200, interval: 900 });
    expect(r.reminders).to.have.length(0);
  });

  it("supports a dry run without sending transactions", async function () {
    const { sc, a, b, c } = await setup();
    for (const m of [a, b, c]) await sc.connect(m).contribute(0, { value: C });
    const r = await runKeeper({ contract: sc, dryRun: true, now: await nowOf() });
    expect(r.settled[0].dryRun).to.equal(true);
    expect((await sc.getCircle(0)).round).to.equal(0);
  });

  it("draws the payout order of closed circles once the committed block exists", async function () {
    const { sc, a, b } = await setup();
    await sc.connect(a).createCircle("Pair", [a.address, b.address], C, DAY);
    await sc.connect(a).join(1, "Amina", commitOf(1, a), { value: C });
    await sc.connect(b).join(1, "Kofi", commitOf(1, b), { value: C });

    let r = await runKeeper({ contract: sc, now: await nowOf() });
    expect(r.drawn).to.have.length(0); // members are still revealing

    await sc.connect(a).reveal(1, secretOf(1, a));
    await sc.connect(b).reveal(1, secretOf(1, b));
    r = await runKeeper({ contract: sc, now: await nowOf() });
    expect(r.drawn).to.have.length(0); // committed block not mined yet

    await mine(6);
    r = await runKeeper({ contract: sc, dryRun: true, now: await nowOf() });
    expect(r.drawn[0].dryRun).to.equal(true);
    expect((await sc.getCircle(1)).status).to.equal(4);

    r = await runKeeper({ contract: sc, now: await nowOf() });
    expect(r.drawn.map((d) => d.id)).to.deep.equal([1]);
    expect((await sc.getCircle(1)).status).to.equal(1);
    expect(r.messages[0]).to.match(/^🎲 "Pair" is full and the payout order has been drawn\. First pot goes to (Amina|Kofi)\./);
  });

  it("reminds members to reveal, and schedules the draw when the deadline passes", async function () {
    const { sc, a, b } = await setup();
    await sc.connect(a).createCircle("Pair", [a.address, b.address], C, DAY);
    await sc.connect(a).join(1, "Amina", commitOf(1, a), { value: C });
    await sc.connect(b).join(1, "Kofi", commitOf(1, b), { value: C });
    await sc.connect(a).reveal(1, secretOf(1, a));
    const deadline = Number((await sc.getDraw(1)).revealDeadline);

    let r = await runKeeper({ contract: sc, now: deadline - 6 * 3600 + 60, interval: 900 });
    expect(r.messages.join()).to.include('"Pair": 1/2 members have revealed');

    await time.increaseTo(deadline);
    r = await runKeeper({ contract: sc, now: deadline, interval: 900 });
    expect((await sc.getDraw(1)).drawBlock).to.be.greaterThan(0); // scheduled, not drawn yet
    expect(r.drawn).to.have.length(0);
    await mine(6);
    r = await runKeeper({ contract: sc, now: await nowOf() });
    expect(r.drawn.map((d) => d.id)).to.deep.equal([1]);
    expect((await sc.getCircle(1)).members[0]).to.equal(a.address); // the only revealer goes first
  });

  it("announces completion and dissolution", async function () {
    const { sc, a, b, c } = await setup();
    for (let i = 0; i < 3; i++) {
      for (const m of [a, b, c]) await sc.connect(m).contribute(0, { value: C });
      const r = await runKeeper({ contract: sc });
      if (i === 2) expect(r.messages[0]).to.include("The circle is complete");
    }
    // second circle: c misses twice -> dissolved
    await sc.connect(a).createCircle("Short", [a.address, c.address], C, DAY);
    await sc.connect(a).join(1, "", commitOf(1, a), { value: C });
    await sc.connect(c).join(1, "", commitOf(1, c), { value: C });
    await draw(sc, 1);
    await sc.connect(a).contribute(1, { value: C });
    await time.increase(DAY);
    await runKeeper({ contract: sc });
    await sc.connect(a).contribute(1, { value: C });
    await time.increase(DAY);
    const r = await runKeeper({ contract: sc });
    expect(r.messages[0]).to.include("was dissolved");
  });
});
