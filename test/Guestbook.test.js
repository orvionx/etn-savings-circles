const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Guestbook", function () {
  async function deploy() {
    const [owner, other] = await ethers.getSigners();
    const gb = await ethers.deployContract("Guestbook", ["Hello ETN!"]);
    return { gb, owner, other };
  }

  it("stores the first message and owner", async function () {
    const { gb, owner } = await deploy();
    expect(await gb.owner()).to.equal(owner.address);
    expect(await gb.count()).to.equal(1n);
    expect((await gb.entry(0)).message).to.equal("Hello ETN!");
  });

  it("lets anyone sign and emits an event", async function () {
    const { gb, other } = await deploy();
    await expect(gb.connect(other).sign("gm"))
      .to.emit(gb, "Signed").withArgs(other.address, 1n, "gm");
    expect((await gb.entry(1)).author).to.equal(other.address);
  });

  it("rejects empty and too-long messages", async function () {
    const { gb } = await deploy();
    await expect(gb.sign("")).to.be.revertedWithCustomError(gb, "EmptyMessage");
    await expect(gb.sign("x".repeat(281))).to.be.revertedWithCustomError(gb, "MessageTooLong");
  });
});
