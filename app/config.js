// Network + contract configuration for the Savings Circles app.
// Dev overrides via query string: ?rpc=...&chainId=...&contract=...&fromBlock=...
export const NETWORKS = {
  etnTestnet: {
    name: "Electroneum Testnet",
    chainId: 5201420,
    rpc: "https://rpc.ankr.com/electroneum_testnet",
    explorer: "https://testnet-blockexplorer.electroneum.com",
    explorerApi: "https://testnet-blockexplorer.electroneum.com/api",
    contract: "0x9dF0D98BEf8c835f17d713488fA18aAf6677AB89",
    deployBlock: 16136197,
    faucet: "https://faucet.electroneum.com",
    // Circle ids left out of the Explore list (still reachable by link).
    hiddenCircles: [],
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
