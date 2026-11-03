// Network + contract configuration for the Savings Circles app.
// Dev overrides via query string: ?rpc=...&chainId=...&contract=...
export const NETWORKS = {
  etnTestnet: {
    name: "Electroneum Testnet",
    chainId: 5201420,
    rpc: "https://rpc.ankr.com/electroneum_testnet",
    explorer: "https://testnet-blockexplorer.electroneum.com",
    contract: "0x6DF34bE78c79C2aEC2D04cEA818DB61De6bDEb6F",
    faucet: "https://faucet.electroneum.com",
  },
};

export function getConfig() {
  const base = { ...NETWORKS.etnTestnet };
  const q = new URLSearchParams(location.search);
  if (q.get("rpc")) base.rpc = q.get("rpc");
  if (q.get("chainId")) { base.chainId = Number(q.get("chainId")); base.name = `Chain ${base.chainId}`; }
  if (q.get("contract")) base.contract = q.get("contract");
  return base;
}
