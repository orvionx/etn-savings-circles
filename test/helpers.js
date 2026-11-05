const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

const coder = ethers.AbiCoder.defaultAbiCoder();

/** A fixed test secret for a member of a circle. */
function secretOf(id, who) {
  return ethers.keccak256(coder.encode(["string", "uint256", "address"], ["secret", id, who.address]));
}
function commitOf(id, who) {
  return ethers.keccak256(coder.encode(["uint256", "address", "bytes32"], [id, who.address, secretOf(id, who)]));
}

/** Every member reveals, then mines past the committed block and draws. Returns the order. */
async function draw(sc, id, wallets = null) {
  const signers = wallets || (await ethers.getSigners());
  for (const a of (await sc.getCircle(id)).members) {
    const w = signers.find((s) => s.address === a);
    await sc.connect(w).reveal(id, secretOf(id, w));
  }
  await mine(Number(await sc.DRAW_DELAY()) + 1);
  await sc.drawOrder(id);
  return (await sc.getCircle(id)).members;
}

/** `signers` sorted into the drawn payout order of circle `id`. */
async function inPayoutOrder(sc, id, signers) {
  const order = (await sc.getCircle(id)).members;
  return order.map((a) => signers.find((s) => s.address === a));
}

/** Expected order, computed independently of the contract. */
function expectedOrder(revealers, others, secrets, hash, id) {
  let xor = 0n;
  for (const [a, sec] of secrets) xor ^= BigInt(ethers.keccak256(coder.encode(["address", "bytes32"], [a, sec])));
  const revealSeed = ethers.zeroPadValue(ethers.toBeHex(xor), 32);
  const seed = ethers.keccak256(coder.encode(["bytes32", "bytes32", "uint256"], [revealSeed, hash, id]));
  const shuffle = (list, offset) => {
    const a = [...list];
    for (let i = a.length; i > 1; i--) {
      const j = Number(BigInt(ethers.keccak256(coder.encode(["bytes32", "uint256"], [seed, i + offset]))) % BigInt(i));
      [a[i - 1], a[j]] = [a[j], a[i - 1]];
    }
    return a;
  };
  return [...shuffle(revealers, 0), ...shuffle(others, revealers.length)];
}

module.exports = { draw, inPayoutOrder, expectedOrder, secretOf, commitOf };
