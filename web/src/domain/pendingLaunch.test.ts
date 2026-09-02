import { describe, expect, it } from "vitest";
import { isPublicTxHash, stripPendingSecrets } from "./pendingLaunch";

const URI = "https://gateway.pinata.cloud/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const HASH = `0x${"a".repeat(64)}`;
const TOKEN = "0x1111111111111111111111111111111111111111";

describe("pending launch record", () => {
  it("keeps public pin fields, a public tx hash, and drops secrets", () => {
    const stored = stripPendingSecrets({
      token: TOKEN,
      creator: TOKEN,
      metadata_uri: URI,
      image_hash: "abc",
      tx_hash: HASH,
      state: "submitted",
      created_at: "2026-09-02T00:00:00.000Z",
    });
    expect(isPublicTxHash(HASH)).toBe(true);
    expect(stored?.tx_hash).toBe(HASH);
    expect(stored?.token).toBe(TOKEN);
    expect(stored?.metadata_uri).toContain("ipfs/");
    expect(
      stripPendingSecrets({
        metadata_uri: URI,
        image_hash: "abc",
        parent_a: "HOOD",
        parent_b: "ROBIN",
        generated: true,
      }),
    ).toMatchObject({ parent_a: "HOOD", parent_b: "ROBIN", generated: true });
    expect(stripPendingSecrets({ metadata_uri: "https://x", image_hash: "a", private_key: "secret" })).toBeNull();
    expect(
      stripPendingSecrets({
        metadata_uri: URI,
        image_hash: "a",
        tx_hash: "not-a-hash",
      })?.tx_hash,
    ).toBeNull();
  });
});
