# ETN Savings Circles

Rotating savings groups (ROSCAs) on Electroneum Smart Chain, paid in native ETN.

## The idea

Hundreds of millions of people save through informal rotating savings groups. They are called *chamas* in Kenya, *susu* in Ghana, *esusu* in Nigeria, *stokvels* in South Africa, *tandas* in Latin America and *tontines* in West Africa. A group agrees on a fixed contribution, everyone pays in every round, and one member takes the whole pot, rotating until everyone has received it once.

These groups rely on a trusted organizer holding cash. Money can be lost or stolen, records are kept by hand, and members can't easily prove their savings history.

Electroneum's users are mainly mobile-first users in emerging markets, which is the audience that already uses these groups. ETN Smart Chain transactions confirm in about 5 seconds and cost a tiny fraction of a cent. That makes per-round contributions practical even for very small amounts.

## How it works

1. **Create.** An organizer sets the contribution amount and round length, and chooses the circle type:
   - **Open:** a number of seats that anyone with the link can fill. The payout order is the join order.
   - **Invite-only:** an exact list of wallet addresses, which is also the payout order.
2. **Join.** Each member joins by locking a security deposit equal to one contribution, and can add a nickname. The circle starts when every seat is filled. Until then, a member can leave and get their deposit back, and the organizer can cancel the circle and refund everyone.
3. **Contribute.** Each round, every member pays the contribution before the deadline.
4. **Settle.** Once everyone has paid or the deadline passes, anyone can settle the round. The full pot is credited to that round's recipient.
5. **Missed payments.** A member's first missed payment is covered from their deposit, so the recipient still gets the full pot. If a member whose deposit is already used misses again, the circle dissolves: this round's contributions and every unused deposit are refunded.
6. **Finish.** After the last round, unused deposits are returned. Members collect their funds with `withdraw()`.

There is no admin key and no fee, and the contract can't be upgraded. Funds can only go to members, under the rules above. The contract also keeps network-wide totals (ETN paid out, rounds settled, circles completed) and a list of each user's circles, so apps can show them without an indexer.

## Deployment (testnet)

| | |
|---|---|
| Network | Electroneum Smart Chain testnet (chain ID 5201420) |
| Contract (v2) | [`0x689A45c44430C1b0DEc84132daaC06faE763Cb75`](https://testnet-blockexplorer.electroneum.com/address/0x689A45c44430C1b0DEc84132daaC06faE763Cb75) (source verified) |
| Showcase circles | #0 "Nairobi Market Chama": completed, all paid out. #1 "Accra Family Susu": active, weekly rounds. #2 "ETN Builders Circle": open, with free seats anyone can join. |
| v1 (previous) | [`0x6DF34bE78c79C2aEC2D04cEA818DB61De6bDEb6F`](https://testnet-blockexplorer.electroneum.com/address/0x6DF34bE78c79C2aEC2D04cEA818DB61De6bDEb6F) (invite-only circles, no nicknames) |

## Web app

**Live: https://etn-savings-circles.netlify.app** (ETN testnet)

`app/` contains a mobile-first web app with no build step. It works with MetaMask or any other injected wallet, and adds or switches to the ETN testnet automatically.

- **Animated circle view:** members sit around a ring in payout order, with the pot in the middle, a countdown to the deadline, and the current recipient highlighted.
- **Home page:** network-wide stats, an "Open to join" list, and a personal dashboard showing what you can collect, what you need to pay, when your payout turn comes, and rounds ready to settle.
- **Create flow:** open or invite-only circles, quick amount and round-length choices, and a live preview. You can create a circle and take seat #1 in one go.
- **Circle page:** join with a nickname, pay, settle, leave before the start, or cancel. Includes an on-chain activity timeline and every member's status.
- **Invites:** QR code, WhatsApp, Telegram, copy link, or the phone's share menu.
- **Reminders:** download a calendar reminder (.ics) for your next payment deadline.
- **Installable:** add it to your phone's home screen like an app (PWA), with dark and light mode.

```bash
npm run app        # http://localhost:5173
npm run test:e2e   # drives the app in headless Chrome against a local chain
```

The app is plain static files (`app/index.html`, `app/app.js`, `app/styles.css`, `app/config.js`, `app/vendor/`), so it can be hosted anywhere: GitHub Pages, Netlify, Vercel or IPFS.

## Development

```bash
npm install --legacy-peer-deps
npx hardhat test                                                # run tests
npx hardhat run scripts/deploy-savings.js --network etnTestnet  # deploy
npx hardhat run scripts/demo-circle.js --network etnTestnet     # seed showcase circles
```

Put your deployer key in `.env` as `PRIVATE_KEY=0x...`. That file is excluded from git.

## Known limitations and next steps

- The deposit covers one missed payment. A member who has already received the pot early in the rotation is only bound by that deposit. Possible fixes are larger deposits, or on-chain reputation that lets members who have finished circles cleanly join larger ones.
- Contributions are in native ETN only. A stable-value token option would help with price swings.
- The contract has tests but has not been externally audited. It needs an audit before mainnet use with real funds.
- Next steps: push or SMS payment reminders, integration with the ETN app wallet, and on-chain reputation from completed circles.
