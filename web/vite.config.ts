import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const rootDir = import.meta.dirname;

function copyBundledTokenAssets() {
  return {
    name: "copy-bundled-token-assets",
    closeBundle() {
      const from = resolve(rootDir, "assets/tokens");
      const to = resolve(rootDir, "dist/assets/tokens");
      if (existsSync(from)) {
        cpSync(from, to, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyBundledTokenAssets()],
  resolve: {
    alias: {
      "@": resolve(rootDir, "src"),
    },
  },
  define: {
    global: "globalThis",
  },
  optimizeDeps: {
    include: ["buffer", "bn.js", "@solana/web3.js", "@pump-fun/pump-sdk"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // motion is safe to split: nothing in it runs before the entry body.
          if (id.includes("node_modules/motion")) return "motion";
          // @solana and @pump-fun must NOT be split. Rollup hoists cross-chunk
          // imports to the top of the entry file, so a separate solana chunk
          // evaluates before `import "./polyfills"` in main.tsx and blows up
          // with `Buffer is not defined`. CSP forbids an inline bootstrap
          // script, so keeping them in the entry chunk is what guarantees the
          // polyfill runs first.
        },
      },
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/polyfills.ts"],
  },
});
