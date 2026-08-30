import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(srcRoot, "..", "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};

function walk(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (/\.(ts|tsx|css)$/.test(entry.name) && !entry.name.includes(".test.")) files.push(path);
  }
  return files;
}

describe("source hygiene", () => {
  it("keeps required packages and a single animation runtime", () => {
    expect(pkg.dependencies.zod).toBeTruthy();
    expect(pkg.dependencies.motion).toBeTruthy();
    expect(pkg.dependencies["@pump-fun/pump-sdk"]).toBe("1.36.0");
    expect(pkg.dependencies.tailwindcss).toBeUndefined();
    expect(pkg.dependencies.gsap).toBeUndefined();
    expect(pkg.dependencies.three).toBeUndefined();
    expect(pkg.dependencies["@splinetool/runtime"]).toBeUndefined();
    expect(pkg.dependencies.p256k).toBeUndefined();
  });

  it("does not introduce XSS sinks or extra animation runtimes in src", () => {
    const files = walk(srcRoot);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("dangerouslySetInnerHTML");
      expect(text).not.toMatch(/\beval\s*\(/);
      expect(text).not.toMatch(/\bnew Function\s*\(/);
      expect(text).not.toMatch(/from\s+["']gsap["']/);
      expect(text).not.toMatch(/from\s+["']three["']/);
      expect(text).not.toMatch(/from\s+["']@splinetool\//);
      expect(text).not.toMatch(/from\s+["']p256k["']/);
      expect(text).not.toMatch(/@tailwind\s/);
    }
  });
});
