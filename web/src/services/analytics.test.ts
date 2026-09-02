import { afterEach, describe, expect, it } from "vitest";
import {
  analyticsOptedOut,
  sanitizeAnalyticsProps,
  setAnalyticsOptOut,
  track,
} from "./analytics";
import { shareLaunchCopy } from "../domain/legalCopy";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe("anonymous analytics", () => {
  afterEach(() => {
    setAnalyticsOptOut(false);
  });

  it("drops wallet and signature fields and survives opt-out", () => {
    const storage = memoryStorage();
    Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
    Object.defineProperty(globalThis, "sessionStorage", { value: storage, configurable: true });
    const cleaned = sanitizeAnalyticsProps({
      path: "/app/mix",
      wallet: "So11111111111111111111111111111111111111112",
      signature: "5".repeat(88),
      generated: true,
    });
    expect(cleaned.path).toBe("/app/mix");
    expect(cleaned.generated).toBe(true);
    expect(cleaned.wallet).toBeUndefined();
    expect(cleaned.signature).toBeUndefined();
    setAnalyticsOptOut(true);
    expect(analyticsOptedOut()).toBe(true);
    expect(() => track("launch_confirmed", { wallet: "nope", generated: true })).not.toThrow();
    expect(storage.getItem("mixborn.analytics.buffer")).toBeNull();
    setAnalyticsOptOut(false);
    track("landing_primary_cta");
    expect(storage.getItem("mixborn.analytics.buffer")).toContain("landing_primary_cta");
  });
});

describe("launch share copy", () => {
  it("omits parents for direct launch", () => {
    expect(
      shareLaunchCopy({ name: "Direct", ticker: "DIR", tradeUrl: "https://dexscreener.com/robinhood/0xabc" }),
    ).toBe("Direct ($DIR) was born in FONS. https://dexscreener.com/robinhood/0xabc");
    expect(
      shareLaunchCopy({
        name: "Mix",
        ticker: "MIX",
        tradeUrl: "https://dexscreener.com/robinhood/0xabc",
        parentA: "HOOD",
        parentB: "ROBIN",
      }),
    ).toContain("born from HOOD + ROBIN");
  });
});
