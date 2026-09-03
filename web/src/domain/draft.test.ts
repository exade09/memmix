import { beforeEach, describe, expect, it } from "vitest";
import {
  readDraftMix,
  setDraftParent,
  writeDraftMix,
  type ParentToken,
} from "./draft";

const parentA: ParentToken = {
  mint: "0x1111111111111111111111111111111111111111",
  name: "Alpha",
  symbol: "ALPHA",
};

const parentB: ParentToken = {
  mint: "0x2222222222222222222222222222222222222222",
  name: "Beta",
  symbol: "BETA",
};

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe("mix draft avatar direction", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: memoryStorage(),
    });
  });

  it("persists the base for the next generation", () => {
    writeDraftMix({
      parent_a: parentA,
      parent_b: parentB,
      avatar_result_url: "https://cdn.example/avatar.png",
      avatar_next_base: "b",
    });

    expect(readDraftMix().avatar_next_base).toBe("b");
  });

  it("resets generated state when either project changes", () => {
    writeDraftMix({
      parent_a: parentA,
      parent_b: parentB,
      concepts: [{ id: "c1", name: "Old", ticker: "OLD", description: "Old concept" }],
      selected_concept_id: "c1",
      avatar_job_token: "old-job",
      avatar_result_url: "https://cdn.example/old.png",
      avatar_next_base: "b",
    });

    setDraftParent("b", { ...parentB, mint: "0x3333333333333333333333333333333333333333" });
    const next = readDraftMix();

    expect(next.parent_a?.mint).toBe(parentA.mint);
    expect(next.concepts).toEqual([]);
    expect(next.avatar_job_token).toBeNull();
    expect(next.avatar_result_url).toBeNull();
    expect(next.avatar_next_base).toBe("a");
  });

  it("keeps the alternating direction when the same project is selected again", () => {
    writeDraftMix({
      parent_a: parentA,
      parent_b: parentB,
      avatar_result_url: "https://cdn.example/avatar.png",
      avatar_next_base: "b",
    });

    setDraftParent("b", { ...parentB, name: "Beta refreshed" });
    expect(readDraftMix().avatar_next_base).toBe("b");
  });
});
