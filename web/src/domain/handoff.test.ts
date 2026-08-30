import { describe, expect, it } from "vitest";
import { missingAvatarAfterReload, persistableDraftToken, stripNonPublicDraft } from "./handoff";

describe("draft handoff", () => {
  it("stores only public text and https avatar URLs", () => {
    const stored = persistableDraftToken({
      source: "ai_mix",
      name: "Bonk With Hat",
      ticker: "BWHAT",
      description: "one character",
      avatar_url: "blob:http://localhost/abc",
      generated: true,
    });
    expect(stored.avatar_url).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain("blob:");
    expect(stored.initial_buy_sol).toBe("0");
  });

  it("flags a missing avatar after reload", () => {
    expect(missingAvatarAfterReload(undefined, false)).toBe(true);
    expect(missingAvatarAfterReload("https://cdn.example/out.png", false)).toBe(false);
    expect(missingAvatarAfterReload(undefined, true)).toBe(false);
  });

  it("strips blob fields when reading session JSON", () => {
    const parsed = stripNonPublicDraft({
      source: "ai_mix",
      name: "x",
      ticker: "XY",
      description: "desc",
      avatar_url: "blob:http://localhost/1",
      avatar_blob: "secret",
    });
    expect(parsed?.avatar_url).toBeUndefined();
    expect(parsed && "avatar_blob" in parsed).toBe(false);
  });
});
