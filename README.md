# ETN Savings Circles

Rotating savings groups (ROSCAs) on Electroneum Smart Chain, paid in native ETN.

## The idea

Hundreds of millions of people save through informal rotating savings groups. They are called *chamas* in Kenya, *susu* in Ghana, *esusu* in Nigeria, *stokvels* in South Africa, *tandas* in Latin America and *tontines* in West Africa. A group agrees on a fixed contribution, everyone pays in every round, and one member takes the whole pot, rotating until everyone has received it once.

These groups rely on a trusted organizer holding cash. Money can be lost or stolen, records are kept by hand, and members can't easily prove their savings history.

Electroneum's users are mainly mobile-first users in emerging markets, which is the audience that already uses these groups. ETN Smart Chain transactions confirm in about 5 seconds and cost a tiny fraction of a cent. That makes per-round contributions practical even for very small amounts.

## How it works

1. **Create.** An organizer sets the member list (which is also the payout order), the contribution amount and the round length.
2. **Join.** Each member joins by locking a security deposit equal to one contribution. The circle starts when everyone has joined. Before it starts, the organizer can cancel it and all deposits are refunded.
3. **Contribute.** Each round, every member pays the contribution before the deadline.
4. **Settle.** Once everyone has paid or the deadline passes, anyone can settle the round. The full pot is credited to that round's recipient.
5. **Missed payments.** A member's first missed payment is covered from their deposit, so the recipient still gets the full pot. If a member whose deposit is already used misses again, the circle dissolves: this round's contributions and every unused deposit are refunded.
6. **Finish.** After the last round, unused deposits are returned. Members collect their funds with `withdraw()`.

There is no admin key and no fee, and the contract can't be upgraded. Funds can only go to members, under the rules above.

## Deployment (testnet)

| | |
|---|---|
| Network | Electroneum Smart Chain testnet (chain ID 5201420) |
| Contract | [`0x6DF34bE78c79C2aEC2D04cEA818DB61De6bDEb6F`](https://testnet-blockexplorer.electroneum.com/address/0x6DF34bE78c79C2aEC2D04cEA818DB61De6bDEb6F) (source verified) |
| Live demo | Circle #0, "ETN Demo Chama". 3 members ran 3 rounds to completion and all funds were paid out. |

## Web app

**Live: https://etn-savings-circles.netlify.app** (ETN testnet)

`app/` contains a mobile-first web app with no build step. It works with MetaMask or any other injected wallet, and adds or switches to the ETN testnet automatically.

- Browse all circles, or only your own, without connecting a wallet.
- Create a circle and see a live summary of the pot, the number of rounds and the deposit.
- Join, pay each round, settle rounds, and cancel a forming circle.
- See a live countdown to each round's deadline, and every member's paid or joined status.
- Collect payouts and refunds with one button.
- Share a circle link to invite members.

```bash
npm run app        # http://localhost:5173
npm run test:e2e   # drives the app in headless Chrome against a local chain
```

The app is plain static files (`app/index.html`, `app/config.js`, `app/vendor/`), so it can be hosted anywhere: GitHub Pages, Netlify, Vercel or IPFS.

## Development

```bash
npm install --legacy-peer-deps
npx hardhat test                                                # run tests
npx hardhat run scripts/deploy-savings.js --network etnTestnet  # deploy
npx hardhat run scripts/demo-circle.js --network etnTestnet     # run a demo circle
```

Put your deployer key in `.env` as `PRIVATE_KEY=0x...`. That file is excluded from git.

## Known limitations and next steps

- The deposit covers one missed payment. A member who has already received the pot early in the rotation is only bound by that deposit. Possible fixes are larger deposits, or on-chain reputation that lets members who have finished circles cleanly join larger ones.
- Contributions are in native ETN only. A stable-value token option would help with price swings.
- The contract has tests but has not been externally audited. It needs an audit before mainnet use with real funds.
- Next steps: payment reminders (push or SMS), host the app publicly, and integrate it with the ETN app wallet.
