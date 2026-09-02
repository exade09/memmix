import { describe, expect, it } from "vitest";
import { appConfig } from "../app/config";
import { ROBINHOOD_MAINNET_ID } from "../chain/robinhood";

describe("public launch flags", () => {
  it("defaults to Robinhood mainnet for reads, with every launch switch off", () => {
    expect(appConfig.mainnet).toBe(true);
    expect(appConfig.chainId).toBe(ROBINHOOD_MAINNET_ID);
    expect(appConfig.enableNativeLaunch).toBe(false);
    expect(appConfig.enableMainnetLaunch).toBe(false);
  });
});
