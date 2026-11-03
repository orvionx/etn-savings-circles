// Runs a complete 3-member savings circle on the deployed contract, using the deployer
// plus two throwaway wallets. Leftover ETN is returned to the deployer at the end.
const fs = require("fs");
const { ethers, network } = require("hardhat");

const CONTRIBUTION = ethers.parseEther("0.1");

async function main() {
  const address = JSON.parse(fs.readFileSync("deployments.json", "utf8"))[network.name].SavingsCircles;
  const [deployer] = await ethers.getSigners();
  const sc = await ethers.getContractAt("SavingsCircles", address);
  const wallets = [ethers.Wallet.createRandom(), ethers.Wallet.createRandom()].map((w) => w.connect(ethers.provider));
  const members = [deployer, ...wallets];
  const log = (s, tx) => console.log(tx ? `${s.padEnd(34)} ${tx.hash}` : s);

  for (const w of wallets) {
    const tx = await deployer.sendTransaction({ to: w.address, value: ethers.parseEther("0.5") });
    await tx.wait(); log(`Fund ${w.address.slice(0, 10)}…`, tx);
  }

  const id = await sc.circleCount();
  let tx = await sc.createCircle("ETN Demo Chama", members.map((m) => m.address), CONTRIBUTION, 3600);
  await tx.wait(); log(`Create circle #${id}`, tx);

  for (const m of members) {
    tx = await sc.connect(m).join(id, { value: CONTRIBUTION });
    await tx.wait(); log(`Join ${m.address.slice(0, 10)}…`, tx);
  }

  for (let r = 0; r < members.length; r++) {
    for (const m of members) {
      tx = await sc.connect(m).contribute(id, { value: CONTRIBUTION });
      await tx.wait(); log(`Round ${r} contribute ${m.address.slice(0, 10)}…`, tx);
    }
    tx = await sc.settleRound(id);
    await tx.wait(); log(`Round ${r} settle → ${members[r].address.slice(0, 10)}…`, tx);
  }

  for (const m of members) {
    tx = await sc.connect(m).withdraw();
    await tx.wait(); log(`Withdraw ${m.address.slice(0, 10)}…`, tx);
  }

  const c = await sc.getCircle(id);
  console.log(`Circle #${id} status: ${["Forming", "Active", "Completed", "Cancelled"][Number(c.status)]}`);
  console.log(`Contract balance: ${ethers.formatEther(await ethers.provider.getBalance(address))} ETN`);

  for (const w of wallets) {
    const bal = await ethers.provider.getBalance(w.address);
    const fee = (await ethers.provider.getFeeData()).gasPrice * 21000n * 2n;
    if (bal > fee) {
      tx = await w.sendTransaction({ to: deployer.address, value: bal - fee, gasLimit: 21000 });
      await tx.wait(); log(`Return funds from ${w.address.slice(0, 10)}…`, tx);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
