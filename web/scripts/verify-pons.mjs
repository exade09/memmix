/*
  Proves the calldata we build is accepted by the deployed factory.

  eth_call only: nothing is signed and nothing is sent. Two probes:

  1. value = 0            -> must revert LaunchFeeNotPaid. Reaching that check
                             means the tuple decoded, so the ABI is right.
  2. value = launchFee    -> must get past every validation in _launchToken.
*/
import { createPublicClient, http, decodeErrorResult, parseAbiItem } from "viem";
import { PONS_FACTORY_ABI, NATIVE_PAIR_TOKEN, DEFAULT_LAUNCH_CONFIG_ID, ponsFactoryAddress, emptySocials, freshSalt } from "./src/chain/pons.ts";

const client = createPublicClient({ transport: http("https://memmix.vercel.app/api/chain/rpc") });
const factory = ponsFactoryAddress();

const ERRORS = [
  "error LaunchFeeNotPaid()",
  "error InvalidLaunchConfigId()",
  "error InvalidTokenParams()",
  "error CreatorTaxTooHigh()",
  "error LaunchConfigDisabled()",
  "error NotWhitelisted()",
  "error LaunchEconomicsMismatch(bytes32 expected, bytes32 actual)",
  "error PairTokenNotApproved()",
].map((s) => parseAbiItem(s));

const economics = await client.readContract({
  address: factory, abi: PONS_FACTORY_ABI, functionName: "previewLaunchEconomics",
  args: [DEFAULT_LAUNCH_CONFIG_ID, NATIVE_PAIR_TOKEN],
});
const launchFee = await client.readContract({ address: factory, abi: PONS_FACTORY_ABI, functionName: "launchFee" });

const account = "0x1111111111111111111111111111111111111111";
const params = {
  name: "Testborn", symbol: "TSTB", logo: "ipfs://logo", description: "verification probe",
  socials: emptySocials(), creatorFeeRecipient: account, creatorTaxBps: 0,
  buybackEnabled: false, expectedEconomics: economics, salt: freshSalt(),
};

async function probe(label, value) {
  try {
    await client.simulateContract({
      address: factory, abi: PONS_FACTORY_ABI, functionName: "launchToken",
      args: [params, DEFAULT_LAUNCH_CONFIG_ID, NATIVE_PAIR_TOKEN], value, account,
    });
    console.log(`${label}: SIMULATION PASSED`);
  } catch (e) {
    let raw = e?.cause?.data ?? e?.data ?? e?.cause?.cause?.data;
    if (raw && typeof raw === "object" && raw.data) raw = raw.data;
    if (!raw) { const m = String(e?.message || "").match(/0x[0-9a-fA-F]{8,}/); if (m) raw = m[0]; }
    let named = null;
    if (typeof raw === "string" && raw.startsWith("0x") && raw.length >= 10) {
      for (const abiItem of ERRORS) {
        try { named = decodeErrorResult({ abi: [abiItem], data: raw }).errorName; break; } catch { /* next */ }
      }
    }
    const msg = String(e?.shortMessage || e?.message || e).split("\n")[0];
    console.log(`${label}: reverted -> ${named ?? msg.slice(0, 110)}`);
  }
}

console.log("factory     :", factory);
console.log("launchFee   :", launchFee, "wei");
console.log("economics   :", economics);
await probe("value=0        ", 0n);
await probe("value=launchFee", launchFee);
