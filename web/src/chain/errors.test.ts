import { describe, expect, it } from "vitest";
import { isInsufficientBalance, isWalletRejection, isWrongNetwork, mapSendFailure } from "./errors";

/*
  These matchers decide what a user is told when a launch fails. The
  insufficient-balance check missed viem's actual wording, so a wallet that
  simply needed more ETH was reported as an unexplained simulation failure and
  the raw calldata was printed on screen. The exact strings are pinned here.
*/

const VIEM_INSUFFICIENT =
  "The total cost (gas * gas fee + value) of executing this transaction exceeds the balance of the account.";

describe("launch error classification", () => {
  it("recognises viem's insufficient balance wording", () => {
    expect(isInsufficientBalance(new Error(VIEM_INSUFFICIENT))).toBe(true);
    expect(mapSendFailure(new Error(VIEM_INSUFFICIENT)).code).toBe("INSUFFICIENT_BALANCE");
  });

  it("recognises the other wordings clients use", () => {
    for (const message of [
      "insufficient funds for gas * price + value",
      "insufficient balance for transfer",
      "sender doesn't have enough funds to send tx",
      "gas required exceeds allowance",
    ]) {
      expect(isInsufficientBalance(new Error(message))).toBe(true);
    }
  });

  it("does not mistake an unrelated revert for a funding problem", () => {
    expect(isInsufficientBalance(new Error("execution reverted: LaunchFeeNotPaid"))).toBe(false);
    expect(isInsufficientBalance(new Error("nonce too low"))).toBe(false);
  });

  it("reads a rejection from the EIP-1193 code, not only the text", () => {
    expect(isWalletRejection({ code: 4001 })).toBe(true);
    expect(isWalletRejection(new Error("User rejected the request"))).toBe(true);
    expect(isWalletRejection(new Error("something else"))).toBe(false);
  });

  it("reads an unknown network from code 4902", () => {
    expect(isWrongNetwork({ code: 4902 })).toBe(true);
  });

  it("never reports a failure as success", () => {
    for (const error of [new Error("boom"), { code: 4001 }, new Error(VIEM_INSUFFICIENT)]) {
      expect(mapSendFailure(error)).toBeInstanceOf(Error);
      expect(mapSendFailure(error).code).toBeTruthy();
    }
  });
});
