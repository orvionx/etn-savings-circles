const fs = require("fs");
const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network:  ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETN`);

  const sc = await ethers.deployContract("SavingsCircles");
  console.log(`Tx hash:  ${sc.deploymentTransaction().hash}`);
  await sc.waitForDeployment();
  const address = await sc.getAddress();
  console.log(`SavingsCircles deployed at: ${address}`);

  const file = "deployments.json";
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  all[network.name] = { ...(all[network.name] || {}), SavingsCircles: address, deployTx: sc.deploymentTransaction().hash };
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
