#!/usr/bin/env node
// Savings Circles keeper: settles due rounds and posts reminders.
//
//   node scripts/keeper.js [--dry-run] [--ping]
//
//   --dry-run  report only, don't send transactions or event messages
//   --ping     also post a status check-in to Telegram (to verify the setup)
//
// Environment:
//   KEEPER_PRIVATE_KEY   wallet that pays gas for settleRound (required unless --dry-run)
//   RPC_URL              default: ETN testnet public RPC
//   CONTRACT             default: SavingsCircles address from deployments.json (etnTestnet)
//   APP_URL              default: https://etn-savings-circles.netlify.app
//   KEEPER_INTERVAL      seconds between scheduled runs (default 900), used for reminder timing
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   optional: post messages to a Telegram chat
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { runKeeper, sendTelegram } = require("./keeper-lib");
try { require("dotenv").config({ path: path.join(__dirname, "..", ".env") }); } catch {}

const ABI = require("../artifacts/contracts/SavingsCircles.sol/SavingsCircles.json").abi;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const ping = process.argv.includes("--ping"); // always post a status message to Telegram
  let balance = null;
  const rpc = process.env.RPC_URL || "https://rpc.ankr.com/electroneum_testnet";
  let address = process.env.CONTRACT;
  if (!address) {
    const file = path.join(__dirname, "..", "deployments.json");
    address = JSON.parse(fs.readFileSync(file, "utf8")).etnTestnet.SavingsCircles;
  }
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { batchMaxCount: 8 });
  let runner = provider;
  if (!dryRun) {
    const key = process.env.KEEPER_PRIVATE_KEY;
    if (!key) throw new Error("KEEPER_PRIVATE_KEY is not set (use --dry-run to only report)");
    runner = new ethers.Wallet(key, provider);
    const bal = await provider.getBalance(runner.address);
    balance = bal;
    console.log(`Keeper ${runner.address} · balance ${ethers.formatEther(bal)} ETN`);
    if (bal < ethers.parseEther("0.01")) console.warn("Warning: keeper balance is low; top it up to keep settling rounds.");
  }
  const contract = new ethers.Contract(address, ABI, runner);
  const result = await runKeeper({
    contract, dryRun,
    interval: Number(process.env.KEEPER_INTERVAL || 900),
    appUrl: process.env.APP_URL || "https://etn-savings-circles.netlify.app",
  });

  console.log(`Contract ${address} · active circles scanned: ${result.scanned} · settled: ${result.settled.length} · reminders: ${result.reminders.length}`);
  for (const m of result.messages) console.log(`  ${m}`);

  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = process.env;
  const posts = dryRun ? [] : [...result.messages];
  if (ping) {
    const bal = balance === null ? "" : ` Keeper balance: ${Number(ethers.formatEther(balance)).toFixed(3)} ETN.`;
    posts.push(`🟢 Keeper check-in: ${result.scanned} active circle(s) watched, ${result.settled.length} settled, ${result.reminders.length} reminder(s) this run.${bal}${dryRun ? " (dry run)" : ""}`);
    if (!token || !chat) {
      console.error("--ping needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; check the repository secrets.");
      process.exitCode = 1;
      return;
    }
  }
  if (token && chat && posts.length) {
    for (const m of posts) await sendTelegram(token, chat, m);
    console.log(`Posted ${posts.length} message(s) to Telegram.`);
  }
  if (result.messages.some((m) => m.startsWith("❌"))) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
