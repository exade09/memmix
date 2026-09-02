/*
  Proves a launch would go through, against the live chain and the live proxy.

  eth_call and reads only: nothing is signed and nothing is sent.

  This script used to stop after simulateContract, which is why a missing
  eth_getBlockByNumber in the RPC allowlist reached production: the app also
  estimates fees and gas, and neither was exercised here. It now walks the same
  calls simulateLaunch makes, in the same order, so a gap in the allowlist
  fails here instead of in front of a user.
*/
import { createPublicClient, http, decodeErrorResult, parseAbiItem, formatEther, formatGwei } from "viem";
import {
  PONS_FACTORY_ABI,
  NATIVE_PAIR_TOKEN,
  DEFAULT_LAUNCH_CONFIG_ID,
  ponsFactoryAddress,
  emptySocials,
  freshSalt,
} from "../src/chain/pons.ts";

const RPC = process.env.FONS_RPC ?? "https://memmix.vercel.app/api/chain/rpc";
const client = createPublicClient({ transport: http(RPC) });
const factory = ponsFactoryAddress();
const account = "0x1111111111111111111111111111111111111111";

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

let failures = 0;
async function step(label, fn) {
  try {
    const value = await fn();
    console.log(`  ok    ${label}${value === undefined ? "" : `: ${value}`}`);
    return value;
  } catch (error) {
    failures += 1;
    const message = String(error?.shortMessage || error?.message || error).split("\n")[0];
    console.log(`  FAIL  ${label}: ${message.slice(0, 150)}`);
    return undefined;
  }
}

console.log(`rpc     : ${RPC}`);
console.log(`factory : ${factory}\n`);

console.log("reads the launch depends on");
await step("eth_chainId", async () => await client.getChainId());
await step("eth_getCode", async () => `${((await client.getCode({ address: factory })) ?? "").length} chars`);
const launchFee = await step("launchFee()", async () => {
  const fee = await client.readContract({ address: factory, abi: PONS_FACTORY_ABI, functionName: "launchFee" });
  return `${formatEther(fee)} ETH`;
}).then(() => client.readContract({ address: factory, abi: PONS_FACTORY_ABI, functionName: "launchFee" }));
await step("launchEnabled()", async () =>
  await client.readContract({ address: factory, abi: PONS_FACTORY_ABI, functionName: "launchEnabled" }));
await step("canLaunch()", async () =>
  await client.readContract({ address: factory, abi: PONS_FACTORY_ABI, functionName: "canLaunch", args: [account] }));
const economics = await client.readContract({
  address: factory, abi: PONS_FACTORY_ABI, functionName: "previewLaunchEconomics",
  args: [DEFAULT_LAUNCH_CONFIG_ID, NATIVE_PAIR_TOKEN],
});
await step("previewLaunchEconomics()", async () => `${economics.slice(0, 18)}…`);

// The step that was never covered here, and the one that broke in production.
console.log("\nfee estimation");
await step("eth_getBalance", async () => `${formatEther(await client.getBalance({ address: account }))} ETH`);
await step("estimateFeesPerGas (reads eth_getBlockByNumber)", async () => {
  const fees = await client.estimateFeesPerGas();
  const per = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
  return `${formatGwei(per)} gwei`;
});

console.log("\nlaunch call");
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
    console.log(`  ${label}: SIMULATION PASSED`);
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
    console.log(`  ${label}: reverted -> ${named ?? msg.slice(0, 110)}`);
  }
}

await probe("value=0        ", 0n);
await probe("value=launchFee", launchFee);

console.log(
  failures === 0
    ? "\nEvery read the launch needs is reachable through the proxy."
    : `\n${failures} step(s) failed. A launch would break at the first one.`,
);
process.exit(failures === 0 ? 0 : 1);
