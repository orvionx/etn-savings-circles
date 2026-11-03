// Seeds showcase circles on the deployed contract, using the deployer plus throwaway
// wallets (leftover ETN is returned to the deployer):
//   1. a completed circle (full lifecycle, all paid out)
//   2. an active circle mid-way (weekly rounds, so it stays live)
//   3. an open circle with free seats that anyone can join
//   4. a trusted open circle that requires 1+ completed circle
const fs = require("fs");
const { ethers, network } = require("hardhat");

const AMOUNT = ethers.parseEther("0.1");
const HOUR = 3600, WEEK = 7 * 24 * HOUR;

async function main() {
  const address = JSON.parse(fs.readFileSync("deployments.json", "utf8"))[network.name].SavingsCircles;
  const [deployer] = await ethers.getSigners();
  const sc = await ethers.getContractAt("SavingsCircles", address);
  const wallets = Array.from({ length: 3 }, () => ethers.Wallet.createRandom().connect(ethers.provider));
  const names = ["Amina", "Kofi", "Njeri", "Thabo"];
  const people = [deployer, ...wallets];
  const log = (s, tx) => console.log(`${s.padEnd(40)} ${tx.hash}`);
  const send = async (label, p) => { const tx = await p; await tx.wait(); log(label, tx); return tx; };
  const nextId = async () => Number(await sc.circleCount());

  for (const w of wallets) await send(`Fund ${w.address.slice(0, 10)}…`, deployer.sendTransaction({ to: w.address, value: ethers.parseEther("1") }));

  // 1. completed open circle
  let id = await nextId();
  await send(`#${id} create "Nairobi Market Chama"`, sc.createOpenCircle("Nairobi Market Chama", 4, AMOUNT, HOUR, 0));
  for (const [i, p] of people.entries()) await send(`#${id} ${names[i]} joins`, sc.connect(p).join(id, names[i], { value: AMOUNT }));
  for (let r = 0; r < 4; r++) {
    for (const [i, p] of people.entries()) await send(`#${id} round ${r + 1} ${names[i]} pays`, sc.connect(p).contribute(id, { value: AMOUNT }));
    await send(`#${id} settle round ${r + 1}`, sc.settleRound(id));
  }

  // 2. active invite-only circle, mid-way through round 2
  id = await nextId();
  await send(`#${id} create "Accra Family Susu"`, sc.createCircle("Accra Family Susu", people.map((p) => p.address), AMOUNT, WEEK));
  for (const [i, p] of people.entries()) await send(`#${id} ${names[i]} joins`, sc.connect(p).join(id, names[i], { value: AMOUNT }));
  for (const p of people) await sc.connect(p).contribute(id, { value: AMOUNT }).then((t) => t.wait());
  await send(`#${id} settle round 1`, sc.settleRound(id));
  for (const p of people.slice(0, 2)) await send(`#${id} round 2 payment`, sc.connect(p).contribute(id, { value: AMOUNT }));

  // 3. open circle with free seats
  id = await nextId();
  await send(`#${id} create "ETN Builders Circle"`, sc.createOpenCircle("ETN Builders Circle", 5, AMOUNT, WEEK, 0));
  await send(`#${id} Amina joins`, sc.connect(deployer).join(id, "Amina", { value: AMOUNT }));
  await send(`#${id} Kofi joins`, sc.connect(wallets[0]).join(id, "Kofi", { value: AMOUNT }));

  // 4. trusted open circle: only savers with 1+ completed circle and no defaults
  id = await nextId();
  await send(`#${id} create "Trusted Savers Club"`, sc.createOpenCircle("Trusted Savers Club", 4, AMOUNT, WEEK, 1));
  await send(`#${id} Amina joins`, sc.connect(deployer).join(id, "Amina", { value: AMOUNT }));

  // collect payouts and return leftovers
  for (const p of people) if ((await sc.withdrawable(p.address)) > 0n) await send(`Withdraw ${p.address.slice(0, 10)}…`, sc.connect(p).withdraw());
  const gasPrice = (await ethers.provider.getFeeData()).gasPrice;
  for (const w of wallets) {
    const bal = await ethers.provider.getBalance(w.address);
    const fee = gasPrice * 21000n * 2n;
    if (bal > fee) await send(`Return funds ${w.address.slice(0, 10)}…`, w.sendTransaction({ to: deployer.address, value: bal - fee, gasLimit: 21000 }));
  }
  console.log(`\nCircles: ${await sc.circleCount()} · paid out ${ethers.formatEther(await sc.totalPaidOut())} ETN · rounds ${await sc.roundsSettled()}`);
  console.log("Note: the throwaway wallets keep their deposits in circles #1 and #2 (0.3 ETN total), and badges from circle #0.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
