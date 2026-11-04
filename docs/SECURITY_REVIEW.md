# Security review: ETN Savings Circles v3

**Date:** 4 November 2026
**Scope:** `contracts/SavingsCircles.sol` and `contracts/SavingsBadges.sol` (v3, testnet deployment `0x850Aca8d6E879830526dd1cD72919b0E71E0b106`), the keeper and demo-crew bots (`scripts/`), and the web app's hosting configuration.
**Type:** internal review by the project team: manual code review, plus tests that measure each finding on a local chain (`test/SecurityReview.test.js`). This is **not an independent audit**. An external audit is still required before mainnet use with real funds.

## Summary

No bug was found that lets anyone take funds the contract doesn't owe them. Payouts use the pull pattern behind a reentrancy guard, the contract stays solvent in every path checked, and nobody holds admin keys.

The main risks are economic and come from the rotating-savings model itself. Two need contract changes (v4) before mainnet. Three smaller issues in the bot, the site headers and the app copy were fixed during the review.

| ID | Finding | Severity | Status |
|---|---|---|---|
| SC-01 | An early recipient can take the pot and stop paying | High | Open: needs v4 |
| SC-02 | A track record can be farmed for about 0.001 ETN | Medium | Open: needs v4 |
| SC-03 | Telegram bot reposted user-chosen names, which allowed phishing links | Medium | Fixed |
| SC-04 | No Content-Security-Policy on the web app | Low | Fixed |
| SC-05 | App and bot copy overstated what deposits protect | Low | Fixed |
| SC-06 | Rounds only advance when someone settles them | Info | Accepted |
| SC-07 | The creator chooses the payout order in invite-only circles | Info | Accepted |
| SC-08 | Gas cost of finishing a 50-member circle | Info | Checked: fine |
| SC-09 | Contract cannot be paused or upgraded | Info | Accepted |

## Findings

### SC-01 · High · An early recipient can take the pot and stop paying

**What happens.** Each member locks a deposit equal to one contribution. That deposit covers one missed payment, and a second miss dissolves the circle. A member who receives the pot early can stop paying straight after. Their first miss is covered by their deposit, the second dissolves the circle, and they keep the pot.

**Measured** (5 members, 1 ETN each, attacker in seat 1):

| Member | Paid in | Received | Net |
|---|---|---|---|
| Attacker (seat 1) | 2 ETN | 5 ETN | **+3 ETN** |
| Seat 2 | 4 ETN | 7 ETN | +3 ETN |
| Seats 3–5 (each) | 4 ETN | 2 ETN | **−2 ETN** |

In general the first recipient can gain up to (members − 2) × contribution, paid for by the members who were still waiting for their turn. The attacker's record does show the default, but a fresh wallet costs nothing.

**Where the risk is highest.** In open circles with no track-record requirement, payout order is join order, so whoever joins first gets the first pot. The invite-only case is similar if the creator puts an untrusted address early (SC-07).

**Recommendations for v4** (product decisions; they can be combined):
1. **Collateral by seat.** Require a larger deposit for earlier seats, sized to what that seat still owes after its payout.
2. **Withhold from the payout.** Hold back part of each pot to cover the recipient's remaining contributions, and pay those contributions from it automatically. This is the strongest protection, but it reduces the early "credit" benefit.
3. **Seat order by track record.** In open circles, give the earliest payouts to members with proven records rather than to the first wallet to join.
4. **Until then,** the app should state plainly that you should only join circles with people you trust. The README already says this.

### SC-02 · Medium · A track record can be farmed for about 0.001 ETN

**What happens.** "Completed circles" counts every completion, whatever its size or length. Two wallets controlled by one person can complete a 2-member circle with 1-wei contributions and 1-minute rounds. That costs about 1.15M gas in total, or about 0.0012 ETN at today's 1 gwei. Repeat it N times to pass any `minCompleted` requirement.

**Why it matters.** The track-record requirement on open circles is the main protection against SC-01, and today it can be bought cheaply.

**Recommendations for v4:** only count circles above a minimum contribution, round length and member count. Weight reputation by value saved and rounds completed. In the app, show the amounts behind each record; badges already store the contribution.

### SC-03 · Medium · Telegram bot reposted user-chosen names (fixed)

**What happened.** Anyone can name a circle or choose a nickname. The keeper posted those strings to the public Telegram channel. The messages were plain text, so there was no markup injection, but Telegram still turns domains, URLs and @handles into clickable links. A circle named "Claim your airdrop at <phishing domain>" would have been posted by the official bot.

**Fix.** `safeText()` in `scripts/keeper-lib.js` replaces any name or nickname that contains a URL, domain or @handle with a neutral label ("Circle #12" or a short address). It also removes control and invisible characters and newlines. Tested in `test/SecurityReview.test.js`.

### SC-04 · Low · No Content-Security-Policy (fixed)

The app already escapes every user-supplied string it renders, and no injection was found. A CSP adds a second layer of defence. `netlify.toml` now sends a policy that only allows scripts from the site itself, and network connections only to the ETN RPC and explorer. It also sends a `Permissions-Policy` that denies camera, microphone and location access. Verified on the live site: the app loads and works under the policy. The only blocked script is the toolbar Netlify injects into hosted pages, which leaves a console message but does not affect the app.

### SC-05 · Low · Copy overstated what deposits protect (fixed)

The home page said "Deposits protect every member", and the bot's dissolve message said "All members were refunded". Both are untrue in the SC-01 scenario. They now read "Deposits cover a missed payment" and "This round's payments and unused deposits were refunded".

### SC-06 · Info · Rounds only advance when someone settles them

`settleRound` must be called after every round. Anyone can call it, and the keeper does so every 15 minutes, so a missing keeper delays a circle but never locks funds. The next deadline is measured from settlement time, so a late settlement makes the next round longer.

### SC-07 · Info · The creator chooses the payout order (invite-only circles)

This is by design and matches how offline savings groups work, but it means the creator can give themselves the first payout. Combined with SC-01, members should know who is in the first seats. The circle page shows the full order before anyone joins.

### SC-08 · Info · Gas cost of finishing a large circle (checked)

The final settlement of a circle returns every deposit and mints a badge for each member. At the 50-member maximum it uses 7.9M gas, well under the 30M ETN block gas limit, so large circles cannot get stuck. A normal round uses about 109k gas.

### SC-09 · Info · No pause or upgrade

The contract has no owner, so no admin key can move or freeze funds. The trade-off is that a bug can only be fixed by deploying a new version and having users move to it. For mainnet, consider a narrowly scoped emergency pause that can only stop new circles and never touches existing funds.

## Checked and found sound

- **Reentrancy:** `withdraw()` zeroes the balance before sending and has a reentrancy guard. No other function sends ETN.
- **Solvency:** every round's pot is fully covered by contributions plus used deposits. Dissolution and completion only return funds still held. Verified by the full-cycle and dissolution tests.
- **Badges:** minted with `_mint`, not `_safeMint`, so a member's contract cannot block the final settlement with a receiver callback. Transfers are blocked (soulbound), and only the circles contract can mint.
- **Inputs:** member count (2–50), name and nickname length, round length (1 minute to 365 days), zero addresses, duplicate members and exact payment amounts are all checked.
- **Overflow:** Solidity 0.8 checked arithmetic, and `uint128` contributions times 50 members cannot overflow.
- **Web app:** user strings are escaped before rendering, and badge images come from on-chain data URIs.
- **Secrets:** bot keys are only in GitHub Actions secrets and a gitignored local `.env`, and the repository history contains none.

## Not covered (next steps)

- An independent audit by a third-party firm before mainnet.
- Static analysis (Slither) and property-based fuzzing (Foundry or Echidna) of the solvency invariant: contract balance ≥ sum of withdrawable balances, plus held deposits and contributions.
- A review of the v4 changes for SC-01 and SC-02 once they're designed.
