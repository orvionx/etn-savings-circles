import { ethers } from "./vendor/ethers.min.js";
import { getConfig } from "./config.js";

// ===================================================================== setup
const CFG = getConfig();
const ABI = [
  "function circleCount() view returns (uint256)",
  "function totalPaidOut() view returns (uint256)",
  "function roundsSettled() view returns (uint256)",
  "function circlesCompleted() view returns (uint256)",
  "function withdrawable(address) view returns (uint256)",
  "function createCircle(string name, address[] members, uint128 contribution, uint64 roundDuration) returns (uint256)",
  "function createOpenCircle(string name, uint32 size, uint128 contribution, uint64 roundDuration, uint32 minCompleted) returns (uint256)",
  "function join(uint256 id, string nickname) payable",
  "function leave(uint256 id)",
  "function cancelForming(uint256 id)",
  "function setNickname(uint256 id, string nickname)",
  "function contribute(uint256 id) payable",
  "function settleRound(uint256 id)",
  "function withdraw()",
  "function getCircle(uint256 id) view returns (address creator, string name, uint256 contribution, uint64 roundDuration, uint64 roundDeadline, uint32 round, uint32 size, uint32 joinedCount, uint32 paidCount, uint8 status, bool open, address[] members)",
  "function getMemberDetails(uint256 id) view returns (address[] addrs, string[] nicknames, bool[] joined, bool[] paidThisRound, bool[] depositUsed, uint32[] defaults)",
  "function getUserCircles(address account) view returns (uint256[])",
  "function getReputation(address account) view returns (uint32 joined, uint32 completed, uint32 onTimePayments, uint32 missedPayments, uint32 defaulted)",
  "function requirementOf(uint256 id) view returns (uint32)",
  "function isEligible(uint256 id, address account) view returns (bool)",
  "function badges() view returns (address)",
  "event BadgeAwarded(uint256 indexed id, address indexed member, uint256 tokenId)",
  "event CircleCreated(uint256 indexed id, address indexed creator, string name, bool open, uint32 size, uint256 contribution, uint64 roundDuration, uint32 minCompleted)",
  "event MemberJoined(uint256 indexed id, address indexed member, string nickname)",
  "event MemberLeft(uint256 indexed id, address indexed member)",
  "event NicknameSet(uint256 indexed id, address indexed member, string nickname)",
  "event CircleStarted(uint256 indexed id, uint64 firstDeadline)",
  "event Contributed(uint256 indexed id, uint32 indexed round, address indexed member)",
  "event DepositUsed(uint256 indexed id, uint32 indexed round, address indexed member)",
  "event RoundSettled(uint256 indexed id, uint32 indexed round, address indexed recipient, uint256 pot)",
  "event CircleCompleted(uint256 indexed id)",
  "event CircleCancelled(uint256 indexed id, uint32 round, address indexed defaulter)",
  "event Withdrawn(address indexed account, uint256 amount)",
  "error InvalidMemberCount()", "error InvalidContribution()", "error InvalidDuration()", "error InvalidName()",
  "error NicknameTooLong()", "error DuplicateMember(address member)", "error ZeroAddressMember()", "error UnknownCircle()",
  "error WrongStatus()", "error NotInvited()", "error NotMember()", "error AlreadyJoined()", "error WrongAmount()",
  "error NotCreator()", "error AlreadyPaid()", "error RoundClosed()", "error RoundStillOpen()",
  "error NothingToWithdraw()", "error TransferFailed()", "error Reentrancy()", "error NotEligible()", "error InvalidRequirement()",
];
const ERROR_TEXT = {
  InvalidMemberCount: "A circle needs between 2 and 50 members.",
  InvalidContribution: "Contribution must be more than 0.",
  InvalidDuration: "Round length must be between 1 minute and 1 year.",
  InvalidName: "The circle name must be 1–64 characters.",
  NicknameTooLong: "Nicknames can be at most 32 characters.",
  DuplicateMember: "The same address is listed twice.",
  ZeroAddressMember: "One of the addresses is the zero address.",
  UnknownCircle: "That circle doesn't exist.",
  WrongStatus: "The circle has moved on. Refresh and try again.",
  NotInvited: "Your wallet isn't on this circle's member list.",
  NotMember: "Your wallet isn't a member of this circle.",
  AlreadyJoined: "You've already joined this circle.",
  WrongAmount: "Wrong amount sent.",
  NotCreator: "Only the circle creator can do that.",
  AlreadyPaid: "You've already paid this round.",
  RoundClosed: "This round's deadline has passed. Settle the round first.",
  RoundStillOpen: "The round can be settled once everyone has paid or the deadline passes.",
  NothingToWithdraw: "Nothing to collect yet.",
  TransferFailed: "The transfer failed.",
  NotEligible: "This circle requires a savings track record you don't have yet.",
  InvalidRequirement: "That track-record requirement isn't allowed.",
};
const STATUS = ["Forming", "Active", "Completed", "Cancelled"];
const BADGE_ABI = [
  "function totalSupply() view returns (uint256)",
  "function tokensOf(address owner) view returns (uint256[])",
  "function tokenURI(uint256 tokenId) view returns (string)",
];
const REQUIREMENTS = [[0, "Anyone"], [1, "1+ completed circle"], [3, "3+ completed circles"]];
const DURATIONS = [[300, "5 min", "demo"], [3600, "1 hour"], [86400, "1 day"], [604800, "1 week"], [1209600, "2 weeks"], [2592000, "1 month"]];
const AMOUNT_CHIPS = ["1", "5", "10", "50", "100"];

// Public RPCs reject large JSON-RPC batches (HTTP 413), so keep batches small.
const readProvider = new ethers.JsonRpcProvider(CFG.rpc, CFG.chainId, { staticNetwork: true, batchMaxCount: 8 });
const reader = new ethers.Contract(CFG.contract, ABI, readProvider);
const iface = reader.interface;

const state = {
  account: null, signer: null, chainOk: false, balance: 0n, withdrawable: 0n,
  tab: null, explore: null, mine: null, stats: null,
};

// ===================================================================== helpers
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const same = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const now = () => Math.floor(Date.now() / 1000);
const txUrl = (h) => `${CFG.explorer}/tx/${h}`;
const addrUrl = (a) => `${CFG.explorer}/address/${a}`;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

function fmtNum(x, max = 4) {
  if (x >= 1e6) return (x / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M";
  if (x >= 1e4) return x.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return x.toLocaleString(undefined, { maximumFractionDigits: max });
}
const etn = (wei) => Number(ethers.formatEther(wei));
const fmt = (wei) => `${fmtNum(etn(wei))} ETN`;

function hueOf(addr) { return parseInt(addr.slice(2, 8), 16) % 360; }
function avatarBg(addr) { const h = hueOf(addr); return `linear-gradient(135deg, hsl(${h} 75% 58%), hsl(${(h + 50) % 360} 70% 45%))`; }
function nameOf(m) { return m.nickname?.trim() || short(m.address); }
function initial(m) { const n = m.nickname?.trim(); return n ? [...n][0] : m.address.slice(2, 3); }
function avatar(m, cls = "") { return `<span class="av ${cls}" style="background:${avatarBg(m.address)}" title="${esc(nameOf(m))}">${esc(initial(m))}</span>`; }

// Savings score: transparent, computed from on-chain reputation (see README).
function scoreOf(r) {
  if (!r || r.completed + r.onTimePayments + r.missedPayments + r.defaulted === 0) return null;
  const v = 300 + 150 * r.completed + 4 * r.onTimePayments - 40 * r.missedPayments - 300 * r.defaulted;
  return Math.max(0, Math.min(1000, v));
}
function tierOf(r) {
  const sc = scoreOf(r);
  if (sc === null) return { name: "New saver", cls: "new", score: null };
  if (r.defaulted) return { name: "At risk", cls: "risk", score: sc };
  if (sc >= 850) return { name: "Gold saver", cls: "gold", score: sc };
  if (sc >= 650) return { name: "Silver saver", cls: "silver", score: sc };
  return { name: "Bronze saver", cls: "bronze", score: sc };
}
function scoreChip(r) {
  const t = tierOf(r);
  return `<span class="score-chip ${t.cls}" title="${t.name}">${t.score === null ? "New" : "★ " + t.score}</span>`;
}
function gaugeSVG(r) {
  const t = tierOf(r), R = 70, circ = Math.PI * R; // half circle
  const frac = t.score === null ? 0 : t.score / 1000;
  return `<svg viewBox="0 0 180 110" class="gauge" role="img" aria-label="Savings score ${t.score ?? "none"}">
    <defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#00c08b"/><stop offset=".55" stop-color="#1fb6ff"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>
    <path d="M20 95 A70 70 0 0 1 160 95" fill="none" stroke="var(--ring-track)" stroke-width="14" stroke-linecap="round"/>
    <path d="M20 95 A70 70 0 0 1 160 95" fill="none" stroke="url(#gg)" stroke-width="14" stroke-linecap="round" stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - frac)}" style="transition:stroke-dashoffset .8s ease"/>
    <text x="90" y="82" text-anchor="middle" style="font:800 34px var(--font-display);fill:var(--text)">${t.score ?? "—"}</text>
    <text x="90" y="104" text-anchor="middle" style="font:600 11px var(--font);fill:var(--muted);letter-spacing:.06em">${t.name.toUpperCase()}</text></svg>`;
}
const repCache = new Map();
async function loadReputation(addr) {
  const k = addr.toLowerCase();
  if (!repCache.has(k)) {
    repCache.set(k, reader.getReputation(addr).then((r) => ({
      joined: Number(r.joined), completed: Number(r.completed), onTimePayments: Number(r.onTimePayments),
      missedPayments: Number(r.missedPayments), defaulted: Number(r.defaulted),
    })).catch((e) => { repCache.delete(k); throw e; }));
  }
  return repCache.get(k);
}
let badgeReader = null;
async function getBadgeReader() {
  if (!badgeReader) badgeReader = new ethers.Contract(await reader.badges(), BADGE_ABI, readProvider);
  return badgeReader;
}
async function loadBadges(addr) {
  const b = await getBadgeReader();
  const ids = [...(await b.tokensOf(addr))].reverse();
  return Promise.all(ids.map(async (id) => {
    const uri = await b.tokenURI(id);
    const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(uri.split(",")[1]), (ch) => ch.charCodeAt(0))));
    return { id: Number(id), ...json, attrs: Object.fromEntries((json.attributes || []).map((a) => [a.trait_type, a.value])) };
  }));
}

function humanDuration(sec) {
  const hit = DURATIONS.find(([s]) => s === sec); if (hit) return hit[1];
  if (sec % 86400 === 0) return `${sec / 86400} days`; if (sec % 3600 === 0) return `${sec / 3600} hours`; return `${Math.round(sec / 60)} min`;
}
function countdown(ts) {
  let d = ts - now(); if (d <= 0) return "Deadline passed";
  const days = Math.floor(d / 86400); d %= 86400; const h = Math.floor(d / 3600); d %= 3600; const m = Math.floor(d / 60); const s = d % 60;
  if (days) return `${days}d ${h}h left`; if (h) return `${h}h ${m}m left`; return `${m}m ${String(s).padStart(2, "0")}s left`;
}
function relTime(ts) {
  const d = now() - ts; if (d < 60) return "just now"; if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`; return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function dateIn(ts) { return new Date(ts * 1000).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }

// ===================================================================== toasts, errors, confetti, modal
function toast(html, { kind = "", spin = false, ttl = 6000 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${spin ? '<span class="spin"></span>' : ""}<div>${html}</div><button class="x" aria-label="Dismiss">×</button>`;
  el.querySelector(".x").onclick = () => el.remove();
  $("#toasts").append(el);
  if (ttl) setTimeout(() => el.remove(), ttl);
  return el;
}
function friendlyError(e) {
  if (e?.code === "ACTION_REJECTED" || e?.code === 4001 || e?.info?.error?.code === 4001) return "You cancelled the request in your wallet.";
  if (e?.code === "INSUFFICIENT_FUNDS") return "Not enough ETN in your wallet to cover this and the network fee.";
  let name = e?.revert?.name;
  if (!name) {
    const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
    const hex = typeof data === "string" ? data : data?.data;
    if (hex) { try { name = iface.parseError(hex)?.name; } catch {} }
  }
  if (name && ERROR_TEXT[name]) return ERROR_TEXT[name];
  return e?.shortMessage || e?.message || "Something went wrong.";
}
function confetti() {
  if (reduceMotion) return;
  const box = document.createElement("div"); box.className = "confetti";
  const colors = ["#00c08b", "#1fb6ff", "#7c5cff", "#ffc94d", "#ff6b9a"];
  for (let i = 0; i < 110; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "vw";
    p.style.background = colors[i % colors.length];
    p.style.setProperty("--dx", (Math.random() * 40 - 20) + "vw");
    p.style.setProperty("--rot", (Math.random() * 1080 - 540) + "deg");
    p.style.animationDuration = 1.8 + Math.random() * 1.6 + "s";
    p.style.animationDelay = Math.random() * .4 + "s";
    if (i % 3 === 0) { p.style.borderRadius = "50%"; p.style.width = p.style.height = "8px"; }
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4200);
}
function openModal(html) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-bg" data-close><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const bg = root.firstElementChild;
  bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-close-btn]")) closeModal(); });
  document.addEventListener("keydown", escClose);
  return bg.firstElementChild;
}
function escClose(e) { if (e.key === "Escape") closeModal(); }
function closeModal() { $("#modal-root").innerHTML = ""; document.removeEventListener("keydown", escClose); }

// Rough upper bound for one transaction's network fee on ETN (about 300k gas).
const FEE_MARGIN = ethers.parseEther("0.005");
/** Returns true if the wallet can pay `value` plus fees; otherwise explains and returns false. */
function haveFunds(value, what) {
  if (!state.account || !state.chainOk) return true; // sendTx connects / switches network first
  const need = value + FEE_MARGIN;
  if (state.balance >= need) return true;
  const faucet = CFG.faucet ? ` <a href="${CFG.faucet}" target="_blank" rel="noopener">Get test ETN from the faucet</a>.` : "";
  toast(`${esc(what)} needs about <b>${fmt(need)}</b> including the network fee, but your wallet has <b>${fmt(state.balance)}</b>.${faucet}`, { kind: "error", ttl: 12000 });
  return false;
}

async function sendTx(label, fn, { celebrate = false } = {}) {
  if (!state.signer) { await connect(); if (!state.signer) return false; }
  const pending = toast(`${esc(label)}: confirm in your wallet…`, { spin: true, ttl: 0 });
  try {
    const tx = await fn(new ethers.Contract(CFG.contract, ABI, state.signer));
    pending.querySelector("div").innerHTML = `${esc(label)}: confirming on-chain… <a href="${txUrl(tx.hash)}" target="_blank" rel="noopener">view</a>`;
    const receipt = await tx.wait();
    pending.remove();
    toast(`✓ ${esc(label)} done. <a href="${txUrl(tx.hash)}" target="_blank" rel="noopener">View transaction</a>`, { ttl: 8000 });
    if (celebrate) confetti();
    state.explore = state.mine = state.stats = null;
    await refreshAccount(false);
    return receipt;
  } catch (e) {
    pending.remove();
    console.error(e);
    toast(esc(friendlyError(e)), { kind: "error", ttl: 9000 });
    return false;
  }
}

// ===================================================================== wallet
const CHAIN_HEX = "0x" + CFG.chainId.toString(16);
async function ensureChain() {
  const current = await window.ethereum.request({ method: "eth_chainId" });
  if (parseInt(current, 16) === CFG.chainId) return true;
  try {
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
  } catch (e) {
    if (e?.code === 4902 || e?.data?.originalError?.code === 4902) {
      await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
        chainId: CHAIN_HEX, chainName: CFG.name, rpcUrls: [CFG.rpc],
        nativeCurrency: { name: "Electroneum", symbol: "ETN", decimals: 18 }, blockExplorerUrls: [CFG.explorer],
      }] });
    } else throw e;
  }
  return parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16) === CFG.chainId;
}
async function connect() {
  if (!window.ethereum) {
    openModal(`<h3>Connect a wallet</h3>
      <p class="muted small">You need an EVM wallet such as MetaMask. On a phone, open this page inside your wallet app's built-in browser.</p>
      <div class="stack"><a class="btn primary block" href="https://metamask.io/download/" target="_blank" rel="noopener">Get MetaMask</a>
      <button class="btn secondary block" data-close-btn>Keep browsing</button></div>`);
    return;
  }
  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await syncWallet(true);
  } catch (e) { toast(esc(friendlyError(e)), { kind: "error" }); }
}
async function syncWallet(switchChain = false) {
  if (!window.ethereum) return;
  const accounts = await window.ethereum.request({ method: "eth_accounts" });
  if (!accounts.length) { Object.assign(state, { account: null, signer: null, chainOk: false, mine: null }); return route(); }
  if (switchChain) { try { await ensureChain(); } catch (e) { toast(esc(friendlyError(e)), { kind: "error" }); } }
  const chainId = parseInt(await window.ethereum.request({ method: "eth_chainId" }), 16);
  state.chainOk = chainId === CFG.chainId;
  const bp = new ethers.BrowserProvider(window.ethereum, "any");
  const acct = ethers.getAddress(accounts[0]);
  if (!same(acct, state.account)) state.mine = null;
  state.account = acct;
  state.signer = state.chainOk ? await bp.getSigner(state.account) : null;
  await refreshAccount();
}
async function refreshAccount(reroute = true) {
  if (state.account) {
    try {
      [state.balance, state.withdrawable] = await Promise.all([readProvider.getBalance(state.account), reader.withdrawable(state.account)]);
    } catch {}
  }
  if (reroute) await route(); else await route({ keepScroll: true });
}
if (window.ethereum?.on) {
  window.ethereum.on("accountsChanged", () => syncWallet());
  window.ethereum.on("chainChanged", () => syncWallet());
}

// ===================================================================== data
async function loadCircle(id) {
  id = Number(id);
  const [c, d, req] = await Promise.all([reader.getCircle(id), reader.getMemberDetails(id), reader.requirementOf(id)]);
  return {
    id, creator: c.creator, name: c.name, contribution: c.contribution, roundDuration: Number(c.roundDuration),
    deadline: Number(c.roundDeadline), round: Number(c.round), size: Number(c.size), joined: Number(c.joinedCount),
    paid: Number(c.paidCount), status: STATUS[Number(c.status)], open: c.open, minCompleted: Number(req),
    members: [...d.addrs].map((a, i) => ({
      address: a, nickname: d.nicknames[i], joined: d.joined[i], paid: d.paidThisRound[i],
      depositUsed: d.depositUsed[i], defaults: Number(d.defaults[i]),
    })),
  };
}
async function loadExplore() {
  const count = Number(await reader.circleCount());
  const hidden = new Set(CFG.hiddenCircles || []);
  const ids = []; for (let i = count - 1; i >= 0 && ids.length < 30; i--) if (!hidden.has(i)) ids.push(i);
  return Promise.all(ids.map(loadCircle));
}
async function loadMine() {
  if (!state.account) return [];
  const ids = [...new Set((await reader.getUserCircles(state.account)).map(Number))].reverse();
  const circles = await Promise.all(ids.map(loadCircle));
  // drop open circles the user left before they started
  return circles.filter((c) => same(c.creator, state.account) || c.members.some((m) => same(m.address, state.account)));
}
async function loadStats() {
  const [paid, rounds, count, badgeCount] = await Promise.all([reader.totalPaidOut(), reader.roundsSettled(), reader.circleCount(), getBadgeReader().then((b) => b.totalSupply())]);
  return { paid: etn(paid), rounds: Number(rounds), count: Number(count), badges: Number(badgeCount) };
}
const meIn = (c) => state.account && c.members.find((m) => same(m.address, state.account));
const isDue = (c) => c.status === "Active" && (c.paid === c.members.length || now() >= c.deadline);

// ===================================================================== ring visual
function ringSVG(c, { mini = false, preview = false } = {}) {
  const S = 400, cx = 200, cy = 200, R = mini ? 150 : 150;
  const n = c.size;
  const track = mini ? 34 : 12;
  let frac = 0;
  if (c.status === "Forming") frac = c.joined / n;
  else if (c.status === "Active") frac = c.round / n;
  else if (c.status === "Completed") frac = 1;
  else frac = c.round / n;
  const circ = 2 * Math.PI * R;
  const gid = `g${c.id ?? "p"}${mini ? "m" : ""}`;
  let out = `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="${esc(`${c.name}: ${c.status}`)}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00c08b"/><stop offset=".55" stop-color="#1fb6ff"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="var(--ring-track)" stroke-width="${track}"/>
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="url(#${gid})" stroke-width="${track}" stroke-linecap="round"
      stroke-dasharray="${circ}" stroke-dashoffset="${circ * (1 - frac)}" transform="rotate(-90 ${cx} ${cy})" style="transition:stroke-dashoffset .6s ease"/>`;
  if (mini) {
    const label = c.status === "Forming" ? `${c.joined}/${n}` : c.status === "Active" ? `${c.round + 1}/${n}` : c.status === "Completed" ? "✓" : "×";
    out += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" style="font:800 ${label.length > 4 ? 84 : 100}px var(--font-display);fill:var(--text)">${label}</text></svg>`;
    return out;
  }

  // countdown arc (inner)
  if (c.status === "Active" && !preview) {
    const r2 = R - 40, circ2 = 2 * Math.PI * r2;
    const left = Math.max(0, Math.min(1, (c.deadline - now()) / c.roundDuration));
    out += `<circle cx="${cx}" cy="${cy}" r="${r2}" fill="none" stroke="var(--surface-3)" stroke-width="4"/>
      <circle cx="${cx}" cy="${cy}" r="${r2}" fill="none" stroke="var(--brand-2)" stroke-width="4" stroke-linecap="round"
        stroke-dasharray="${circ2}" stroke-dashoffset="${circ2 * (1 - left)}" transform="rotate(-90 ${cx} ${cy})"
        data-arc-deadline="${c.deadline}" data-arc-duration="${c.roundDuration}" data-arc-circ="${circ2}"/>`;
  }

  // member nodes
  const nodeR = Math.max(8, Math.min(27, 430 / n));
  for (let i = 0; i < n; i++) {
    const a = (-90 + (i * 360) / n) * (Math.PI / 180);
    const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    const m = c.members[i];
    const seated = m && (c.status !== "Forming" || m.joined || !c.open);
    if (!m || (c.status === "Forming" && !m.joined)) {
      out += `<g class="ring-node"><circle cx="${x}" cy="${y}" r="${nodeR}" fill="var(--surface)" stroke="var(--faint)" stroke-width="2" stroke-dasharray="4 4"/>
        ${nodeR >= 14 ? `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" style="font:700 ${nodeR * .8}px var(--font);fill:var(--faint)">${m ? esc(initial(m)).toUpperCase() : "+"}</text>` : ""}
        <title>${m ? esc(nameOf(m)) + " (not joined yet)" : "Open seat"}</title></g>`;
      continue;
    }
    if (!seated) continue;
    const h = hueOf(m.address);
    const done = (c.status === "Active" && i < c.round) || c.status === "Completed" || (c.status === "Cancelled" && i < c.round);
    const current = c.status === "Active" && i === c.round;
    const mine = same(m.address, state.account);
    out += `<g class="ring-node ${current ? "current" : ""}">
      ${current ? `<circle class="halo" cx="${x}" cy="${y}" r="${nodeR + 2}" fill="none" stroke="#1fb6ff" stroke-width="4"/>` : ""}
      <circle cx="${x}" cy="${y}" r="${nodeR + (current ? 4 : 0)}" fill="hsl(${h} 70% 52%)" stroke="${current ? "#fff" : mine ? "#f5b400" : "var(--surface)"}" stroke-width="${current || mine ? 4 : 3}"/>
      ${nodeR >= 13 ? `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" style="font:800 ${nodeR * .78}px var(--font-display);fill:#fff;text-transform:uppercase">${esc(initial(m)).toUpperCase()}</text>` : ""}
      ${done ? `<circle cx="${x + nodeR * .75}" cy="${y - nodeR * .75}" r="${Math.max(6, nodeR * .42)}" fill="#00c08b" stroke="var(--surface)" stroke-width="2.5"/>
        <path d="M${x + nodeR * .75 - nodeR * .2} ${y - nodeR * .75} l${nodeR * .14} ${nodeR * .15} l${nodeR * .26} -${nodeR * .3}" fill="none" stroke="#fff" stroke-width="${Math.max(1.6, nodeR * .1)}" stroke-linecap="round" stroke-linejoin="round"/>` : ""}
      <title>${i + 1}. ${esc(nameOf(m))}${current ? " — receives this round" : done ? " — received pot" : ""}</title></g>`;
  }

  // center
  const pot = c.contribution * BigInt(n);
  let lbl, big, sub;
  if (c.status === "Forming") { lbl = preview ? "Each round's pot" : "Seats filled"; big = preview ? fmtNum(etn(pot)) : `${c.joined}/${n}`; sub = preview ? "ETN" : `Pot ${fmt(pot)}`; }
  else if (c.status === "Active") { const r = c.members[c.round]; lbl = `Round ${c.round + 1} of ${n}`; big = fmtNum(etn(pot)); sub = `ETN to ${nameOf(r)}`; }
  else if (c.status === "Completed") { lbl = "Completed"; big = "✓"; sub = `${fmt(pot * BigInt(n))} paid out`; }
  else { lbl = "Dissolved"; big = "×"; sub = "Funds refunded"; }
  out += `<g class="ring-center">
    <text class="lbl" x="${cx}" y="${cy - 38}" text-anchor="middle">${esc(lbl)}</text>
    <text class="big" x="${cx}" y="${cy + 8}" text-anchor="middle" style="font-size:${String(big).length > 7 ? 32 : 44}px">${esc(big)}</text>
    <text class="sub" x="${cx}" y="${cy + 38}" text-anchor="middle">${esc(sub.length > 26 ? sub.slice(0, 25) + "…" : sub)}</text>
    ${c.status === "Active" && !preview ? `<text class="sub" x="${cx}" y="${cy + 62}" text-anchor="middle" style="fill:var(--brand-2);font-weight:700" data-deadline="${c.deadline}">${countdown(c.deadline)}</text>` : ""}
  </g></svg>`;
  return out;
}

function heroArt() {
  const names = ["A", "K", "N", "J", "M", "S"];
  const hues = [160, 200, 255, 25, 320, 120];
  const R = 140, cx = 200, cy = 200;
  let nodes = "", coins = "";
  names.forEach((t, i) => {
    const a = (-90 + i * 60) * Math.PI / 180, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
    nodes += `<g><circle cx="${x}" cy="${y}" r="27" fill="hsl(${hues[i]} 70% 52%)" stroke="var(--surface)" stroke-width="4"/>
      <text class="node-inner" x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" style="font:800 20px var(--font-display);fill:#fff">${t}</text></g>`;
    coins += `<circle r="5" fill="#ffc94d" opacity="0"><animate attributeName="opacity" values="0;1;1;0" dur="3s" begin="${i * .5}s" repeatCount="indefinite"/>
      <animateMotion dur="3s" begin="${i * .5}s" repeatCount="indefinite" path="M${x} ${y} L${cx} ${cy}"/></circle>`;
  });
  return `<div class="hero-art" aria-hidden="true">
    <svg viewBox="0 0 400 400">
      <defs><linearGradient id="hg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#00c08b"/><stop offset=".55" stop-color="#1fb6ff"/><stop offset="1" stop-color="#7c5cff"/></linearGradient>
        <radialGradient id="hc"><stop offset="0" stop-color="#1fb6ff" stop-opacity=".25"/><stop offset="1" stop-color="#1fb6ff" stop-opacity="0"/></radialGradient></defs>
      <circle cx="200" cy="200" r="190" fill="url(#hc)"/>
      <circle cx="200" cy="200" r="${R}" fill="none" stroke="var(--ring-track)" stroke-width="12"/>
      <circle cx="200" cy="200" r="${R}" fill="none" stroke="url(#hg)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${2 * Math.PI * R}" stroke-dashoffset="${2 * Math.PI * R * .35}" transform="rotate(-90 200 200)"/>
      <circle cx="200" cy="200" r="74" fill="var(--surface)" stroke="var(--border)"/>
      <text x="200" y="178" text-anchor="middle" style="font:600 11px var(--font);letter-spacing:.08em;fill:var(--muted)">THIS ROUND'S POT</text>
      <text x="200" y="214" text-anchor="middle" style="font:800 36px var(--font-display);fill:var(--text)">600</text>
      <text x="200" y="238" text-anchor="middle" style="font:700 13px var(--font);fill:var(--brand)">ETN</text>
      <g class="orbit">${coins}${nodes}</g>
    </svg>
    <div class="float-card a"><span class="av sm" style="background:${avatarBg("0x6a" + "0".repeat(38))}">K</span><div><b>Kofi paid</b><span class="muted">100 ETN · round 4</span></div></div>
    <div class="float-card b">🎉<div><b>Amina got the pot</b><span class="muted">600 ETN</span></div></div>
  </div>`;
}

// ===================================================================== views
function renderChrome() {
  const btn = $("#connect");
  btn.textContent = state.account ? short(state.account) : "Connect wallet";
  btn.className = state.account ? "btn small secondary" : "btn small primary";
  $("#bal").textContent = state.account && state.chainOk ? fmt(state.balance) : "";
  $("#net span").textContent = CFG.name;
  const link = $("#contract-link"); link.href = addrUrl(CFG.contract); link.textContent = short(CFG.contract);

  let b = "";
  if (state.account && !state.chainOk) {
    b += `<div class="banner warn"><div class="grow"><strong>Wrong network</strong><span class="small">Switch your wallet to ${esc(CFG.name)} to continue.</span></div><button class="btn small" data-act="switch">Switch</button></div>`;
  } else if (state.account && state.balance === 0n && CFG.faucet) {
    b += `<div class="banner info"><div class="grow"><strong>Your wallet has no ETN yet</strong><span class="small">Grab free testnet ETN to try circles out.</span></div><a class="btn small primary" href="${CFG.faucet}" target="_blank" rel="noopener">Get test ETN</a></div>`;
  }
  $("#banners").innerHTML = b;
}

function circleCard(c) {
  const me = meIn(c);
  const n = c.size;
  let line;
  if (c.status === "Forming") line = `${n - c.joined} seat${n - c.joined === 1 ? "" : "s"} left`;
  else if (c.status === "Active") line = `<span data-deadline="${c.deadline}">${countdown(c.deadline)}</span>`;
  else if (c.status === "Completed") line = "All rounds paid out";
  else line = "Dissolved · refunded";
  const people = c.members.filter((m) => m.joined || c.status !== "Forming").slice(0, 5);
  return `<a class="card circle-card" href="#/circle/${c.id}">
    <div class="top">
      <div class="mini">${ringSVG(c, { mini: true })}</div>
      <div class="meta">
        <p class="title">${esc(c.name)}</p>
        <div class="row wrap-row" style="gap:6px;margin-top:4px"><span class="pill ${c.status}">${c.status}</span>
          <span class="pill plain">${c.open ? "Open" : "Invite-only"}</span>${c.minCompleted ? `<span class="pill plain" title="Requires ${c.minCompleted}+ completed circle(s) and no defaults">🛡 Trusted</span>` : ""}${me ? '<span class="pill you plain">You’re in</span>' : ""}</div>
      </div>
    </div>
    <div class="row between"><div class="avatars">${people.map((m) => avatar(m, "sm")).join("")}${c.members.length > 5 ? `<span class="tiny muted" style="margin-left:6px">+${c.members.length - 5}</span>` : ""}</div>
      <span class="small muted">${line}</span></div>
    <div class="facts">
      <div><div class="k">Per round</div><div class="v">${fmt(c.contribution)}</div></div>
      <div><div class="k">Pot</div><div class="v">${fmt(c.contribution * BigInt(n))}</div></div>
      <div><div class="k">Every</div><div class="v">${humanDuration(c.roundDuration)}</div></div>
    </div>
  </a>`;
}

function statTile(k, v, unit, key) {
  return `<div class="stat-tile"><div class="k">${k}</div><div class="v"><span data-count="${v}" data-key="${key}">${fmtNum(v, 2)}</span>${unit ? `<small>${unit}</small>` : ""}</div></div>`;
}
function countUp(root) {
  if (reduceMotion) return;
  $$("[data-count]", root).forEach((el) => {
    const target = Number(el.dataset.count); if (!target) return;
    const t0 = performance.now(), dur = 900;
    const step = (t) => { const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 3); el.textContent = fmtNum(target * e, target < 100 ? 2 : 0); if (p < 1) requestAnimationFrame(step); else el.textContent = fmtNum(target, 2); };
    requestAnimationFrame(step);
  });
}

async function viewHome() {
  const view = $("#view");
  if (!state.tab) state.tab = state.account ? "mine" : "explore";
  view.innerHTML = `
    <section class="hero">
      <div>
        <span class="eyebrow"><b>New</b> Open circles — share a link, anyone can join</span>
        <h1>Save together.<br><span class="grad-text">Get paid out in turn.</span></h1>
        <p class="lead">The chama, susu and tontine, rebuilt on Electroneum Smart Chain. Everyone pays the same amount each round and one member takes the whole pot. The smart contract holds the money, so nobody has to.</p>
        <div class="cta"><a class="btn primary large" href="#/new">Start a circle</a><a class="btn secondary large" href="#circles" data-tab-jump="open">Join an open circle</a></div>
        <div class="trust"><span>No middleman</span><span>No fees</span><span>Deposits protect every member</span><span>Earn an on-chain savings reputation</span></div>
      </div>
      ${heroArt()}
    </section>
    <div class="stats-strip" id="stats">${["ETN paid out", "Rounds settled", "Circles created", "Badges earned"].map((k) => `<div class="stat-tile"><div class="k">${k}</div><div class="v">—</div></div>`).join("")}</div>
    <div id="dash"></div>
    <div class="section-head" id="circles"><div><h2>Circles</h2><p>Browse what's happening on-chain right now.</p></div><a class="btn small secondary" href="#/new">+ New circle</a></div>
    <div class="tabs" role="tablist">
      ${state.account ? `<button role="tab" data-tab="mine" aria-selected="${state.tab === "mine"}">My circles</button>` : ""}
      <button role="tab" data-tab="open" aria-selected="${state.tab === "open"}">Open to join</button>
      <button role="tab" data-tab="explore" aria-selected="${state.tab === "explore"}">All circles</button>
    </div>
    <div id="list" style="margin-top:14px"></div>
    <div class="section-head"><div><h2>How it works</h2><p>Four steps, enforced by a smart contract.</p></div></div>
    <div class="how">
      <div class="card"><div class="n">1</div><b>Create</b><p>Pick an amount, how often you pay, and either open seats or a member list.</p></div>
      <div class="card"><div class="n">2</div><b>Join</b><p>Each member locks a one-round deposit. It covers one missed payment and comes back at the end.</p></div>
      <div class="card"><div class="n">3</div><b>Pay each round</b><p>Everyone pays in. Once all have paid, the whole pot goes to that round's member.</p></div>
      <div class="card"><div class="n">4</div><b>Collect & level up</b><p>Everyone gets the pot once. Finishing earns a badge NFT and raises your savings score.</p></div>
    </div>`;
  $$("[data-tab]", view).forEach((b) => b.onclick = () => { state.tab = b.dataset.tab; $$("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x === b)); renderList(); });
  $("[data-tab-jump]", view).onclick = () => { state.tab = "open"; $$("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x.dataset.tab === "open")); renderList(); };

  // stats
  (async () => {
    try {
      state.stats ??= await loadStats();
      const s = state.stats, el = $("#stats"); if (!el) return;
      el.innerHTML = statTile("ETN paid out", s.paid, "ETN", "paid") + statTile("Rounds settled", s.rounds, "", "rounds") + statTile("Circles created", s.count, "", "count") + statTile("Badges earned", s.badges, "", "badges");
      countUp(el);
    } catch (e) { console.error(e); }
  })();

  renderDashboard();
  renderList();
}

async function renderDashboard() {
  const el = $("#dash"); if (!el) return;
  if (!state.account) { el.innerHTML = ""; return; }
  try { state.mine ??= await loadMine(); } catch (e) { console.error(e); return; }
  if (!$("#dash")) return;
  const todos = [];
  for (const c of state.mine) {
    const me = meIn(c);
    const idx = c.members.findIndex((m) => same(m.address, state.account));
    if (c.status === "Forming") {
      if (me && !me.joined) todos.push(`<li><span class="ico pay">✉️</span><div class="grow"><b>You're invited to ${esc(c.name)}</b><span class="small muted">Lock a ${fmt(c.contribution)} deposit to join</span></div><a class="btn small primary" href="#/circle/${c.id}">Review</a></li>`);
      else if (me?.joined) todos.push(`<li><span class="ico">⏳</span><div class="grow"><b>${esc(c.name)}</b><span class="small muted">Waiting for ${c.size - c.joined} more member${c.size - c.joined === 1 ? "" : "s"}</span></div><button class="btn small secondary" data-act="share" data-id="${c.id}">Invite</button></li>`);
    } else if (c.status === "Active" && me) {
      if (isDue(c)) todos.push(`<li><span class="ico settle">⚖️</span><div class="grow"><b>${esc(c.name)}: round ${c.round + 1} is ready</b><span class="small muted">Settle it to release the pot</span></div><button class="btn small primary" data-act="settle" data-id="${c.id}">Settle</button></li>`);
      else if (!me.paid) todos.push(`<li><span class="ico pay">💸</span><div class="grow"><b>Pay ${fmt(c.contribution)} · ${esc(c.name)}</b><span class="small muted">Round ${c.round + 1} · <span data-deadline="${c.deadline}">${countdown(c.deadline)}</span></span></div><button class="btn small primary" data-act="pay" data-id="${c.id}" data-amt="${c.contribution}">Pay</button></li>`);
      if (idx === c.round) todos.push(`<li><span class="ico turn">🎉</span><div class="grow"><b>It's your turn in ${esc(c.name)}</b><span class="small muted">You receive ${fmt(c.contribution * BigInt(c.size))} when this round settles</span></div></li>`);
      else if (idx > c.round) todos.push(`<li><span class="ico turn">📅</span><div class="grow"><b>Your payout: round ${idx + 1} of ${c.size}</b><span class="small muted">${esc(c.name)} · around ${dateIn(c.deadline + (idx - c.round - 1) * c.roundDuration)}</span></div></li>`);
    }
  }
  const active = state.mine.filter((c) => c.status === "Active" || c.status === "Forming").length;
  let myRep = null;
  try { myRep = await loadReputation(state.account); } catch {}
  if (!$("#dash")) return;
  const tier = tierOf(myRep);
  el.innerHTML = `<div class="section-head"><div><h2>Your dashboard</h2><p>${active} active circle${active === 1 ? "" : "s"}</p></div></div>
    <div class="dash">
      <div class="card collect pad-lg">
        <div class="k">Ready to collect</div>
        <div class="v num">${fmt(state.withdrawable)}</div>
        ${state.withdrawable > 0n ? `<button class="btn" data-act="withdraw">Withdraw to wallet</button>` : `<span class="small" style="opacity:.85">Payouts and refunds appear here.</span>`}
      </div>
      <a class="card score-card" href="#/u/${state.account}">
        <div class="row between"><b>Savings score</b><span class="small muted">View profile →</span></div>
        <div class="row" style="gap:14px;margin-top:6px">${gaugeSVG(myRep)}
          <div class="small muted">${myRep && tier.score !== null ? `<b class="num" style="color:var(--text)">${myRep.completed}</b> circles completed<br><b class="num" style="color:var(--text)">${myRep.onTimePayments}</b> on-time payments${myRep.missedPayments ? `<br><b class="num" style="color:var(--danger)">${myRep.missedPayments}</b> missed` : ""}` : "Complete your first circle to earn a score and a badge."}</div></div>
      </a>
      <div class="card todo-card"><b>To do</b>${todos.length ? `<ul class="todo" style="margin-top:8px">${todos.join("")}</ul>` : `<p class="muted small" style="margin:8px 0 0">You're all caught up. 🎯</p>`}</div>
    </div>`;
}

async function renderList() {
  const list = $("#list"); if (!list) return;
  const tab = state.tab;
  list.innerHTML = `<div class="grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
  let circles;
  try {
    if (tab === "mine") circles = state.mine ??= await loadMine();
    else circles = state.explore ??= await loadExplore();
  } catch (e) {
    console.error(e);
    list.innerHTML = `<div class="card empty"><div class="em">📡</div>Couldn't reach the network. <button class="btn small secondary" data-act="reload">Retry</button></div>`; return;
  }
  if (state.tab !== tab || !$("#list")) return;
  if (tab === "open") circles = circles.filter((c) => c.status === "Forming" && c.open && !meIn(c));
  if (!circles.length) {
    const msg = { mine: ["🌱", "You aren't in any circles yet."], open: ["🪑", "No open circles right now. Start one and share the link!"], explore: ["✨", "No circles yet. Be the first!"] }[tab];
    list.innerHTML = `<div class="card empty"><div class="em">${msg[0]}</div><p>${msg[1]}</p><a class="btn primary" href="#/new">Start a circle</a></div>`; return;
  }
  list.innerHTML = `<div class="grid">${circles.map(circleCard).join("")}</div>`;
}

// ------------------------------------------------------------------ create
function viewCreate() {
  const view = $("#view");
  const f = { open: true, name: "", amount: "1", duration: 604800, seats: 5, members: "", nickname: "", seat: true, req: 0 };
  view.innerHTML = `<a class="back" href="#/">← Back</a>
    <div class="detail-head"><h1>Start a savings circle</h1><p class="muted" style="margin:0 0 18px">Set the rules once. The smart contract enforces them for everyone.</p></div>
    <div class="create-layout">
      <form class="card pad-lg stack" id="create-form" novalidate>
        <div><span class="label">Who can join?</span>
          <div class="seg"><button type="button" data-type="open" aria-pressed="true"><b>🔗 Open circle</b><span>Share a link. First come, first served.</span></button>
          <button type="button" data-type="invite" aria-pressed="false"><b>🔒 Invite-only</b><span>List exact wallets and payout order.</span></button></div></div>
        <div><label for="f-name">Circle name</label><input id="f-name" maxlength="64" placeholder="e.g. Kibera Market Chama" autocomplete="off"></div>
        <div><label for="f-amount">Each member pays per round</label>
          <div class="input-affix"><input id="f-amount" inputmode="decimal" value="1" autocomplete="off"><span>ETN</span></div>
          <div class="chips" id="amount-chips">${AMOUNT_CHIPS.map((a) => `<button type="button" data-amt="${a}" aria-pressed="${a === "1"}">${a}</button>`).join("")}</div></div>
        <div><span class="label">How often?</span>
          <div class="chips" id="dur-chips" style="margin-top:0">${DURATIONS.map(([s, l, t]) => `<button type="button" data-dur="${s}" aria-pressed="${s === 604800}">${l}${t ? ` <span style="opacity:.7">· ${t}</span>` : ""}</button>`).join("")}</div></div>
        <div id="seats-box"><span class="label">Number of members</span>
          <div class="stepper"><button type="button" data-step="-1" aria-label="Fewer">−</button><output id="f-seats">5</output><button type="button" data-step="1" aria-label="More">+</button></div></div>
        <div id="req-box"><span class="label">Who may take a seat? <span class="hint">· a track record makes the circle safer</span></span>
          <div class="chips" id="req-chips" style="margin-top:0">${REQUIREMENTS.map(([v, l]) => `<button type="button" data-req="${v}" aria-pressed="${v === 0}">${v ? "🛡 " : ""}${l}</button>`).join("")}</div>
          <div class="hint" id="req-hint" style="margin-top:6px"></div></div>
        <div id="members-box" hidden>
          <label for="f-members">Members in payout order <span class="hint">· one wallet address per line. The first is paid in round 1.</span></label>
          <textarea id="f-members" class="mono" placeholder="0x…&#10;0x…&#10;0x…" spellcheck="false"></textarea>
          <div class="row" style="margin-top:8px"><button type="button" class="btn small secondary" id="add-me">+ Add my address</button></div>
        </div>
        <div id="seat-box" class="stack" style="background:var(--surface-2);border-radius:14px;padding:14px">
          <label class="check-row"><input type="checkbox" id="f-seat" checked><span><b>Take a seat right away</b><br><span class="small muted" id="seat-hint">Locks a 1 ETN deposit. You'll be member #1 and get the first pot.</span></span></label>
          <div><label for="f-nick">Your nickname <span class="hint">(optional, shown to members)</span></label><input id="f-nick" maxlength="32" placeholder="e.g. Amina" autocomplete="off"></div>
        </div>
        <div class="err" id="form-err" hidden></div>
        <button class="btn primary large block" type="submit" id="create-btn">Create circle</button>
      </form>
      <aside class="card pad-lg preview stack">
        <b>Preview</b>
        <div class="ring-wrap" id="pv-ring"></div>
        <div id="pv-text" class="small"></div>
      </aside>
    </div>`;

  const form = $("#create-form");
  const parseMembers = () => {
    const raw = $("#f-members").value.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    const errors = [], members = [];
    for (const a of raw) {
      if (!ethers.isAddress(a)) { errors.push(`Not a valid address: ${a.slice(0, 14)}${a.length > 14 ? "…" : ""}`); continue; }
      const ck = ethers.getAddress(a);
      if (members.includes(ck)) { errors.push(`Listed twice: ${short(ck)}`); continue; }
      members.push(ck);
    }
    return { members, errors };
  };
  const amountWei = () => { try { const v = $("#f-amount").value.trim(); return v ? ethers.parseEther(v) : null; } catch { return undefined; } };
  const update = () => {
    f.name = $("#f-name").value.trim();
    f.nickname = $("#f-nick").value.trim();
    f.seat = $("#f-seat").checked;
    const amt = amountWei();
    const pm = parseMembers();
    const size = f.open ? f.seats : Math.max(2, pm.members.length);
    const inList = !f.open && state.account && pm.members.some((m) => same(m, state.account));
    $("#seat-box").hidden = !f.open && !inList;
    const lowFunds = f.seat && amt && state.account && state.chainOk && state.balance < amt + FEE_MARGIN * 2n;
    $("#seat-hint").innerHTML = (amt ? `Locks a ${fmt(amt)} deposit${f.open ? ". You'll be member #1 and get the first pot." : " (you get it back at the end)."}` : "Locks a one-round deposit.")
      + (lowFunds ? `<br><span class="warn-text">Your wallet has ${fmt(state.balance)}, not enough for this deposit. Lower the amount or untick this box.</span>` : "")
      + (f.seat && amt ? `<br><span class="tiny">Your wallet asks you to confirm twice: once to create the circle, once to take your seat.</span>` : "");
    $$("#amount-chips button").forEach((b) => b.setAttribute("aria-pressed", $("#f-amount").value.trim() === b.dataset.amt));
    $$("#dur-chips button").forEach((b) => b.setAttribute("aria-pressed", Number(b.dataset.dur) === f.duration));
    $$("#req-chips button").forEach((b) => b.setAttribute("aria-pressed", Number(b.dataset.req) === f.req));
    $("#req-box").hidden = !f.open;
    $("#req-hint").textContent = f.req ? `Only wallets with ${f.req}+ completed circle${f.req > 1 ? "s" : ""} and no defaults can join. You need to meet it too to take a seat.` : "Anyone with the link can join.";
    $("#f-seats").textContent = f.seats;
    const preview = {
      id: "pv", name: f.name || "Your circle", size, joined: 0, round: 0, status: "Forming", open: f.open, roundDuration: f.duration,
      contribution: amt || 0n,
      members: f.open ? [] : pm.members.map((a) => ({ address: a, nickname: "", joined: false })),
    };
    if (f.open && f.seat && state.account) { preview.members = [{ address: state.account, nickname: f.nickname, joined: true }]; preview.joined = 1; }
    $("#pv-ring").innerHTML = ringSVG(preview, { preview: true });
    $("#pv-text").innerHTML = amt
      ? `<b>${size} members × ${fmt(amt)}</b> every ${humanDuration(f.duration)}.<br>Each round one member receives <b>${fmt(amt * BigInt(size))}</b>. Runs for ${size} rounds (≈ ${humanDuration(f.duration * size)}).<br><span class="muted">Each member locks a ${fmt(amt)} deposit, returned at the end.</span>`
      : `<span class="muted">Enter an amount to see the numbers.</span>`;
    return { amt, pm, size, inList };
  };

  $$(".seg button", form).forEach((b) => b.onclick = () => {
    f.open = b.dataset.type === "open";
    $$(".seg button", form).forEach((x) => x.setAttribute("aria-pressed", x === b));
    $("#seats-box").hidden = !f.open; $("#members-box").hidden = f.open;
    update();
  });
  $$("#amount-chips button").forEach((b) => b.onclick = () => { $("#f-amount").value = b.dataset.amt; update(); });
  $$("#dur-chips button").forEach((b) => b.onclick = () => { f.duration = Number(b.dataset.dur); update(); });
  $$("#req-chips button").forEach((b) => b.onclick = () => { f.req = Number(b.dataset.req); update(); });
  $$("[data-step]", form).forEach((b) => b.onclick = () => { f.seats = Math.max(2, Math.min(50, f.seats + Number(b.dataset.step))); update(); });
  $("#add-me").onclick = async () => {
    if (!state.account) await connect();
    if (!state.account) return;
    const ta = $("#f-members");
    if (!ta.value.toLowerCase().includes(state.account.toLowerCase())) ta.value = (ta.value.trim() ? ta.value.trim() + "\n" : "") + state.account;
    update();
  };
  form.oninput = update;
  update();

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const { amt, pm, inList } = update();
    const errs = [];
    if (!f.name) errs.push("Give the circle a name.");
    if (amt === undefined) errs.push("The amount must be a number, e.g. 10 or 2.5.");
    else if (!amt || amt <= 0n) errs.push("Enter an amount above 0.");
    if (!f.open) { errs.push(...pm.errors); if (pm.members.length < 2 || pm.members.length > 50) errs.push("Add between 2 and 50 member addresses."); }
    const errEl = $("#form-err");
    if (errs.length) { errEl.hidden = false; errEl.innerHTML = errs.map(esc).join("<br>"); return; }
    errEl.hidden = true;
    const seating = f.seat && (f.open || inList);
    if (!state.account) await connect();
    if (!state.account) return;
    if (!haveFunds(seating ? amt + FEE_MARGIN : 0n, seating ? "Creating the circle and taking your seat" : "Creating the circle")) return;
    const btn = $("#create-btn"); btn.disabled = true;
    const createLabel = seating ? "Step 1 of 2 · Create circle" : "Create circle";
    const receipt = f.open
      ? await sendTx(createLabel, (c) => c.createOpenCircle(f.name, f.seats, amt, f.duration, f.req))
      : await sendTx(createLabel, (c) => c.createCircle(f.name, pm.members, amt, f.duration));
    if (!receipt) { btn.disabled = false; return; }
    const evt = receipt.logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "CircleCreated");
    const id = evt ? evt.args.id : null;
    let seatFailed = false;
    if (id !== null && seating) {
      seatFailed = !(await sendTx("Step 2 of 2 · Take your seat", (c) => c.join(id, f.nickname, { value: amt })));
    }
    state.tab = "mine";
    location.hash = id !== null ? `#/circle/${id}` : "#/";
    if (seatFailed) toast("Your circle was created, but your seat wasn't taken. Use <b>Join</b> on the circle page to take it.", { ttl: 15000 });
  };
}

// ------------------------------------------------------------------ circle detail
async function viewCircle(id) {
  const view = $("#view");
  view.innerHTML = `<a class="back" href="#/">← All circles</a><div class="detail"><div class="skeleton" style="min-height:420px"></div><div class="skeleton" style="min-height:300px"></div></div>`;
  let c;
  try {
    const count = Number(await reader.circleCount());
    if (!(id >= 0 && id < count)) { view.innerHTML = `<a class="back" href="#/">← All circles</a><div class="card empty"><div class="em">🔍</div>Circle #${esc(id)} doesn't exist.</div>`; return; }
    c = await loadCircle(id);
  } catch (e) { console.error(e); view.innerHTML = `<a class="back" href="#/">← All circles</a><div class="card empty"><div class="em">📡</div>Couldn't load this circle. <button class="btn small secondary" data-act="reload">Retry</button></div>`; return; }
  if (location.hash !== `#/circle/${id}`) return;

  const n = c.size;
  const me = meIn(c);
  const isCreator = same(c.creator, state.account);
  const due = isDue(c);
  const recipient = c.status === "Active" ? c.members[c.round] : null;
  const pot = c.contribution * BigInt(n);
  const canJoin = c.status === "Forming" && (!me || !me.joined) && (c.open || me);
  const [reps, eligible, myRep] = await Promise.all([
    Promise.all(c.members.map((m) => loadReputation(m.address).catch(() => null))),
    state.account && c.minCompleted ? reader.isEligible(id, state.account).catch(() => true) : true,
    state.account && c.minCompleted ? loadReputation(state.account).catch(() => null) : null,
  ]);
  if (location.hash !== `#/circle/${id}`) return;
  const reqText = c.minCompleted ? `${c.minCompleted}+ completed circle${c.minCompleted > 1 ? "s" : ""} and no defaults` : "";

  // ---- action panel
  let head = "", body = "", acts = [];
  if (c.status === "Forming") {
    if (canJoin && c.open && !eligible) {
      head = "🛡 Track record required";
      body = `Seats in this circle are reserved for savers with <b>${reqText}</b>. You have ${myRep?.completed ?? 0} completed circle${myRep?.completed === 1 ? "" : "s"}${myRep?.defaulted ? " and a default on record" : ""}. Complete an open circle first to build your score.`;
      acts.push(`<a class="btn secondary" href="#/" data-goto-open>Find a circle to start with</a>`);
    } else if (canJoin) {
      head = c.open ? "🪑 A seat is waiting for you" : "✉️ You're invited";
      body = `Join by locking a <b>${fmt(c.contribution)}</b> deposit. It covers one missed payment and comes back when the circle ends. ${c.open ? `You'll be member <b>#${c.members.length + 1}</b> in the payout order.` : ""}
        <div style="margin-top:12px"><label for="j-nick">Nickname <span class="hint">(optional)</span></label><input id="j-nick" maxlength="32" placeholder="How members will see you"></div>`;
      acts.push(`<button class="btn primary large" data-act="join" data-id="${id}" data-amt="${c.contribution}">Join · lock ${fmt(c.contribution)}</button>`);
    } else if (me?.joined) {
      head = "⏳ Waiting for members";
      body = `You're in. The circle starts when all ${n} seats are filled — ${n - c.joined} to go. Share the link to fill it faster.`;
      acts.push(`<button class="btn primary" data-act="share" data-id="${id}">Invite members</button>`);
      acts.push(`<button class="btn danger" data-act="leave" data-id="${id}">Leave & get deposit back</button>`);
    } else {
      head = "Members only"; body = "This circle is invite-only, and your wallet isn't on the list.";
    }
    if (isCreator) acts.push(`<button class="btn ghost" data-act="cancel" data-id="${id}">Cancel circle</button>`);
  } else if (c.status === "Active") {
    if (due && c.paid === c.members.length) { head = "✅ Everyone has paid"; body = `Settle the round to send <b>${fmt(pot)}</b> to <b>${esc(nameOf(recipient))}</b>. Anyone can do it.`; acts.push(`<button class="btn primary large" data-act="settle" data-id="${id}">Settle round ${c.round + 1}</button>`); }
    else if (due) { head = "⌛ Deadline passed"; body = "Anyone can settle the round now. Missed payments are covered from deposits; a repeat miss dissolves the circle with refunds for everyone."; acts.push(`<button class="btn primary large" data-act="settle" data-id="${id}">Settle round ${c.round + 1}</button>`); }
    else if (me && !me.paid) { head = same(recipient.address, state.account) ? "🎉 It's your turn!" : "💸 Your payment is due"; body = `Pay <b>${fmt(c.contribution)}</b> for round ${c.round + 1} before the deadline (<span data-deadline="${c.deadline}">${countdown(c.deadline)}</span>).${same(recipient.address, state.account) ? ` You receive the <b>${fmt(pot)}</b> pot when this round settles.` : ""}`; acts.push(`<button class="btn primary large" data-act="pay" data-id="${id}" data-amt="${c.contribution}">Pay ${fmt(c.contribution)}</button>`); }
    else if (me) { head = "👍 You've paid this round"; body = `${c.paid} of ${c.members.length} members have paid. The round can be settled once everyone pays or the deadline passes.`; }
    else { head = `Round ${c.round + 1} in progress`; body = `${c.paid} of ${c.members.length} members have paid. <b>${esc(nameOf(recipient))}</b> receives this round's pot.`; }
    if (me && !due) acts.push(`<button class="btn secondary" data-act="ics" data-id="${id}">📅 Add reminder</button>`);
  } else if (c.status === "Completed") { head = "🏁 Circle completed"; body = `Every member received the <b>${fmt(pot)}</b> pot once, unused deposits were returned, and every member earned a 🏅 badge NFT.`; if (me) acts.push(`<a class="btn secondary" href="#/u/${state.account}">See my badge</a>`); }
  else { head = "Circle dissolved"; body = "This circle was cancelled or dissolved, and refunds were credited to members."; }
  if (me && state.withdrawable > 0n) acts.push(`<button class="btn secondary" data-act="withdraw">Collect ${fmt(state.withdrawable)}</button>`);
  if (!state.account && (c.status === "Forming" || c.status === "Active")) acts = [`<button class="btn primary large" data-act="connect">Connect wallet to take part</button>`];

  // ---- members
  const rows = [];
  for (let i = 0; i < Math.max(n, c.members.length); i++) {
    const m = c.members[i];
    if (!m) { rows.push(`<li><span class="pos">${i + 1}</span><span class="av" style="background:var(--surface-3);color:var(--faint)">+</span><div class="who"><b class="faint">Open seat</b></div><span class="state seat">Available</span></li>`); continue; }
    let st;
    if (c.status === "Forming") st = m.joined ? '<span class="state ok">Joined</span>' : '<span class="state no">Invited</span>';
    else if (c.status === "Active") st = i < c.round ? '<span class="state ok">Got pot ✓</span>' : i === c.round ? `<span class="state turn">${m.paid ? "Paid · " : ""}This round</span>` : m.paid ? '<span class="state ok">Paid ✓</span>' : '<span class="state no">Not paid</span>';
    else st = c.status === "Completed" || i < c.round ? '<span class="state ok">Got pot ✓</span>' : '<span class="state no">—</span>';
    const tags = [];
    if (same(m.address, state.account)) tags.push("you");
    if (same(m.address, c.creator)) tags.push("creator");
    if (m.depositUsed) tags.push(`<span style="color:var(--danger)">missed ${m.defaults}× · deposit used</span>`);
    rows.push(`<li><span class="pos">${i + 1}</span>${avatar(m)}<div class="who"><b><a class="plain-link" href="#/u/${m.address}">${esc(nameOf(m))}</a> ${reps[i] ? scoreChip(reps[i]) : ""}</b>
      <span class="tiny muted"><a class="mono" href="${addrUrl(m.address)}" target="_blank" rel="noopener">${short(m.address)}</a>${tags.length ? " · " + tags.join(" · ") : ""}</span></div>${st}</li>`);
  }

  view.innerHTML = `<a class="back" href="#/">← All circles</a>
    <div class="detail-head">
      <div class="row wrap-row" style="gap:6px"><span class="pill ${c.status}">${c.status}</span><span class="pill plain">${c.open ? "🔗 Open" : "🔒 Invite-only"}</span>${c.minCompleted ? `<span class="pill plain">🛡 Requires ${reqText}</span>` : ""}${me ? '<span class="pill you plain">You’re in</span>' : ""}</div>
      <h1>${esc(c.name)}</h1>
      <p class="muted small" style="margin:0 0 16px">Circle #${id} · created by <a href="${addrUrl(c.creator)}" target="_blank" rel="noopener">${short(c.creator)}</a> · ${n} members · every ${humanDuration(c.roundDuration)}</p>
    </div>
    <div class="detail">
      <div class="card pad-lg area-ring"><div class="ring-wrap">${ringSVG(c)}</div>
        ${c.status === "Active" ? `<div style="margin-top:14px"><div class="row between small"><span class="muted">Paid this round</span><b class="num">${c.paid} / ${c.members.length}</b></div><div class="progress" style="margin-top:6px"><i style="width:${(c.paid / c.members.length) * 100}%"></i></div></div>` : ""}
      </div>
      <div class="stack area-rest">
        <div class="card"><div class="row between" style="margin-bottom:6px"><b>Members & payout order</b>${me?.joined ? `<button class="btn small ghost" data-act="nick" data-id="${id}">✏️ My nickname</button>` : ""}</div><ul class="members">${rows.join("")}</ul></div>
        <div class="card"><b>Activity</b><div id="activity" style="margin-top:12px"><span class="small muted">Loading on-chain activity…</span></div></div>
      </div>
      <div class="side stack">
        <div class="card pad-lg action-card stack">
          <h3>${head}</h3>
          ${body ? `<div class="small" style="line-height:1.6">${body}</div>` : ""}
          ${acts.length ? `<div class="actions">${acts.join("")}</div>` : ""}
        </div>
        <div class="card"><div class="kv">
          <div><div class="k">Per round</div><div class="v">${fmt(c.contribution)}</div></div>
          <div><div class="k">Pot</div><div class="v">${fmt(pot)}</div></div>
          <div><div class="k">Deposit</div><div class="v">${fmt(c.contribution)}</div></div>
          <div><div class="k">${c.status === "Active" ? "Deadline" : "Round length"}</div><div class="v">${c.status === "Active" ? `<span data-deadline="${c.deadline}">${countdown(c.deadline)}</span>` : humanDuration(c.roundDuration)}</div></div>
        </div></div>
        <div class="card row between"><div><b>Invite people</b><div class="small muted">QR code, WhatsApp or a link</div></div><button class="btn secondary" data-act="share" data-id="${id}">Share</button></div>
      </div>
    </div>`;
  state.current = c;
  loadActivity(c);
}

const LOG_CHUNK = 1000; // the public ETN RPC rejects eth_getLogs ranges above ~1000 blocks
/** All events of one circle, oldest first. Each item: { topics, data, blockNumber, transactionHash, timestamp? } */
async function circleLogs(id) {
  const topic = ethers.zeroPadValue(ethers.toBeHex(id), 32);
  const start = CFG.deployBlock || 0;
  if (CFG.explorerApi) {
    try {
      const url = `${CFG.explorerApi}?module=logs&action=getLogs&fromBlock=${start}&toBlock=latest&address=${CFG.contract}&topic1=${topic}&topic0_1_opr=and`;
      const j = await (await fetch(url)).json();
      if (Array.isArray(j.result)) {
        return j.result.map((l) => ({ topics: l.topics.filter(Boolean), data: l.data, blockNumber: Number(l.blockNumber),
          transactionHash: l.transactionHash, timestamp: Number(l.timeStamp) }));
      }
    } catch (e) { console.warn("Explorer API unavailable, reading logs from the RPC", e); }
  }
  const filter = { address: CFG.contract, topics: [null, topic] };
  const latest = await readProvider.getBlockNumber();
  try { return await readProvider.getLogs({ ...filter, fromBlock: start, toBlock: latest }); } catch {}
  // Scan backwards in chunks until the circle's creation event (its first event) shows up.
  const created = iface.getEvent("CircleCreated").topicHash;
  const out = [];
  for (let to = latest, n = 0; to >= start && n < 120; n += 4) {
    const ranges = [];
    for (let k = 0; k < 4 && to >= start; k++, to -= LOG_CHUNK) ranges.push([Math.max(start, to - LOG_CHUNK + 1), to]);
    const parts = await Promise.all(ranges.map(([a, b]) => readProvider.getLogs({ ...filter, fromBlock: a, toBlock: b })));
    for (const p of parts) out.unshift(...p);
    if (out.some((l) => l.topics[0] === created)) break;
  }
  return out;
}
async function loadActivity(c) {
  const el = $("#activity"); if (!el) return;
  try {
    const logs = await circleLogs(c.id);
    const events = logs.map((l) => { try { return { log: l, ev: iface.parseLog(l) }; } catch { return null; } }).filter((x) => x && x.ev.name !== "Withdrawn" && x.ev.name !== "BadgeAwarded").reverse().slice(0, 40);
    // Timestamps are cosmetic: fetch them for the newest events only, and tolerate failures.
    const blocks = [...new Set(events.slice(0, 12).filter((e) => !e.log.timestamp).map((e) => e.log.blockNumber))];
    const times = Object.fromEntries(await Promise.all(blocks.map(async (b) => {
      try { return [b, (await readProvider.getBlock(b))?.timestamp ?? 0]; } catch { return [b, 0]; }
    })));
    const who = (a) => { const m = c.members.find((x) => same(x.address, a)); return esc(m ? nameOf(m) : short(a)); };
    const items = events.map(({ log, ev }, idx) => {
      const a = ev.args; let dot = "b", icon = "•", text = "";
      switch (ev.name) {
        case "CircleCreated": icon = "✦"; text = `Circle created by <b>${who(a.creator)}</b>`; break;
        case "MemberJoined": dot = "g"; icon = "+"; text = `<b>${a.nickname ? esc(a.nickname) : who(a.member)}</b> joined and locked a deposit`; break;
        case "MemberLeft": dot = "y"; icon = "−"; text = `<b>${who(a.member)}</b> left — deposit refunded`; break;
        case "NicknameSet": icon = "✎"; text = `${short(a.member)} is now <b>${esc(a.nickname)}</b>`; break;
        case "CircleStarted": icon = "▶"; text = `Circle started — round 1 begins`; break;
        case "Contributed": dot = "g"; icon = "✓"; text = `<b>${who(a.member)}</b> paid round ${Number(a.round) + 1}`; break;
        case "DepositUsed": dot = "r"; icon = "!"; text = `<b>${who(a.member)}</b> missed round ${Number(a.round) + 1} — covered by deposit`; break;
        case "RoundSettled": dot = "y"; icon = "★"; text = `Round ${Number(a.round) + 1}: <b>${fmt(a.pot)}</b> sent to <b>${who(a.recipient)}</b>`; break;
        case "CircleCompleted": dot = "g"; icon = "🏁"; text = `Circle completed — deposits returned, badges awarded 🏅`; break;
        case "CircleCancelled": dot = "r"; icon = "×"; text = Number(a.round) === 0 && a.defaulter === ethers.ZeroAddress ? "Circle cancelled — deposits refunded" : `Circle dissolved after a repeat miss by <b>${who(a.defaulter)}</b>`; break;
        default: return "";
      }
      return `<li${idx >= 6 ? ' class="more"' : ""}><span class="dot ${dot}">${icon}</span><div class="t">${text}</div><a class="when" href="${txUrl(log.transactionHash)}" target="_blank" rel="noopener">${(log.timestamp || times[log.blockNumber]) ? relTime(log.timestamp || times[log.blockNumber]) : "view"} ↗</a></li>`;
    }).join("");
    el.innerHTML = items
      ? `<ul class="timeline">${items}</ul>${events.length > 6 ? `<button class="btn small ghost" id="more-activity">Show all ${events.length} events</button>` : ""}`
      : `<span class="small muted">No activity yet.</span>`;
    const more = $("#more-activity");
    if (more) more.onclick = () => { $(".timeline", el).classList.add("expanded"); more.remove(); };
  } catch (e) { console.error(e); el.innerHTML = `<span class="small muted">Activity couldn't be loaded from this network right now.</span>`; }
}

// ------------------------------------------------------------------ profile
async function viewProfile(param) {
  const view = $("#view");
  const addr = param === "me" ? state.account : param;
  if (!addr || !ethers.isAddress(addr)) {
    view.innerHTML = `<a class="back" href="#/">← Home</a><div class="card empty"><div class="em">👤</div><p>${param === "me" ? "Connect your wallet to see your savings profile." : "That isn't a valid wallet address."}</p>${param === "me" ? '<button class="btn primary" data-act="connect">Connect wallet</button>' : ""}</div>`;
    return;
  }
  const address = ethers.getAddress(addr);
  const isMe = same(address, state.account);
  view.innerHTML = `<a class="back" href="#/">← Home</a><div class="skeleton" style="min-height:260px"></div>`;
  let r, badges, circles;
  try {
    [r, badges, circles] = await Promise.all([
      loadReputation(address), loadBadges(address),
      reader.getUserCircles(address).then((ids) => Promise.all([...new Set(ids.map(Number))].reverse().map(loadCircle))),
    ]);
  } catch (e) { console.error(e); view.innerHTML = `<a class="back" href="#/">← Home</a><div class="card empty"><div class="em">📡</div>Couldn't load this profile. <button class="btn small secondary" data-act="reload">Retry</button></div>`; return; }
  if (!location.hash.startsWith("#/u/")) return;
  circles = circles.filter((c) => same(c.creator, address) || c.members.some((m) => same(m.address, address)));
  const nick = circles.flatMap((c) => c.members).find((m) => same(m.address, address) && m.nickname)?.nickname;
  const who = { address, nickname: nick || "" };
  const t = tierOf(r);
  const badgeHtml = badges.length ? `<div class="badge-grid">${badges.map((b) => `<a class="badge-card" href="#/circle/${b.attrs["Circle ID"]}">
      <img src="${esc(b.image)}" alt="${esc(b.name)}" loading="lazy"><div class="small"><b>${esc(b.attrs.Circle)}</b><br><span class="muted">${b.attrs["Perfect record"] === "Yes" ? "Perfect record" : `${b.attrs["Missed payments"]} missed`} · #${b.id}</span></div></a>`).join("")}</div>`
    : `<p class="muted small" style="margin:6px 0 0">No badges yet. Every member of a completed circle earns one.</p>`;
  view.innerHTML = `<a class="back" href="#/">← Home</a>
    <div class="profile-head">${avatar(who, "xl")}<div style="min-width:0">
      <h1>${esc(nick || (isMe ? "Your profile" : short(address)))}</h1>
      <div class="small muted"><a class="mono" href="${addrUrl(address)}" target="_blank" rel="noopener">${short(address)}</a> · <span class="tier ${t.cls}">${t.name}</span>${isMe ? " · you" : ""}</div></div></div>
    <div class="profile-grid">
      <div class="card pad-lg" style="text-align:center"><b>Savings score</b>${gaugeSVG(r)}
        <p class="tiny muted" style="margin:4px 0 0">From on-chain history: +150 per completed circle, +4 per on-time payment, −40 per missed payment, −300 per default.</p></div>
      <div class="card pad-lg"><b>Track record</b><div class="kv" style="margin-top:10px">
        <div><div class="k">Completed</div><div class="v">${r.completed}</div></div>
        <div><div class="k">On-time payments</div><div class="v">${r.onTimePayments}</div></div>
        <div><div class="k">Missed</div><div class="v" style="${r.missedPayments ? "color:var(--danger)" : ""}">${r.missedPayments}</div></div>
        <div><div class="k">Defaults</div><div class="v" style="${r.defaulted ? "color:var(--danger)" : ""}">${r.defaulted}</div></div>
      </div><p class="tiny muted" style="margin:10px 0 0">Recorded by the smart contract. Nobody can edit it, including the app's developers.</p></div>
    </div>
    <div class="section-head"><div><h2>Badges</h2><p>Soulbound NFTs: earned, never bought or transferred.</p></div><span class="pill plain">${badges.length}</span></div>
    ${badgeHtml}
    <div class="section-head"><div><h2>Circles</h2></div></div>
    ${circles.length ? `<div class="grid">${circles.map(circleCard).join("")}</div>` : `<div class="card empty">No circles yet.</div>`}`;
}

// ------------------------------------------------------------------ share & calendar
function circleUrl(id) { return location.href.split("#")[0] + `#/circle/${id}`; }
async function share(id) {
  const c = state.current?.id === Number(id) ? state.current : (state.explore || state.mine || []).find((x) => x.id === Number(id)) || await loadCircle(id);
  const url = circleUrl(id);
  const text = `Join my savings circle "${c.name}" on Electroneum: ${fmt(c.contribution)} every ${humanDuration(c.roundDuration)}, pot ${fmt(c.contribution * BigInt(c.size))}.`;
  let qr = "";
  try { const q = window.qrcode(0, "M"); q.addData(url); q.make(); qr = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch {}
  const m = openModal(`<h3>Invite to ${esc(c.name)}</h3><p class="small muted" style="margin:0">Scan with a phone camera or wallet app, or send the link.</p>
    ${qr ? `<div class="qr">${qr}</div>` : ""}
    <div class="copy-row"><input readonly value="${esc(url)}" id="share-url" aria-label="Circle link"><button class="btn secondary" id="copy-btn">Copy</button></div>
    <div class="actions" style="margin-top:10px">
      <a class="btn secondary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(text + " " + url)}">WhatsApp</a>
      <a class="btn secondary" target="_blank" rel="noopener" href="https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}">Telegram</a>
      ${navigator.share ? `<button class="btn secondary" id="native-share">More…</button>` : ""}
    </div>
    <button class="btn ghost block" data-close-btn style="margin-top:8px">Close</button>`);
  $("#copy-btn", m).onclick = async () => { try { await navigator.clipboard.writeText(url); } catch { $("#share-url", m).select(); document.execCommand("copy"); } $("#copy-btn", m).textContent = "Copied ✓"; };
  const ns = $("#native-share", m); if (ns) ns.onclick = () => navigator.share({ title: c.name, text, url }).catch(() => {});
}
function downloadIcs(c) {
  const stamp = (ts) => new Date(ts * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const start = Math.max(now() + 60, c.deadline - 3600);
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ETN Savings Circles//EN", "BEGIN:VEVENT",
    `UID:circle-${c.id}-round-${c.round}@etn-savings-circles`, `DTSTAMP:${stamp(now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(c.deadline)}`,
    `SUMMARY:Pay ${fmt(c.contribution)} — ${c.name.replace(/[,;\\]/g, " ")} (round ${c.round + 1})`,
    `DESCRIPTION:Round ${c.round + 1} payment deadline. Pay here: ${circleUrl(c.id)}`, `URL:${circleUrl(c.id)}`,
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Savings circle payment due", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = `savings-circle-${c.id}-round-${c.round + 1}.ics`;
  document.body.append(a); a.click(); a.remove();
  toast("📅 Reminder downloaded. Open it to add to your calendar.");
}

// ===================================================================== routing & events
async function route({ keepScroll = false } = {}) {
  renderChrome();
  const m = location.hash.match(/^#\/circle\/(\d+)$/);
  if (m) return viewCircle(Number(m[1]));
  if (location.hash === "#/new") return viewCreate();
  const u = location.hash.match(/^#\/u\/(me|0x[0-9a-fA-F]{40})$/);
  if (u) return viewProfile(u[1]);
  if (location.hash === "#circles") return; // in-page anchor
  return viewHome();
}
window.addEventListener("hashchange", () => { if (location.hash !== "#circles") window.scrollTo(0, 0); route(); });

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  ev.preventDefault();
  const id = el.dataset.id !== undefined ? BigInt(el.dataset.id) : null;
  const amt = el.dataset.amt ? BigInt(el.dataset.amt) : 0n;
  el.disabled = true;
  try {
    switch (el.dataset.act) {
      case "connect": await connect(); break;
      case "switch": await syncWallet(true); break;
      case "reload": state.explore = state.mine = null; await route(); break;
      case "withdraw": await sendTx("Withdraw", (c) => c.withdraw(), { celebrate: true }); break;
      case "join": { if (!haveFunds(amt, "Joining")) break; const nick = ($("#j-nick")?.value || "").trim(); await sendTx("Join circle", (c) => c.join(id, nick, { value: amt }), { celebrate: true }); break; }
      case "leave": if (confirm("Leave this circle? Your deposit will be ready to collect.")) await sendTx("Leave circle", (c) => c.leave(id)); break;
      case "pay": if (!haveFunds(amt, "This payment")) break; await sendTx("Pay contribution", (c) => c.contribute(id, { value: amt })); break;
      case "settle": await sendTx("Settle round", (c) => c.settleRound(id), { celebrate: true }); break;
      case "cancel": if (confirm("Cancel this circle? Everyone who joined gets their deposit back.")) await sendTx("Cancel circle", (c) => c.cancelForming(id)); break;
      case "nick": { const v = prompt("Your nickname in this circle (max 32 characters):", meIn(state.current)?.nickname || ""); if (v !== null) await sendTx("Update nickname", (c) => c.setNickname(id, v.trim().slice(0, 32))); break; }
      case "share": await share(Number(id)); break;
      case "ics": downloadIcs(state.current); break;
    }
  } finally { el.disabled = false; }
});
$("#connect").onclick = () => { if (state.account) location.hash = "#/u/me"; else connect(); };
document.addEventListener("click", (ev) => {
  if (ev.target.closest("[data-goto-open]")) { state.tab = "open"; }
});

setInterval(() => {
  $$("[data-deadline]").forEach((el) => el.textContent = countdown(Number(el.dataset.deadline)));
  $$("[data-arc-deadline]").forEach((el) => {
    const left = Math.max(0, Math.min(1, (Number(el.dataset.arcDeadline) - now()) / Number(el.dataset.arcDuration)));
    el.setAttribute("stroke-dashoffset", Number(el.dataset.arcCirc) * (1 - left));
  });
}, 1000);

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

route();
syncWallet().catch(() => {});
