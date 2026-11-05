// Findings from the November 2026 security review (docs/SECURITY_REVIEW.md), pinned as tests.
// The "known risk" tests describe current v3 behaviour; a fix in a later version should
// change them on purpose.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { draw, inPayoutOrder } = require("./helpers");
const { safeText } = require("../scripts/keeper-lib");

const C = ethers.parseEther("1");
const DAY = 24 * 3600;

describe("Security review", function () {
  it("known risk SC-01: the first recipient can take the pot and stop paying", async function () {
    const signers = (await ethers.getSigners()).slice(0, 5);
    const sc = await ethers.deployContract("SavingsCircles");
    await sc.createCircle("x", signers.map((w) => w.address), C, DAY);
    for (const w of signers) await sc.connect(w).join(0, "", { value: C });
    await draw(sc, 0);
    // the draw decides who lands in the first slot; whoever does can still default
    const m = await inPayoutOrder(sc, 0, signers);
    const [attacker, ...rest] = m;
    for (const w of m) await sc.connect(w).contribute(0, { value: C });
    await sc.settleRound(0); // attacker collects the 5 ETN pot
    for (let r = 1; r <= 2; r++) { // attacker stops paying: round 2 uses the deposit, round 3 dissolves
      for (const w of rest) await sc.connect(w).contribute(0, { value: C });
      await time.increase(DAY);
      await sc.settleRound(0);
    }
    expect((await sc.getCircle(0)).status).to.equal(3); // Cancelled
    const got = await Promise.all(m.map((w) => sc.withdrawable(w.address)));
    // put in: attacker 2 ETN (deposit + 1 round), everyone else 4 ETN
    expect(got.map((g) => ethers.formatEther(g))).to.deep.equal(["5.0", "7.0", "2.0", "2.0", "2.0"]);
    expect((await sc.getReputation(attacker.address)).defaulted).to.equal(1);
  });

  it("known risk SC-02: a completed-circle record costs about 0.001 ETN to farm", async function () {
    const [a, b] = await ethers.getSigners();
    const sc = await ethers.deployContract("SavingsCircles");
    let gas = 0n;
    const g = async (p) => { gas += (await (await p).wait()).gasUsed; };
    await g(sc.createCircle("f", [a.address, b.address], 1n, 60));
    await g(sc.connect(a).join(0, "", { value: 1n }));
    await g(sc.connect(b).join(0, "", { value: 1n }));
    await draw(sc, 0);
    for (let r = 0; r < 2; r++) {
      await g(sc.connect(a).contribute(0, { value: 1n }));
      await g(sc.connect(b).contribute(0, { value: 1n }));
      await g(sc.settleRound(0));
    }
    expect((await sc.getReputation(a.address)).completed).to.equal(1);
    expect(gas).to.be.lessThan(1_300_000n); // ≈ 0.0013 ETN at 1 gwei, for both wallets together (draw excluded)
    expect(await sc.isEligible(0, a.address)).to.equal(true);
  });

  it("SC-03: settling the final round of a 50-member circle fits well inside a block", async function () {
    this.timeout(120000);
    const sc = await ethers.deployContract("SavingsCircles");
    const [f] = await ethers.getSigners();
    const ws = [];
    for (let i = 0; i < 50; i++) {
      const w = ethers.Wallet.createRandom().connect(ethers.provider);
      ws.push(w);
      await f.sendTransaction({ to: w.address, value: ethers.parseEther("1") });
    }
    await sc.createCircle("big", ws.map((w) => w.address), 1n, 60);
    for (const w of ws) await sc.connect(w).join(0, "", { value: 1n });
    await ethers.provider.send("hardhat_mine", ["0x6"]);
    const drawTx = await (await sc.drawOrder(0)).wait();
    expect(drawTx.gasUsed).to.be.lessThan(2_000_000n); // shuffling 50 members
    let last;
    for (let r = 0; r < 50; r++) {
      for (const w of ws) await sc.connect(w).contribute(0, { value: 1n });
      last = await (await sc.settleRound(0)).wait();
    }
    expect((await sc.getCircle(0)).status).to.equal(2);
    expect(last.gasUsed).to.be.lessThan(10_000_000n); // ETN block gas limit is 30M
  });

  it("SC-07 fixed: a creator can't choose their own slot", async function () {
    const [creator, x, y, z] = await ethers.getSigners();
    const sc = await ethers.deployContract("SavingsCircles");
    let firstCount = 0;
    for (let id = 0; id < 30; id++) {
      await sc.connect(creator).createCircle("mine", [creator, x, y, z].map((w) => w.address), C, DAY);
      for (const w of [creator, x, y, z]) await sc.connect(w).join(id, "", { value: C });
      if ((await draw(sc, id))[0] === creator.address) firstCount++;
    }
    expect(firstCount).to.be.lessThan(20); // about 1 in 4; was always first in v3
  });

  it("the bot never posts user-chosen links or mentions", function () {
    expect(safeText("Lagos Traders Ajo", "x")).to.equal("Lagos Traders Ajo");
    expect(safeText("Mama Ngozi's Susu (2026)", "x")).to.equal("Mama Ngozi's Susu (2026)");
    for (const bad of ["Claim at evil.com", "https://x.io", "www.x", "join t.me/scam", "dm @admin", "evil . com", "a​.io", "bad。com"]) {
      expect(safeText(bad, "fallback"), bad).to.equal("fallback");
    }
    expect(safeText("line1\nline2", "x")).to.equal("line1 line2");
    expect(safeText("", "fallback")).to.equal("fallback");
  });
});
