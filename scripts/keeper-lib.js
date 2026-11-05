// Keeper logic for ETN Savings Circles: draws payout orders, settles rounds that are due and produces
// reminder / announcement messages. Stateless, so it can run on a schedule
// (e.g. every 15 minutes on GitHub Actions) without a database.
const { ethers } = require("ethers");

const STATUS = ["Forming", "Active", "Completed", "Cancelled", "Drawing"];

const fmt = (wei) => {
  const s = ethers.formatEther(wei);
  const [i, d = ""] = s.split(".");
  const dd = d.replace(/0+$/, "").slice(0, 4);
  return `${dd ? `${i}.${dd}` : i} ETN`;
};
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
// Circle names and nicknames are chosen by anyone. Before they go into a public channel,
// drop anything Telegram would turn into a link or mention (URLs, domains, @handles),
// so the bot can't be used to post phishing links.
const LINKY = /https?:|www\.|t\.me|[\p{L}\p{N}-]\s*[.\u3002]\s*[a-z]{2,}\b|@\w/iu;
const safeText = (s, fallback) => {
  const t = String(s ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim();
  return !t || LINKY.test(t) ? fallback : t;
};
const label = (addr, nick) => safeText(nick, short(addr));
function humanLeft(sec) {
  if (sec >= 86400) return `${Math.round(sec / 3600)} hours`;
  if (sec >= 3600) return `${Math.round(sec / 360) / 10} hours`;
  return `${Math.max(1, Math.round(sec / 60))} minutes`;
}

/** Reminder threshold for a round: 24h before the deadline, or 25% of the round for short rounds. */
function reminderLead(roundDuration) {
  return Math.min(24 * 3600, Math.floor(roundDuration / 4));
}

/**
 * @param {object} opts
 * @param {ethers.Contract} opts.contract  SavingsCircles contract connected to a signer (or a provider for dryRun)
 * @param {number} [opts.now]              unix time used for decisions (defaults to latest block time)
 * @param {number} [opts.interval]         seconds between runs; reminders fire once per crossing of the threshold
 * @param {boolean} [opts.dryRun]          don't send transactions
 * @param {string} [opts.appUrl]           base URL used in messages
 * @param {number} [opts.lookback]         how many of the newest circles to scan
 * @returns {Promise<{drawn: object[], settled: object[], reminders: object[], messages: string[], scanned: number}>}
 */
async function runKeeper({ contract, now, interval = 900, dryRun = false, appUrl = "", lookback = 500 }) {
  const runner = contract.runner;
  const provider = runner.provider ?? runner;
  if (now === undefined) now = (await provider.getBlock("latest")).timestamp;
  const count = Number(await contract.circleCount());
  const block = await provider.getBlockNumber();
  const out = { drawn: [], settled: [], reminders: [], messages: [], scanned: 0 };
  const link = (id) => (appUrl ? `${appUrl.replace(/\/$/, "")}/#/circle/${id}` : `circle #${id}`);

  for (let id = Math.max(0, count - lookback); id < count; id++) {
    const c = await contract.getCircle(id);
    const status = STATUS[Number(c.status)];
    if (status === "Drawing") {
      if (block <= Number(await contract.drawBlockOf(id))) continue; // committed block not mined yet
      const title = safeText(c.name, `Circle #${id}`);
      if (dryRun) {
        out.drawn.push({ id, dryRun: true });
        out.messages.push(`[dry run] would draw the payout order of "${title}"`);
        continue;
      }
      try {
        await contract.drawOrder.staticCall(id);
        const tx = await contract.drawOrder(id);
        await tx.wait();
        const after = await contract.getMemberDetails(id);
        if (STATUS[Number((await contract.getCircle(id)).status)] !== "Active") continue; // block expired: recommitted
        out.drawn.push({ id, tx: tx.hash });
        out.messages.push(`🎲 "${title}" is full and the payout order has been drawn. First pot goes to ${label(after.addrs[0], after.nicknames[0])}. ${link(id)}`);
      } catch (e) {
        out.messages.push(`❌ Could not draw the payout order of "${title}": ${e.shortMessage || e.message}`);
      }
      continue;
    }
    if (status !== "Active") continue;
    out.scanned++;
    const d = await contract.getMemberDetails(id);
    const n = d.addrs.length;
    const paid = Number(c.paidCount);
    const deadline = Number(c.roundDeadline);
    const round = Number(c.round);
    const pot = c.contribution * BigInt(n);
    const recipient = label(d.addrs[round], d.nicknames[round]);
    const title = safeText(c.name, `Circle #${id}`);

    if (paid === n || now >= deadline) {
      const missed = d.addrs.map((a, i) => (!d.paidThisRound[i] ? label(a, d.nicknames[i]) : null)).filter(Boolean);
      if (dryRun) {
        out.settled.push({ id, round, dryRun: true });
        out.messages.push(`[dry run] would settle "${title}" round ${round + 1}`);
        continue;
      }
      try {
        await contract.settleRound.staticCall(id);
        const tx = await contract.settleRound(id);
        const receipt = await tx.wait();
        const names = receipt.logs.map((l) => { try { return contract.interface.parseLog(l)?.name; } catch { return null; } });
        const dissolved = names.includes("CircleCancelled");
        const completed = names.includes("CircleCompleted");
        out.settled.push({ id, round, tx: tx.hash, dissolved, completed });
        if (dissolved) out.messages.push(`⚠️ "${title}" was dissolved after a repeat missed payment. This round's payments and unused deposits were refunded. ${link(id)}`);
        else {
          let m = `✅ "${title}" round ${round + 1} settled: ${fmt(pot)} sent to ${recipient}.`;
          if (missed.length) m += ` Covered by deposit: ${missed.join(", ")}.`;
          if (completed) m += ` 🏁 The circle is complete and every member earned a badge.`;
          out.messages.push(`${m} ${link(id)}`);
        }
      } catch (e) {
        out.messages.push(`❌ Could not settle "${title}" round ${round + 1}: ${e.shortMessage || e.message}`);
      }
      continue;
    }

    const left = deadline - now;
    const lead = reminderLead(Number(c.roundDuration));
    if (left <= lead && left > lead - interval) {
      const unpaid = d.addrs.map((a, i) => (!d.paidThisRound[i] ? label(a, d.nicknames[i]) : null)).filter(Boolean);
      out.reminders.push({ id, round, unpaid });
      out.messages.push(`⏰ "${title}" round ${round + 1} closes in ${humanLeft(left)}. ${paid}/${n} paid. Still to pay ${fmt(c.contribution)}: ${unpaid.join(", ")}. ${link(id)}`);
    }
  }
  return out;
}

async function sendTelegram(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

module.exports = { runKeeper, reminderLead, sendTelegram, safeText };
