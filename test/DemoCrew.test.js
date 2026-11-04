const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { runDemoCrew, crewWallets, payAt } = require("../scripts/demo-crew-lib");
const { runKeeper } = require("../scripts/keeper-lib");

const DAY = 24 * 3600;

describe("Demo crew", function () {
  async function setup() {
    const [funder] = await ethers.getSigners();
    const sc = await ethers.deployContract("SavingsCircles");
    const crew = crewWallets(ethers.id("test secret"), ethers.provider);
    const nowOf = async () => (await ethers.provider.getBlock("latest")).timestamp;
    const run = async () => runDemoCrew({ contract: sc, crew, funder, now: await nowOf() });
    return { sc: sc.connect(funder), crew, funder, run, nowOf };
  }

  it("derives the same wallets from the same secret", function () {
    const a = crewWallets(ethers.id("x")).map((w) => w.address);
    const b = crewWallets(ethers.id("x")).map((w) => w.address);
    const c = crewWallets(ethers.id("y")).map((w) => w.address);
    expect(a).to.deep.equal(b);
    expect(a).to.have.length(5);
    expect(new Set([...a, ...c]).size).to.equal(10);
  });

  it("funds the crew and starts a clearly labelled demo circle", async function () {
    const { sc, crew, run } = await setup();
    const r = await run();
    expect(r.circle).to.equal(0);
    expect(r.messages[0]).to.match(/^🆕 New demo circle "Demo: Lagos Traders Ajo"/);
    const c = await sc.getCircle(0);
    expect(c.status).to.equal(1); // Active
    expect(c.joinedCount).to.equal(5);
    for (const w of crew) expect(await ethers.provider.getBalance(w.address)).to.be.greaterThan(0n);
    // nobody has reached their pay time on the very first run except possibly the earliest slot
    expect(c.paidCount).to.be.lessThanOrEqual(1);
  });

  it("pays on a staggered schedule, rotating the late payer each round", async function () {
    const { sc, run } = await setup();
    await run();
    await time.increase(Math.ceil(DAY * 0.7));
    await run();
    let d = await sc.getMemberDetails(0);
    const unpaid = d.paidThisRound.map((p, i) => (!p ? i : null)).filter((x) => x !== null);
    expect(unpaid).to.deep.equal([0, 1, 2, 3, 4].filter((i) => payAt(i, 0) > 0.7));
    expect(unpaid).to.have.length(1);

    await time.increase(Math.ceil(DAY * 0.2));
    await run();
    expect((await sc.getCircle(0)).paidCount).to.equal(5);
    // the keeper settles; next round the late payer is someone else
    await runKeeper({ contract: sc });
    expect((await sc.getCircle(0)).round).to.equal(1);
    const late0 = unpaid[0];
    const late1 = [0, 1, 2, 3, 4].find((i) => payAt(i, 1) === 0.85);
    expect(late1).to.not.equal(late0);
  });

  it("runs a whole circle to completion, collects payouts and starts the next one", async function () {
    const { sc, crew, run } = await setup();
    await run();
    for (let round = 0; round < 5; round++) {
      await time.increase(Math.ceil(DAY * 0.9));
      await run();
      const r = await runKeeper({ contract: sc });
      expect(r.settled).to.have.length(1);
    }
    expect((await sc.getCircle(0)).status).to.equal(2); // Completed
    const r = await run();
    expect(r.circle).to.equal(1);
    expect((await sc.getCircle(1)).name).to.equal("Demo: Lagos Traders Ajo #2");
    for (const w of crew) expect(await sc.withdrawable(w.address)).to.equal(0n);
    const rep = await sc.getReputation(crew[0].address);
    expect(rep.completed).to.equal(1);
    expect(rep.missedPayments).to.equal(0);
  });

  it("supports a dry run without sending transactions", async function () {
    const { sc, crew, funder, nowOf } = await setup();
    const r = await runDemoCrew({ contract: sc, crew, funder, now: await nowOf(), dryRun: true });
    expect(r.actions.every((a) => a.startsWith("[dry run]"))).to.equal(true);
    expect(await sc.circleCount()).to.equal(0);
  });
});
