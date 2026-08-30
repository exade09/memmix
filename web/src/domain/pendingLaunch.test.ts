import { describe, expect, it } from "vitest";
import { isPublicSignature, stripPendingSecrets } from "./pendingLaunch";

const URI = "https://gateway.pinata.cloud/ipfs/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const SIG = "5".repeat(88);

describe("pending launch record", () => {
  it("keeps public pin fields, public signature, and drops secrets", () => {
    const stored = stripPendingSecrets({
      mint: "So11111111111111111111111111111111111111112",
      creator: "So11111111111111111111111111111111111111112",
      metadata_uri: URI,
      image_hash: "abc",
      signature: SIG,
      state: "submitted",
      created_at: "2026-08-25T00:00:00.000Z",
    });
    expect(isPublicSignature(SIG)).toBe(true);
    expect(stored?.signature).toBe(SIG);
    expect(stored?.mint).toContain("So111");
    expect(stored?.metadata_uri).toContain("ipfs/");
    expect(
      stripPendingSecrets({
        metadata_uri: URI,
        image_hash: "abc",
        parent_a: "BONK",
        parent_b: "WIF",
        generated: true,
      }),
    ).toMatchObject({ parent_a: "BONK", parent_b: "WIF", generated: true });
    expect(stripPendingSecrets({ metadata_uri: "https://x", image_hash: "a", mint_secret: "secret" })).toBeNull();
    expect(
      stripPendingSecrets({
        metadata_uri: URI,
        image_hash: "a",
        signature: "not-a-signature",
      })?.signature,
    ).toBeNull();
  });
});
