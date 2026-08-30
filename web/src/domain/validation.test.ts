import { describe, expect, it } from "vitest";
import {
  initialBuyError,
  isValidTicker,
  normalizeInitialBuy,
  normalizeTicker,
  telegramError,
  twitterError,
  websiteError,
} from "./validation";

describe("launch field validation", () => {
  it("accepts one-character and six-character tickers", () => {
    expect(isValidTicker("A")).toBe(true);
    expect(isValidTicker("bonk42")).toBe(true);
    expect(normalizeTicker("$bonk42")).toBe("BONK42");
    expect(normalizeTicker("TOOLONG")).toBe("TOOLON");
    expect(isValidTicker("")).toBe(false);
  });

  it("rejects invalid social URLs and accepts https profiles", () => {
    expect(twitterError("http://x.com/mixborn")).toBeTruthy();
    expect(twitterError("https://evil.example/x")).toBeTruthy();
    expect(twitterError("https://x.com/mixborn")).toBeNull();
    expect(telegramError("https://telegram.org/mixborn")).toBeTruthy();
    expect(telegramError("https://t.me/mixborn")).toBeNull();
    expect(websiteError("https://user:pass@example.com")).toBeTruthy();
    expect(websiteError("http://example.com")).toBeTruthy();
    expect(websiteError("https://mixborn.example")).toBeNull();
  });

  it("defaults initial buy to 0 and caps the amount", () => {
    expect(normalizeInitialBuy("")).toBe("0");
    expect(normalizeInitialBuy("0")).toBe("0");
    expect(initialBuyError("0", 5)).toBeNull();
    expect(initialBuyError("0.05", 5)).toBeNull();
    expect(initialBuyError("9", 5)).toBeTruthy();
  });
});
