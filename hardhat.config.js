require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "paris" } },
  networks: {
    etnTestnet: {
      url: process.env.ETN_TESTNET_RPC || "https://rpc.ankr.com/electroneum_testnet",
      chainId: 5201420,
      accounts,
    },
    etnMainnet: {
      url: process.env.ETN_MAINNET_RPC || "https://rpc.ankr.com/electroneum",
      chainId: 52014,
      accounts,
    },
  },
  etherscan: {
    apiKey: { etnTestnet: "empty", etnMainnet: "empty" },
    customChains: [
      {
        network: "etnTestnet",
        chainId: 5201420,
        urls: {
          apiURL: "https://testnet-blockexplorer.electroneum.com/api",
          browserURL: "https://testnet-blockexplorer.electroneum.com",
        },
      },
      {
        network: "etnMainnet",
        chainId: 52014,
        urls: {
          apiURL: "https://blockexplorer.electroneum.com/api",
          browserURL: "https://blockexplorer.electroneum.com",
        },
      },
    ],
  },
  sourcify: { enabled: false },
};
