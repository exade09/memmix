/*
  Deploy $FONS.

  Reads the private key from DEPLOYER_PRIVATE_KEY, which is never committed
  and never printed. The whole supply lands with the deployer; the pool and
  the vault should be excluded from rewards immediately afterwards, or a
  large share of every distribution accrues to addresses that cannot claim it.
*/
const hre = require("hardhat");

async function main() {
  const name = process.env.TOKEN_NAME || "Fons";
  const symbol = process.env.TOKEN_SYMBOL || "FONS";
  const supply = hre.ethers.parseEther(process.env.TOKEN_SUPPLY || "1000000000");

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No signer. Set DEPLOYER_PRIVATE_KEY.");

  console.log("Deploying from:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log(`Token: ${name} (${symbol}), supply ${hre.ethers.formatEther(supply)}`);

  const Token = await hre.ethers.getContractFactory("FonsToken");
  const token = await Token.deploy(name, symbol, supply, deployer.address);
  await token.waitForDeployment();

  const address = await token.getAddress();
  const receipt = await token.deploymentTransaction().wait();

  console.log("");
  console.log("Deployed at :", address);
  console.log("Block       :", receipt.blockNumber, "<- FONS_TOKEN_START_BLOCK");
  console.log("");
  console.log("Next: exclude the pool and the vault with setExcludedFromRewards(),");
  console.log("then set FONS_TOKEN_ADDRESS and FONS_TOKEN_START_BLOCK in Vercel.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
