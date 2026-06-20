import { defineConfig } from "vite";

// FRETSTORM is a 100% static front-end (Web Audio runs in the browser),
// so the default Vite static build is all we need. Vercel auto-detects this.
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
  },
});
