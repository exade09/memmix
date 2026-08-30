import { describe, expect, it } from "vitest";
import { appConfig } from "../app/config";

describe("public launch flags", () => {
  it("defaults to devnet with native and mainnet launch disabled", () => {
    expect(appConfig.cluster).toBe("devnet");
    expect(appConfig.enableNativeLaunch).toBe(false);
    expect(appConfig.enableMainnetLaunch).toBe(false);
    expect(appConfig.enableBagsFallback).toBe(false);
  });
});
