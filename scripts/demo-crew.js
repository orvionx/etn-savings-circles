#!/usr/bin/env node
// Runs the demo crew (see demo-crew-lib.js) once.
//
//   node scripts/demo-crew.js [--dry-run] [--addresses]
//
//   --dry-run    report only
//   --addresses  print the crew wallet addresses and balances, then exit
//
// Environment:
//   KEEPER_PRIVATE_KEY   derives the crew wallets and funds their top-ups (required)
//   RPC_URL, CONTRACT, APP_URL, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   as for keeper.js
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { runDemoCrew, crewWallets, CREW } = require("./demo-crew-lib");
const { sendTelegram } = require("./keeper-lib");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch {}

const ABI = require("../artifacts/contracts/SavingsCircles.sol/SavingsCircles.json").abi;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const key = process.env.KEEPER_PRIVATE_KEY;
  if (!key) throw new Error("KEEPER_PRIVATE_KEY is not set");
  const rpc = process.env.RPC_URL || "https://rpc.ankr.com/electroneum_testnet";
  const address = process.env.CONTRACT
    || JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments.json"), "utf8")).etnTestnet.SavingsCircles;
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { batchMaxCount: 8 });
  const funder = new ethers.Wallet(key, provider);
  const crew = crewWallets(funder.privateKey, provider);

  if (process.argv.includes("--addresses")) {
    for (const [i, w] of crew.entries()) console.log(`${CREW[i].padEnd(6)} ${w.address}  ${ethers.formatEther(await provider.getBalance(w.address))} ETN`);
    return;
  }

  const contract = new ethers.Contract(address, ABI, provider);
  const result = await runDemoCrew({
    contract, crew, funder, dryRun,
    appUrl: process.env.APP_URL || "https://etn-savings-circles.netlify.app",
  });
  console.log(`Demo crew · circle #${result.circle} · ${result.actions.length} action(s)`);
  for (const a of result.actions) console.log(`  ${a}`);

  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  if (!dryRun && token && chat) for (const m of result.messages) await sendTelegram(token, chat, m);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
