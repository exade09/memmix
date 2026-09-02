import { describe, expect, it } from "vitest";
import {
  canSignLaunch,
  getTransactionBoundary,
  NAME_CHECK_NOTICE,
  signAndLaunch,
  UNKNOWN_COST_LABEL,
} from "./launchBoundary";

describe("transaction boundary", () => {
  it("keeps SIGN disabled while no launchpad is configured and invents no network cost", () => {
    const boundary = getTransactionBoundary();
    expect(boundary.signEnabled).toBe(false);
    expect(boundary.launchpadConfigured).toBe(false);
    expect(canSignLaunch()).toBe(false);
    expect(boundary.unknownCostLabel).toBe(UNKNOWN_COST_LABEL);
    expect(boundary.reason).toContain("not connected yet");
    // the mainnet gate is still there, behind the missing contract
    expect(boundary.launchpadConfigured).toBe(false);
    expect(NAME_CHECK_NOTICE.toLowerCase()).not.toContain("trademark");
    expect(NAME_CHECK_NOTICE.toLowerCase()).not.toContain("safety");
    expect(() => signAndLaunch()).toThrow(/not connected/);
  });

  it("still disables SIGN when a caller claims simulation passed but the chain inputs are missing", () => {
    expect(
      canSignLaunch({
        walletConnected: true,
        simulationOk: true,
        contractOk: true,
        metadataUri: "https://example.com/meta.json",
      }),
    ).toBe(false);
  });
});
