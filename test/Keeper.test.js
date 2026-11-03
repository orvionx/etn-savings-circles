const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { runKeeper, reminderLead } = require("../scripts/keeper-lib");

const C = ethers.parseEther("1");
const DAY = 24 * 60 * 60;
const WEEK = 7 * DAY;

describe("Keeper", function () {
  async function setup() {
    const [keeper, a, b, c] = await ethers.getSigners();
    const sc = await ethers.deployContract("SavingsCircles");
    await sc.connect(a).createOpenCircle("Weekly Chama", 3, C, WEEK, 0);
    await sc.connect(a).join(0, "Amina", { value: C });
    await sc.connect(b).join(0, "Kofi", { value: C });
    await sc.connect(c).join(0, "", { value: C });
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
    expect(r.messages[0]).to.match(/round 1 settled: 3 ETN sent to Amina\. https:\/\/app\.example\/#\/circle\/0/);
    expect((await sc.getCircle(0)).round).to.equal(1);
    expect(await sc.withdrawable(a.address)).to.equal(C * 3n);
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
    expect(r.messages[0]).to.match(/closes in 24 hours\. 1\/3 paid\. Still to pay 1 ETN: Kofi, 0x90F7…b906/);
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

  it("announces completion and dissolution", async function () {
    const { sc, a, b, c } = await setup();
    for (let i = 0; i < 3; i++) {
      for (const m of [a, b, c]) await sc.connect(m).contribute(0, { value: C });
      const r = await runKeeper({ contract: sc });
      if (i === 2) expect(r.messages[0]).to.include("The circle is complete");
    }
    // second circle: c misses twice -> dissolved
    await sc.connect(a).createCircle("Short", [a.address, c.address], C, DAY);
    await sc.connect(a).join(1, "", { value: C });
    await sc.connect(c).join(1, "", { value: C });
    await sc.connect(a).contribute(1, { value: C });
    await time.increase(DAY);
    await runKeeper({ contract: sc });
    await sc.connect(a).contribute(1, { value: C });
    await time.increase(DAY);
    const r = await runKeeper({ contract: sc });
    expect(r.messages[0]).to.include("was dissolved");
  });
});
