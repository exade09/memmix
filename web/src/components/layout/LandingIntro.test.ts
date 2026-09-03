import { describe, expect, it } from "vitest";
import { isIntroStartKey } from "./LandingIntro";

function key(
  value: string,
  overrides: Partial<Parameters<typeof isIntroStartKey>[0]> = {},
) {
  return {
    key: value,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe("landing intro keyboard gate", () => {
  it("accepts ordinary keys that intentionally enter the site", () => {
    expect(isIntroStartKey(key("Enter"))).toBe(true);
    expect(isIntroStartKey(key(" "))).toBe(true);
    expect(isIntroStartKey(key("f"))).toBe(true);
  });

  it("does not treat focus navigation or modifiers as an enter action", () => {
    expect(isIntroStartKey(key("Tab"))).toBe(false);
    expect(isIntroStartKey(key("Shift"))).toBe(false);
    expect(isIntroStartKey(key("k", { ctrlKey: true }))).toBe(false);
    expect(isIntroStartKey(key("ArrowLeft", { altKey: true }))).toBe(false);
  });
});
