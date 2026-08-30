import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (/\.(ts|tsx|css|html)$/.test(entry.name) && !entry.name.includes(".test.")) files.push(path);
  }
  return files;
}

describe("secret and private-key scan", () => {
  it("does not ship seed-phrase or private-key capture UI", () => {
    const files = walk(srcRoot);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, "utf8").toLowerCase();
      expect(text).not.toContain("paste your private key");
      expect(text).not.toContain("enter private key");
      expect(text).not.toContain("enter your seed");
      expect(text).not.toMatch(/localstorage[\s\S]{0,80}secretkey|secretkey[\s\S]{0,80}localstorage/);
      if (!file.replaceAll("\\", "/").includes("/pendingLaunch.ts")) {
        expect(text).not.toMatch(/<input[^>]+(mnemonic|private key|seed phrase)/i);
      }
    }
  });
});
