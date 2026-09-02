import { getAddress, isAddress } from "viem";

/**
 * Token identity on an EVM chain is a contract address, not a base58 mint.
 * Everything user-facing goes through here so a malformed address can never
 * reach a transaction.
 */
export function isTokenAddress(value: string): boolean {
  return isAddress((value || "").trim());
}

/** Checksummed form, or null when the input is not an address at all. */
export function normalizeAddress(value: string): string | null {
  const trimmed = (value || "").trim();
  if (!isAddress(trimmed)) return null;
  return getAddress(trimmed);
}

export function shortenAddress(value: string): string {
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function sameAddress(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
