import { formatEther, parseEther } from "viem";

/** Gas on Robinhood Chain is paid in ETH, so every amount here is wei. */
export function ethToWei(value: string): bigint {
  const trimmed = (value || "").trim();
  if (!trimmed) return 0n;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error("Enter an amount in ETH.");
  return parseEther(trimmed as `${number}`);
}

export function weiToEthLabel(wei: bigint): string {
  const eth = formatEther(wei);
  const [whole, frac = ""] = eth.split(".");
  const short = frac.replace(/0+$/, "").slice(0, 6);
  return short ? `${whole}.${short} ETH` : `${whole} ETH`;
}

/** A conservative pad so a quoted maximum is never lower than the real debit. */
export function applyPercentBuffer(wei: bigint, percent: number): bigint {
  if (percent <= 0) return wei;
  return wei + (wei * BigInt(Math.round(percent))) / 100n;
}
