import { describe, expect, it } from "vitest";
import {
  canSignLaunch,
  getTransactionBoundary,
  NAME_CHECK_NOTICE,
  signAndLaunch,
  UNKNOWN_COST_LABEL,
} from "./pumpBoundary";

describe("transaction boundary", () => {
  it("keeps SIGN disabled by default native-launch flag and does not invent network cost", () => {
    const boundary = getTransactionBoundary();
    expect(boundary.signEnabled).toBe(false);
    expect(boundary.pumpSdkWired).toBe(true);
    expect(canSignLaunch()).toBe(false);
    expect(boundary.unknownCostLabel).toBe(UNKNOWN_COST_LABEL);
    expect(boundary.reason).toContain("Blockchain launch is not connected yet");
    expect(NAME_CHECK_NOTICE.toLowerCase()).not.toContain("trademark");
    expect(NAME_CHECK_NOTICE.toLowerCase()).not.toContain("safety");
    expect(() => signAndLaunch()).toThrow(/not connected/);
  });

  it("still disables SIGN when native inputs are missing even if a caller claims simulation passed", () => {
    expect(
      canSignLaunch({
        walletConnected: true,
        simulationOk: true,
        allowlistOk: true,
        metadataUri: "https://example.com/meta.json",
      }),
    ).toBe(false);
  });
});
