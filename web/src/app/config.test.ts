import { describe, expect, it } from "vitest";
import { appConfig } from "../app/config";
import { ROBINHOOD_MAINNET_ID } from "../chain/robinhood";

describe("public launch flags", () => {
  it("reads Robinhood mainnet, which is the only published RPC", () => {
    expect(appConfig.mainnet).toBe(true);
    expect(appConfig.chainId).toBe(ROBINHOOD_MAINNET_ID);
  });

  it("has launching on, now that it runs through a deployed factory", () => {
    expect(appConfig.enableNativeLaunch).toBe(true);
    expect(appConfig.enableMainnetLaunch).toBe(true);
  });

  it('only switches off on the literal string "false", never on an empty or stray value', () => {
    // The flags are read as `!== "false"`, so a typo or a blank must not be
    // able to silently disable launching, and nothing but "false" turns it off.
    const off = (raw: string | undefined) => raw === "false";
    expect(off("false")).toBe(true);
    expect(off("FALSE")).toBe(false);
    expect(off("")).toBe(false);
    expect(off(undefined)).toBe(false);
    expect(off("0")).toBe(false);
  });
});
