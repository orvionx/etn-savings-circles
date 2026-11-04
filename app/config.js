// Network + contract configuration for the Savings Circles app.
// Dev overrides via query string: ?rpc=...&chainId=...&contract=...&fromBlock=...
export const NETWORKS = {
  etnTestnet: {
    name: "Electroneum Testnet",
    chainId: 5201420,
    rpc: "https://rpc.ankr.com/electroneum_testnet",
    explorer: "https://testnet-blockexplorer.electroneum.com",
    explorerApi: "https://testnet-blockexplorer.electroneum.com/api",
    contract: "0x850Aca8d6E879830526dd1cD72919b0E71E0b106",
    deployBlock: 16103543,
    faucet: "https://faucet.electroneum.com",
    // Left out of the Explore list (still reachable by link): #1 lost its members' keys,
    // #5, #6 and #9 were cancelled test circles.
    hiddenCircles: [1, 5, 6, 9],
  },
};

export function getConfig() {
  const base = { ...NETWORKS.etnTestnet };
  const q = new URLSearchParams(location.search);
  if (q.get("rpc")) base.rpc = q.get("rpc");
  if (q.get("chainId")) { base.chainId = Number(q.get("chainId")); base.name = `Chain ${base.chainId}`; base.faucet = null; base.explorerApi = null; base.hiddenCircles = []; }
  if (q.get("contract")) { base.contract = q.get("contract"); base.deployBlock = 0; base.explorerApi = null; base.hiddenCircles = []; }
  if (q.get("fromBlock")) base.deployBlock = Number(q.get("fromBlock"));
  return base;
}
