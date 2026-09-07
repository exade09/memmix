import { describe, expect, it } from "vitest";
import { keccak256, toBytes, toFunctionSelector } from "viem";
import { isNativeAsset, NATIVE_ASSET, REWARDS_DISTRIBUTOR_ABI } from "./rewards";

/*
  These calls move money, so each selector is checked against the signature
  written in RewardsDistributor.sol rather than trusted because it reads
  correctly. An argument in the wrong position still encodes and still sends.
*/

const SIGNATURES: Record<string, string> = {
  claim: "claim(uint256,uint256,address,uint256,bytes32[])",
  isClaimed: "isClaimed(uint256,uint256)",
  roundCount: "roundCount()",
  createRound: "createRound(address,bytes32,uint256,uint256,uint64)",
  owner: "owner()",
};

describe("RewardsDistributor ABI", () => {
  for (const [name, signature] of Object.entries(SIGNATURES)) {
    it(`encodes ${name} with the selector the contract exposes`, () => {
      const entry = REWARDS_DISTRIBUTOR_ABI.find((e) => e.type === "function" && e.name === name);
      expect(entry, `${name} is missing from the ABI`).toBeDefined();
      expect(toFunctionSelector(entry!)).toBe(keccak256(toBytes(signature)).slice(0, 10));
    });
  }

  it("declares createRound as payable", () => {
    const entry = REWARDS_DISTRIBUTOR_ABI.find((e) => e.type === "function" && e.name === "createRound");
    // An ETH round is funded by the value on this call. Declared nonpayable,
    // viem would refuse to attach it and every native round would revert.
    expect(entry!.stateMutability).toBe("payable");
  });
});

describe("native asset", () => {
  it("treats the zero address and an empty string as ETH", () => {
    expect(isNativeAsset(NATIVE_ASSET)).toBe(true);
    expect(isNativeAsset("")).toBe(true);
  });

  it("does not mistake a real token for ETH, in either casing", () => {
    const aapl = "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9";
    // Addresses reach this both checksummed (from the registry) and lowercased
    // (from the chain), and a token treated as ETH would send value instead of
    // pulling the tokens.
    expect(isNativeAsset(aapl)).toBe(false);
    expect(isNativeAsset(aapl.toLowerCase())).toBe(false);
  });
});
