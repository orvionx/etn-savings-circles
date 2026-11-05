const { ethers } = require("hardhat");
const { mine } = require("@nomicfoundation/hardhat-network-helpers");

/** Mines past a closed circle's committed block, draws the payout order and returns it. */
async function draw(sc, id) {
  await mine(Number(await sc.DRAW_DELAY()) + 1);
  await sc.drawOrder(id);
  return (await sc.getCircle(id)).members;
}

/** `signers` sorted into the drawn payout order of circle `id`. */
async function inPayoutOrder(sc, id, signers) {
  const order = (await sc.getCircle(id)).members;
  return order.map((a) => signers.find((s) => s.address === a));
}

/** Expected order for a given block hash, computed independently of the contract. */
function expectedOrder(members, hash, id) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const seed = ethers.keccak256(coder.encode(["bytes32", "uint256"], [hash, id]));
  const out = [...members];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Number(BigInt(ethers.keccak256(coder.encode(["bytes32", "uint256"], [seed, i]))) % BigInt(i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

module.exports = { draw, inPayoutOrder, expectedOrder };
