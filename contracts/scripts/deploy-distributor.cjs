/*
  Deploy the RewardsDistributor.

  The owner is the only address that can create a round, and creating a round
  is what moves money, so it is set explicitly rather than defaulting quietly
  to whoever happened to run this. REWARDS_OWNER wins; the deployer is used
  only when it is not set, and the script says which one it took.

  Reads the private key from DEPLOYER_PRIVATE_KEY, which is never committed
  and never printed.
*/
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY.");

  const requested = (process.env.REWARDS_OWNER || "").trim();
  if (requested && !hre.ethers.isAddress(requested)) {
    throw new Error(`REWARDS_OWNER is not an address: ${requested}`);
  }
  const owner = requested ? hre.ethers.getAddress(requested) : deployer.address;

  console.log("Deploying from:", deployer.address);
  console.log("Network       :", hre.network.name);
  console.log("Owner         :", owner, requested ? "(from REWARDS_OWNER)" : "(deployer)");

  const Distributor = await hre.ethers.getContractFactory("RewardsDistributor");
  const distributor = await Distributor.deploy(owner);
  await distributor.waitForDeployment();

  const address = await distributor.getAddress();
  const receipt = await distributor.deploymentTransaction().wait();

  console.log("");
  console.log("Deployed at :", address);
  console.log("Block       :", receipt.blockNumber);
  console.log("");
  console.log("Next: set VITE_REWARDS_DISTRIBUTOR_ADDRESS in Vercel (type Config,");
  console.log("not Secret -- VITE_ vars are read at build time) and redeploy.");
  console.log("Until that is set, the claim panel stays hidden.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
