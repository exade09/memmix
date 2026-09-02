import { describe, expect, it } from "vitest";
import {
  canSignLaunch,
  getTransactionBoundary,
  NAME_CHECK_NOTICE,
  UNKNOWN_COST_LABEL,
} from "./launchBoundary";

/*
  These used to assert that SIGN was off because no launchpad existed. It does
  now, so what is worth protecting has changed: SIGN must still be impossible
  until a wallet is connected on the right chain, the factory has been seen to
  hold code, and the simulation actually passed.
*/

const READY = {
  walletConnected: true,
  simulationOk: true,
  contractOk: true,
  metadataUri: "https://example.com/meta.json",
};

describe("transaction boundary", () => {
  it("invents no network cost and makes no safety claim about the name check", () => {
    expect(getTransactionBoundary().unknownCostLabel).toBe(UNKNOWN_COST_LABEL);
    expect(NAME_CHECK_NOTICE.toLowerCase()).not.toContain("trademark");
    expect(NAME_CHECK_NOTICE.toLowerCase()).not.toContain("safety");
  });

  it("keeps SIGN disabled until a wallet is connected", () => {
    const boundary = getTransactionBoundary({ ...READY, walletConnected: false });
    expect(boundary.signEnabled).toBe(false);
    expect(boundary.reason).toContain("MetaMask");
  });

  it("keeps SIGN disabled on the wrong network", () => {
    const boundary = getTransactionBoundary({ ...READY, wrongNetwork: true });
    expect(boundary.signEnabled).toBe(false);
    expect(boundary.reason).toContain("Robinhood Chain");
  });

  it("keeps SIGN disabled while the wallet connection is still pending or refused", () => {
    expect(canSignLaunch({ ...READY, walletConnecting: true })).toBe(false);
    expect(canSignLaunch({ ...READY, walletRejected: true })).toBe(false);
  });

  it("keeps SIGN disabled when the factory address holds no code", () => {
    const boundary = getTransactionBoundary({ ...READY, contractOk: false });
    expect(boundary.signEnabled).toBe(false);
    expect(boundary.reason).toContain("No contract found");
  });

  it("keeps SIGN disabled when the simulation failed, whatever else a caller claims", () => {
    const boundary = getTransactionBoundary({ ...READY, simulationOk: false });
    expect(boundary.signEnabled).toBe(false);
    expect(boundary.reason).toContain("Simulation failed");
  });

  it("keeps SIGN disabled while the simulation result is still unknown", () => {
    expect(canSignLaunch({ ...READY, simulationOk: undefined })).toBe(false);
    expect(canSignLaunch({ ...READY, contractOk: undefined })).toBe(false);
  });

  it("enables SIGN only once wallet, contract and simulation all agree", () => {
    const boundary = getTransactionBoundary(READY);
    expect(boundary.launchpadConfigured).toBe(true);
    expect(boundary.signEnabled).toBe(true);
    expect(canSignLaunch(READY)).toBe(true);
  });
});
