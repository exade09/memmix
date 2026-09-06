require("@nomicfoundation/hardhat-toolbox");

/*
  Contracts for the rewards vault.

  Robinhood Chain is an Arbitrum Orbit L2, so the EVM target is the same one
  the rest of the ecosystem compiles against. Optimizer runs are set high
  because these functions are called far more often than they are deployed --
  every transfer touches the reward accounting.
*/
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 800 } },
  },
  networks: {
    robinhood: {
      url: process.env.ROBINHOOD_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      // Never committed. Supplied only when a deploy is actually run.
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
