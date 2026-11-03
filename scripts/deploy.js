const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Network:  ${network.name} (chainId ${network.config.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETN`);
  if (balance === 0n) {
    throw new Error("Deployer has no ETN. Fund it from the testnet faucet first.");
  }

  const msg = "Hello from Electroneum Smart Chain!";
  const gb = await ethers.deployContract("Guestbook", [msg]);
  console.log(`Tx hash:  ${gb.deploymentTransaction().hash}`);
  await gb.waitForDeployment();
  const addr = await gb.getAddress();
  console.log(`Guestbook deployed at: ${addr}`);
  console.log(`Entries: ${await gb.count()}`);
  console.log(`Verify:  npx hardhat verify --network ${network.name} ${addr} "${msg}"`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
