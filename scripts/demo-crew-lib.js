// Demo crew: five testnet wallets that keep a clearly labelled demo circle running,
// so the live app and the Telegram channel always show real on-chain activity.
//
// The wallets are derived from a secret (the keeper key), so no extra secret is needed
// and every scheduled run controls the same addresses. Each run:
//   1. tops up crew wallets that run low (from the funder wallet)
//   2. starts a new demo circle when the crew has none running, and draws its payout order
//   3. pays this round's contributions on a staggered schedule, so reminders and
//      late payers show up naturally before the keeper settles the round
//   4. withdraws any payouts back into the crew wallets
const { ethers } = require("ethers");

const CREW = ["Ada", "Bola", "Chidi", "Dayo", "Efe"];
const CIRCLE_NAME = "Demo: Lagos Traders Ajo";
// When each member pays, as a fraction of the round (rotated every round).
const SCHEDULE = [0.05, 0.2, 0.4, 0.6, 0.85];
const DEFAULTS = {
  contribution: ethers.parseEther("0.05"),
  roundDuration: 24 * 3600,
  minBalance: ethers.parseEther("0.08"),
  topUp: ethers.parseEther("0.15"),
};

/** Deterministic crew wallets derived from a 32-byte hex secret. */
function crewWallets(secret, provider) {
  return CREW.map((_, i) => new ethers.Wallet(
    ethers.keccak256(ethers.solidityPacked(["bytes32", "string"], [secret, `etn-savings-demo-crew-${i}`])),
    provider,
  ));
}

/** Each crew member's secret for a circle, recomputed on every run instead of stored. */
function crewSecret(wallet, id) {
  return ethers.keccak256(ethers.solidityPacked(["bytes32", "uint256"], [wallet.privateKey, id]));
}
function crewCommit(wallet, id) {
  return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "address", "bytes32"], [id, wallet.address, crewSecret(wallet, id)]));
}

/** Fraction of the round after which member `i` pays in round `round`. */
function payAt(i, round) {
  return SCHEDULE[(i + round) % SCHEDULE.length];
}

/**
 * @param {object} opts
 * @param {ethers.Contract} opts.contract   SavingsCircles contract (any runner; crew wallets sign their own txs)
 * @param {ethers.Wallet[]} opts.crew       crew wallets connected to a provider
 * @param {ethers.Signer}   [opts.funder]   tops up crew wallets that run low
 * @param {number}          [opts.now]      unix time for decisions (default: latest block time)
 * @param {string}          [opts.appUrl]   base URL used in messages
 * @param {boolean}         [opts.dryRun]   report only
 */
async function runDemoCrew({ contract, crew, funder, now, appUrl = "", dryRun = false, ...cfg }) {
  const { contribution, roundDuration, minBalance, topUp } = { ...DEFAULTS, ...cfg };
  const provider = crew[0].provider;
  if (now === undefined) now = (await provider.getBlock("latest")).timestamp;
  const out = { actions: [], messages: [], circle: null };
  const act = (s) => out.actions.push(dryRun ? `[dry run] ${s}` : s);
  const as = (w) => contract.connect(w);
  const send = async (label, fn) => { act(label); if (!dryRun) await (await fn()).wait(); };
  const link = (id) => (appUrl ? `${appUrl.replace(/\/$/, "")}/#/circle/${id}` : `circle #${id}`);

  // 1. top-ups
  if (funder) {
    for (const [i, w] of crew.entries()) {
      if ((await provider.getBalance(w.address)) < minBalance) {
        await send(`top up ${CREW[i]} with ${ethers.formatEther(topUp)} ETN`, () => funder.sendTransaction({ to: w.address, value: topUp }));
      }
    }
  }

  // 2. find the crew's running circle (forming, drawing or active), or start one
  const ids = (await contract.getUserCircles(crew[0].address)).map(Number);
  let id = null, c = null;
  for (const cid of ids.slice().reverse()) {
    const info = await contract.getCircle(cid);
    if (![2, 3].includes(Number(info.status)) && info.name.startsWith("Demo:")) { id = cid; c = info; break; }
  }
  if (id === null) {
    const run = ids.length + 1;
    const name = run > 1 ? `${CIRCLE_NAME} #${run}` : CIRCLE_NAME;
    id = Number(await contract.circleCount());
    await send(`create "${name}" (#${id})`, () => as(crew[0]).createCircle(name, crew.map((w) => w.address), contribution, roundDuration));
    out.messages.push(`🆕 New demo circle "${name}": ${crew.length} members save ${ethers.formatEther(contribution)} ETN a day and take turns collecting the pot. ${link(id)}`);
    if (dryRun) { out.circle = id; return out; }
    c = await contract.getCircle(id);
  }
  out.circle = id;

  // 3a. forming: everyone joins (the last join closes the circle)
  if (Number(c.status) === 0) {
    for (const [i, w] of crew.entries()) {
      const m = await contract.getMember(id, w.address);
      if (!m.joined) await send(`${CREW[i]} joins #${id}`, () => as(w).join(id, CREW[i], crewCommit(w, id), { value: c.contribution }));
    }
    if (dryRun) return out;
    c = await contract.getCircle(id);
  }

  // 3b. closed: reveal, then draw once the committed block exists (the keeper can draw too)
  if (Number(c.status) === 4) {
    const draw = await contract.getDraw(id);
    if (!Number(draw.drawBlock)) {
      const d = await contract.getMemberDetails(id);
      for (const [i, addr] of d.addrs.entries()) {
        const w = crew.find((x) => x.address === addr);
        if (w && !draw.revealed[i]) await send(`${d.nicknames[i]} reveals for #${id}`, () => as(w).reveal(id, crewSecret(w, id)));
      }
    }
  }
  if (Number(c.status) === 4 && Number((await contract.getDraw(id)).drawBlock)
    && (await provider.getBlockNumber()) > Number((await contract.getDraw(id)).drawBlock)) {
    await send(`draw the payout order of #${id}`, () => as(crew[0]).drawOrder(id));
    if (dryRun) return out;
    c = await contract.getCircle(id);
    now = (await provider.getBlock("latest")).timestamp;
  }

  // 3c. active: pay on the staggered schedule
  if (Number(c.status) === 1) {
    const deadline = Number(c.roundDeadline), duration = Number(c.roundDuration), round = Number(c.round);
    const progress = (now - (deadline - duration)) / duration;
    const d = await contract.getMemberDetails(id);
    for (const [i, addr] of d.addrs.entries()) {
      const w = crew.find((x) => x.address === addr);
      if (!w || d.paidThisRound[i] || now >= deadline) continue;
      if (progress >= payAt(i, round)) {
        await send(`${d.nicknames[i] || addr} pays round ${round + 1} of #${id}`, () => as(w).contribute(id, { value: c.contribution }));
      }
    }
  }

  // 4. collect payouts and refunds
  for (const [i, w] of crew.entries()) {
    if ((await contract.withdrawable(w.address)) > 0n) await send(`${CREW[i]} withdraws`, () => as(w).withdraw());
  }
  return out;
}

module.exports = { runDemoCrew, crewWallets, payAt, CREW, CIRCLE_NAME, DEFAULTS };
