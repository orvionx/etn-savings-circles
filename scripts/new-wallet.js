// Creates a fresh deployer wallet and stores its key in .env (never printed).
const fs = require("fs");
const { Wallet } = require("ethers");
if (fs.existsSync(".env") && /PRIVATE_KEY=0x/.test(fs.readFileSync(".env", "utf8"))) {
  console.log("A PRIVATE_KEY already exists in .env; not overwriting.");
  process.exit(0);
}
const w = Wallet.createRandom();
fs.writeFileSync(".env", `PRIVATE_KEY=${w.privateKey}\n`);
console.log(`New deployer address: ${w.address}`);
