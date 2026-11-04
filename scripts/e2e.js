// End-to-end test: drives the real web app in headless Chrome against a local Hardhat
// node. A fake EIP-1193 wallet is injected into each page and forwards requests to
// the node's unlocked accounts.
//   node scripts/e2e.js        (needs Chrome or Edge installed)
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { ethers } = require("ethers");

const RPC = "http://127.0.0.1:8545";
const APP_PORT = 5174;
const OUT = process.env.E2E_OUT || path.join(__dirname, "..", "e2e-screens");
const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const procs = [];
function start(cmd, args, readyText) {
  return new Promise((resolve, reject) => {
    const p = spawn([cmd, ...args].join(" "), { shell: true, cwd: path.join(__dirname, "..") });
    procs.push(p);
    const onData = (d) => { if (d.toString().includes(readyText)) resolve(p); };
    p.stdout.on("data", onData); p.stderr.on("data", onData);
    p.on("exit", (code) => reject(new Error(`${cmd} exited with ${code}`)));
  });
}
function cleanup() { for (const p of procs) { try { process.platform === "win32" ? spawnSync("taskkill", ["/pid", String(p.pid), "/f", "/t"]) : p.kill(); } catch {} } }

let failures = 0;
function check(cond, msg) { console.log(`${cond ? "  ✔" : "  ✘"} ${msg}`); if (!cond) failures++; }

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await start("npx", ["hardhat", "node"], "Started HTTP and WebSocket JSON-RPC server");
  await start("node", ["scripts/serve.js", String(APP_PORT)], "Savings Circles app");

  const provider = new ethers.JsonRpcProvider(RPC);
  const deployer = await provider.getSigner(0);
  const artifact = require("../artifacts/contracts/SavingsCircles.sol/SavingsCircles.json");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const sc = await factory.deploy(); await sc.waitForDeployment();
  const contract = await sc.getAddress();
  const all = await provider.send("eth_accounts", []);
  const accounts = all.slice(1, 4);
  console.log(`Local contract ${contract}`);

  const executablePath = BROWSERS.find((b) => fs.existsSync(b));
  const browser = await puppeteer.launch({
    executablePath, headless: true, protocolTimeout: 60000,
    args: ["--no-sandbox", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
  const base = `http://localhost:${APP_PORT}/?rpc=${encodeURIComponent(RPC)}&chainId=31337&contract=${contract}`;
  const consoleErrors = [];

  async function openAs(account, viewport = { width: 390, height: 844 }) {
    const page = await browser.newPage();
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => consoleErrors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|favicon/.test(m.text())) consoleErrors.push(m.text()); });
    page.on("dialog", (d) => d.accept());
    await page.evaluateOnNewDocument((rpc, acct) => {
      let id = 0;
      const call = async (method, params = []) => {
        const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
        const j = await r.json();
        if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
        return j.result;
      };
      window.ethereum = {
        isMetaMask: true,
        request: async ({ method, params }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return acct ? [acct] : [];
          if (method.startsWith("wallet_")) return null;
          return call(method, params);
        },
        on() {}, removeListener() {},
      };
    }, RPC, account);
    await page.goto(base + "#/", { waitUntil: "networkidle0" });
    return page;
  }

  const clearToasts = (page) => page.evaluate(() => { document.querySelector("#toasts").innerHTML = ""; });
  async function waitDone(page, label, n = 1) {
    await page.waitForFunction((n) => [...document.querySelectorAll(".toast")].filter((t) => /done/.test(t.textContent)).length >= n
      || document.querySelectorAll(".toast.error").length, { timeout: 30000 }, n);
    const text = await page.$$eval(".toast", (ts) => ts.map((t) => t.textContent.replace(/×/g, "").trim()).join(" | "));
    check(!document_hasError(text) && text.includes("done"), `${label} → ${text}`);
  }
  function document_hasError(t) { return /error|wrong|cancelled|Not enough|isn't|already/i.test(t); }
  async function act(page, selector, label) {
    await page.bringToFront();
    await clearToasts(page);
    await page.waitForSelector(selector, { visible: true, timeout: 15000 });
    await page.click(selector);
    await waitDone(page, label);
  }
  const fresh = async (page, hash) => {
    await page.bringToFront();
    await page.goto("about:blank");
    await page.goto(`${base}${hash}`, { waitUntil: "networkidle0" });
  };
  const goCircle = async (page, id) => { await fresh(page, `#/circle/${id}`); await page.waitForSelector(".members"); };
  const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim());

  const a = await openAs(accounts[0]);
  const b = await openAs(accounts[1]);
  const c = await openAs(accounts[2]);
  const viewer = await openAs(null, { width: 1280, height: 900 });

  console.log("Home (no wallet)");
  await viewer.bringToFront();
  await viewer.waitForSelector(".hero h1");
  check((await text(viewer, ".hero h1")).includes("Save together"), "hero renders");
  await viewer.screenshot({ path: path.join(OUT, "1-home-desktop.png"), fullPage: true });

  console.log("Create an open circle and take seat #1");
  await a.bringToFront();
  await a.click("#connect");
  await a.waitForFunction(() => document.querySelector("#connect").textContent.includes("…"));
  await fresh(a, "#/new");
  await a.waitForSelector("#create-form");
  await a.type("#f-name", "E2E Open Susu");
  await a.click("#f-amount", { clickCount: 3 }); await a.type("#f-amount", "1.5");
  await a.click('#dur-chips [data-dur="300"]');
  await a.click('[data-step="-1"]'); await a.click('[data-step="-1"]');
  check((await text(a, "#f-seats")) === "3", "seat stepper set to 3");
  await a.type("#f-nick", "Amina");
  const pv = await text(a, "#pv-text");
  check(pv.includes("3 members") && pv.includes("4.5 ETN"), `live preview: ${pv.slice(0, 70)}…`);
  await a.screenshot({ path: path.join(OUT, "2-create.png"), fullPage: true });
  await clearToasts(a);
  await a.click("#create-btn");
  await waitDone(a, "create + take seat", 2);
  await a.waitForFunction(() => location.hash === "#/circle/0", { timeout: 15000 });
  await a.waitForSelector(".members");
  check((await text(a, ".members")).includes("Amina"), "creator seated as Amina");

  console.log("Others join via the link with nicknames");
  for (const [p, nick] of [[b, "Kofi"], [c, "Njeri"]]) {
    await goCircle(p, 0);
    await p.type("#j-nick", nick);
    await act(p, '.action-card [data-act="join"]', `${nick} joins`);
  }
  await goCircle(a, 0);
  check((await text(a, ".pill")).includes("Active"), "circle Active once all 3 seats are filled");
  check(/Amina.*Kofi.*Njeri/.test(await text(a, ".members")), "payout order = join order (Amina, Kofi, Njeri)");
  check(!!(await a.$(".ring-wrap svg .ring-node.current")), "ring highlights the current recipient");

  for (let r = 0; r < 3; r++) {
    console.log(`Round ${r + 1}`);
    for (const [i, p] of [a, b, c].entries()) { await goCircle(p, 0); await act(p, '.action-card [data-act="pay"]', `member ${i + 1} pays`); }
    if (r === 1) { await goCircle(c, 0); await c.screenshot({ path: path.join(OUT, "3-circle-active.png"), fullPage: true }); }
    await goCircle(b, 0);
    await act(b, '.action-card [data-act="settle"]', `settle round ${r + 1}`);
  }
  await goCircle(a, 0);
  check((await text(a, ".pill")).includes("Completed"), "circle Completed after 3 rounds");
  await a.waitForFunction(() => document.querySelector("#activity .timeline"), { timeout: 15000 });
  if (await a.$("#more-activity")) await a.click("#more-activity");
  const activity = await text(a, "#activity");
  check(/Amina joined/.test(activity) && /Round 3: 4\.5 ETN sent to Njeri/.test(activity), "activity timeline shows joins and payouts");
  await a.screenshot({ path: path.join(OUT, "3b-circle-completed.png"), fullPage: true });

  console.log("Reputation + badges");
  check(/★ 462/.test(await text(a, ".members")), "members list shows savings score chips (★ 462)");
  await fresh(a, `#/u/${accounts[0]}`);
  await a.waitForSelector(".badge-card img", { timeout: 20000 });
  const prof = await text(a, "#view");
  check(/Amina/.test(prof) && /Completed\s*1/.test(prof) && /On-time payments\s*3/.test(prof), "profile shows nickname and track record");
  check((await a.$$(".badge-card")).length === 1 && /Perfect record/.test(prof), "profile shows the soulbound badge (perfect record)");
  check(/462/.test(await text(a, ".gauge")), "savings score gauge = 462");
  await a.screenshot({ path: path.join(OUT, "3c-profile.png"), fullPage: true });

  console.log("Dashboard + withdraw");
  for (const [i, p] of [a, b, c].entries()) {
    await fresh(p, "#/");
    await p.waitForSelector('.collect [data-act="withdraw"]', { timeout: 15000 });
    const v = await text(p, ".collect .v");
    check(v === "6 ETN", `member ${i + 1} dashboard shows ${v} to collect (expected 6 ETN)`);
    if (i === 0) await p.screenshot({ path: path.join(OUT, "4-dashboard.png"), fullPage: true });
    await act(p, '.collect [data-act="withdraw"]', `member ${i + 1} withdraw`);
  }
  check((await provider.getBalance(contract)) === 0n, "contract balance is 0 after all withdrawals");

  console.log("Stats");
  await fresh(viewer, "#/");
  await viewer.waitForSelector('[data-key="paid"]');
  await new Promise((r) => setTimeout(r, 1200));
  check((await text(viewer, '[data-key="paid"]')) === "13.5", `stats: ETN paid out = ${await text(viewer, '[data-key="paid"]')}`);
  check((await text(viewer, '[data-key="badges"]')) === "3", `stats: badges earned = ${await text(viewer, '[data-key="badges"]')}`);

  console.log("Open circle: join then leave");
  await fresh(a, "#/new"); await a.waitForSelector("#create-form");
  await a.type("#f-name", "Leave test");
  await a.click("#f-seat");
  await act(a, "#create-btn", "create open circle without seat");
  await fresh(b, "#/"); await b.waitForSelector('[data-tab="open"]'); await b.click('[data-tab="open"]');
  await b.waitForSelector(".circle-card");
  check((await text(b, "#list")).includes("Leave test"), "'Open to join' tab lists the new circle");
  await goCircle(b, 1);
  await act(b, '.action-card [data-act="join"]', "Kofi joins circle #1");
  await goCircle(b, 1);
  await act(b, '.action-card [data-act="leave"]', "Kofi leaves circle #1");
  await fresh(b, "#/"); await b.waitForSelector(".collect .v");
  check((await text(b, ".collect .v")) === "1 ETN", "deposit back after leaving (1 ETN ready to collect)");

  console.log("Invite-only circle");
  await fresh(a, "#/new"); await a.waitForSelector("#create-form");
  await a.click('[data-type="invite"]');
  await a.type("#f-name", "Family Chama");
  await a.click("#add-me");
  await a.type("#f-members", "\n" + accounts[1] + "\n" + accounts[2]);
  await clearToasts(a);
  await a.click("#create-btn");
  await waitDone(a, "create invite-only circle + take seat", 2);
  await a.waitForFunction(() => location.hash === "#/circle/2", { timeout: 15000 });
  await goCircle(a, 2);
  check((await text(a, ".members")).includes("Invited"), "invitees show as Invited");
  await goCircle(c, 2);
  check((await text(c, ".action-card")).includes("You're invited"), "invitee sees the invitation");
  const outsider = await openAs(all[6]);
  await goCircle(outsider, 2);
  check((await text(outsider, ".action-card")).includes("Members only"), "outsider can't join an invite-only circle");

  console.log("Track-record requirement");
  await fresh(a, "#/new"); await a.waitForSelector("#create-form");
  await a.type("#f-name", "Trusted Savers");
  await a.click('#req-chips [data-req="1"]');
  check(/1\+ completed circle and no defaults/.test(await text(a, "#req-hint")), "requirement hint explains the rule");
  await clearToasts(a);
  await a.click("#create-btn");
  await waitDone(a, "create trusted circle + take seat (creator qualifies)", 2);
  await a.waitForFunction(() => location.hash === "#/circle/3", { timeout: 15000 });
  await goCircle(outsider, 3);
  check((await text(outsider, ".action-card")).includes("Track record required"), "newcomer sees 'Track record required' instead of Join");
  check(!(await outsider.$('.action-card [data-act="join"]')), "newcomer has no Join button");
  await goCircle(b, 3);
  await act(b, '.action-card [data-act="join"]', "Kofi (1 completed circle) joins the trusted circle");

  console.log("Share + validation");
  await goCircle(outsider, 2);
  await outsider.click('.card [data-act="share"]');
  await outsider.waitForSelector(".modal .qr svg");
  check((await outsider.$eval("#share-url", (e) => e.value)).endsWith("#/circle/2"), "share modal has QR code and circle link");
  await outsider.screenshot({ path: path.join(OUT, "5-share.png") });
  await fresh(outsider, "#/new"); await outsider.waitForSelector("#create-form");
  await outsider.click('[data-type="invite"]');
  await outsider.click("#f-amount", { clickCount: 3 }); await outsider.type("#f-amount", "abc");
  await outsider.type("#f-members", "0x123");
  await outsider.click("#create-btn");
  const err = await text(outsider, "#form-err");
  check(/name/.test(err) && /number/.test(err) && /valid address/.test(err), `form validation: ${err}`);

  console.log("Low balance");
  const poor = all[7];
  await provider.send("hardhat_setBalance", [poor, "0x" + ethers.parseEther("0.5").toString(16)]);
  const p = await openAs(poor);
  await fresh(p, "#/new"); await p.waitForSelector("#create-form");
  await p.type("#f-name", "Too big");
  await p.click("#f-amount", { clickCount: 3 }); await p.type("#f-amount", "5");
  check(/not enough for this deposit/.test(await text(p, "#seat-hint")), "form warns when the wallet can't cover the deposit");
  const before = Number(await provider.send("eth_blockNumber", []));
  await clearToasts(p); await p.click("#create-btn");
  await p.waitForSelector(".toast.error", { timeout: 15000 });
  check(/needs about .*5.01 ETN.*your wallet has .*0.5 ETN/.test(await text(p, ".toast.error")), "create is blocked with a clear message instead of a wallet error");
  check(Number(await provider.send("eth_blockNumber", [])) === before, "no transaction was sent");

  check(consoleErrors.length === 0, `no browser console errors${consoleErrors.length ? ": " + consoleErrors.join(" | ") : ""}`);
  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
  console.log(`Screenshots in ${OUT}`);
}

main().catch((e) => { console.error(e); failures++; }).finally(() => { cleanup(); process.exitCode = failures ? 1 : 0; setTimeout(() => process.exit(process.exitCode), 1500); });
