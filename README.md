# ETN Savings Circles

[![CI](https://github.com/orvionx/etn-savings-circles/actions/workflows/ci.yml/badge.svg)](https://github.com/orvionx/etn-savings-circles/actions/workflows/ci.yml)

Rotating savings groups (ROSCAs) on Electroneum Smart Chain, paid in native ETN.

## The idea

Hundreds of millions of people save through informal rotating savings groups. They are called *chamas* in Kenya, *susu* in Ghana, *esusu* in Nigeria, *stokvels* in South Africa, *tandas* in Latin America and *tontines* in West Africa. A group agrees on a fixed contribution, everyone pays in every round, and one member takes the whole pot, rotating until everyone has received it once.

These groups rely on a trusted organizer holding cash. Money can be lost or stolen, records are kept by hand, and members can't easily prove their savings history.

Electroneum's users are mainly mobile-first users in emerging markets, which is the audience that already uses these groups. ETN Smart Chain transactions confirm in about 5 seconds and cost a tiny fraction of a cent. That makes per-round contributions practical even for very small amounts.

## How it works

1. **Create.** An organizer sets the contribution amount and round length, and chooses the circle type:
   - **Open:** a number of seats that anyone with the link can fill.
   - **Invite-only:** an exact list of wallet addresses.
2. **Join.** Each member joins by locking a security deposit equal to one contribution, and can add a nickname. Nobody has a payout slot yet. Until then, a member can leave and get their deposit back, and the organizer can cancel the circle and refund everyone.
   **Draw.** When the last seat fills, the circle closes and commits to a block 5 blocks ahead. Once that block exists, anyone can call `drawOrder`: its hash shuffles the members into payout slots and round 1 starts. The creator and the order of joining have no influence on the slots, and the result is the same whoever calls it. The keeper runs the draw automatically, and the app shows a button for it.
3. **Contribute.** Each round, every member pays the contribution before the deadline.
4. **Settle.** Once everyone has paid or the deadline passes, anyone can settle the round. The full pot is credited to that round's recipient.
5. **Missed payments.** A member's first missed payment is covered from their deposit, so the recipient still gets the full pot. If a member whose deposit is already used misses again, the circle dissolves: this round's contributions and every unused deposit are refunded.
6. **Finish.** After the last round, unused deposits are returned and every member receives a **soulbound badge NFT**. Members collect their funds with `withdraw()`.

There is no admin key and no fee, and the contract can't be upgraded. Funds can only go to members, under the rules above. The contract also keeps network-wide totals (ETN paid out, rounds settled, circles completed) and a list of each user's circles, so apps can show them without an indexer.

## Savings reputation

Every address builds an on-chain savings history that no one can edit, including the developers:

| Recorded | When |
|---|---|
| Circles joined | On joining (undone if the member leaves before the start) |
| Circles completed | When the last round settles |
| On-time payments | On every contribution before the deadline |
| Missed payments | When a deposit covers a missed contribution |
| Defaults | When a member's repeat miss dissolves a circle |

- **Track-record circles.** Open circles can require a minimum number of completed circles and no defaults (`createOpenCircle(..., minCompleted)`). This lets proven savers form safer, larger circles, and gives newcomers a path: complete a small circle first.
- **Badges.** `SavingsBadges` is an ERC-721 that cannot be transferred, minted only by the circles contract. Each badge's JSON metadata and SVG artwork are generated on-chain from the circle's data, so they show up in wallets and on the explorer with nothing hosted off-chain.
- **Savings score** (computed in the app from the on-chain record, so the formula is transparent): `300 + 150 × completed + 4 × on-time − 40 × missed − 300 × defaults`, clamped to 0–1000. Tiers: Bronze, Silver (650+), Gold (850+), and "At risk" for anyone with a default.

## Keeper bot

`scripts/keeper.js` keeps circles moving without a server:

- It **settles rounds** as soon as everyone has paid or the deadline passes, paying the gas from a dedicated keeper wallet.
- It sends **reminders** 24 hours before a deadline (or at 25% of the round time for short rounds), naming members who haven't paid.
- It **announces** payouts, completed circles and dissolved circles.
- It runs every 15 minutes on **GitHub Actions** (`.github/workflows/keeper.yml`). Messages go to the workflow log, and to a Telegram chat if `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` secrets are set.

```bash
npm run keeper:dry   # report what would happen
npm run keeper       # settle due rounds (needs KEEPER_PRIVATE_KEY in .env)
```

### Demo crew

So the live app and the Telegram channel always show real activity, five testnet wallets
(Ada, Bola, Chidi, Dayo and Efe) keep a demo circle running. Its name always starts with
**"Demo:"** so nobody mistakes it for real users.

- The crew saves 0.05 ETN a day in an invite-only circle and starts a new one when it completes.
- Members pay at staggered times through the day, and a different member pays last each round,
  so reminders, settlements and payouts all appear naturally.
- `scripts/demo-crew.js` runs in the keeper workflow before the keeper. The wallets are derived
  from the keeper key, so no extra secret is needed, and the keeper wallet tops them up when they run low.

```bash
npm run demo-crew -- --addresses   # list the crew wallets and balances
npm run demo-crew -- --dry-run     # report what would happen
```

## Deployment (testnet)

| | |
|---|---|
| Network | Electroneum Smart Chain testnet (chain ID 5201420) |
| SavingsCircles (v4) | [`0x70Dc7BbB33eb72b361293B5e0823DcC0eE88aed5`](https://testnet-blockexplorer.electroneum.com/address/0x70Dc7BbB33eb72b361293B5e0823DcC0eE88aed5) (source verified) |
| SavingsBadges | [`0x4265Fcbf4d636Af9FadEa8c7ddB892acB6a865D6`](https://testnet-blockexplorer.electroneum.com/address/0x4265Fcbf4d636Af9FadEa8c7ddB892acB6a865D6) (source verified) |
| Demo circle | #0 "Demo: Lagos Traders Ajo", run by the demo crew. Earlier showcase circles remain on v3. |
| Previous versions | v3 [`0x850Aca8d…E71E0b106`](https://testnet-blockexplorer.electroneum.com/address/0x850Aca8d6E879830526dd1cD72919b0E71E0b106) (first-come and creator-set payout order), v2 [`0x689A45c4…3Cb75`](https://testnet-blockexplorer.electroneum.com/address/0x689A45c44430C1b0DEc84132daaC06faE763Cb75), v1 [`0x6DF34bE7…bDEb6F`](https://testnet-blockexplorer.electroneum.com/address/0x6DF34bE78c79C2aEC2D04cEA818DB61De6bDEb6F) (reputation starts fresh in v3) |

## Web app

**Live: https://etn-savings-circles.netlify.app** (ETN testnet)

`app/` contains a mobile-first web app with no build step. It works with MetaMask or any other injected wallet, and adds or switches to the ETN testnet automatically.

- **Animated circle view:** members sit around a ring in payout order, with the pot in the middle, a countdown to the deadline, and the current recipient highlighted.
- **Home page:** network-wide stats, an "Open to join" list, and a personal dashboard showing what you can collect, what you need to pay, when your payout turn comes, and rounds ready to settle.
- **Create flow:** open or invite-only circles, quick amount and round-length choices, and a live preview. You can create a circle and take seat #1 in one go.
- **Circle page:** join with a nickname, pay, settle, leave before the start, or cancel. Includes an on-chain activity timeline and every member's status.
- **Invites:** QR code, WhatsApp, Telegram, copy link, or the phone's share menu.
- **Reminders:** download a calendar reminder (.ics) for your next payment deadline.
- **Savings profiles:** a score gauge, track record and badge gallery for any address, plus score chips next to every member, a "Savings score" card on the dashboard, and eligibility checks for track-record circles.
- **Installable:** add it to your phone's home screen like an app (PWA), with dark and light mode.

```bash
npm run app        # http://localhost:5173
npm run test:e2e   # drives the app in headless Chrome against a local chain
```

The app is plain static files (`app/index.html`, `app/app.js`, `app/styles.css`, `app/config.js`, `app/vendor/`), so it can be hosted anywhere: GitHub Pages, Netlify, Vercel or IPFS.

## Development

Every push runs the contract tests and the end-to-end browser tests on GitHub Actions (`.github/workflows/ci.yml`), and pushes to `main` deploy the app to Netlify when they pass.

```bash
npm install --legacy-peer-deps
npx hardhat test                                                # run tests
npx hardhat run scripts/deploy-savings.js --network etnTestnet  # deploy
npx hardhat run scripts/demo-circle.js --network etnTestnet     # seed showcase circles
```

Put your deployer key in `.env` as `PRIVATE_KEY=0x...`. That file is excluded from git.

## Known limitations and next steps

An internal security review with measured findings is in [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md).

- The deposit covers one missed payment. The draw stops anyone choosing the first slot, but whoever lands there is only bound by that deposit and their reputation after collecting the pot. Stronger collateral is the next contract change.
- The draw uses a block hash, which is as unpredictable as the chain's validators. A validator who is also a member could try to influence it. A VRF or commit-reveal scheme would remove that trust before mainnet.
- Reputation can be farmed by running small circles between your own wallets; it costs only gas. Weighting by amount saved, or attestations from known savers, would make it harder to game.
- Contributions are in native ETN only. A stable-value token option would help with price swings.
- The contract has tests but has not been externally audited. It needs an audit before mainnet use with real funds.
- Next steps: integration with the ETN app wallet, SMS reminders, and stable-value contributions.
