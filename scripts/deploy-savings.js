const fs = require("fs");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network:  ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETN`);

  const sc = await ethers.deployContract("SavingsCircles");
  const tx = sc.deploymentTransaction();
  console.log(`Tx hash:  ${tx.hash}`);
  await sc.waitForDeployment();
  const receipt = await tx.wait();
  const address = await sc.getAddress();
  console.log(`SavingsCircles deployed at: ${address} (block ${receipt.blockNumber})`);

  const file = "deployments.json";
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const prev = all[network.name] || {};
  const history = prev.history || (prev.SavingsCircles ? [{ SavingsCircles: prev.SavingsCircles, deployTx: prev.deployTx }] : []);
  all[network.name] = { SavingsCircles: address, deployTx: tx.hash, deployBlock: receipt.blockNumber, history: [...history, { SavingsCircles: address, deployTx: tx.hash, deployBlock: receipt.blockNumber }] };
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
