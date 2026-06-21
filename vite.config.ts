import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";

/**
 * DEV-ONLY private audio server.
 *
 * Serves files from ./private_audio during `npm run dev` so the local build can
 * play your personal library. `apply: "serve"` means this NEVER runs in `vite
 * build`/`vite preview`, so the audio is never part of the deployed site — the
 * hosted build falls back to in-app import (client-side, nothing uploaded).
 */
function privateAudio(): Plugin {
  const dir = path.resolve(__dirname, "private_audio");
  const AUDIO_RE = /\.(mp3|m4a|ogg|wav|flac)$/i;
  return {
    name: "fretstorm-private-audio",
    apply: "serve",
    configureServer(server) {
      // manifest: list available files (the client matches them to the catalog)
      server.middlewares.use("/__private_audio_manifest", (_req, res) => {
        let files: string[] = [];
        try {
          files = fs.readdirSync(dir).filter((f) => AUDIO_RE.test(f));
        } catch {
          /* folder absent — that's fine, client shows import UI */
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ files }));
      });
      // file streaming
      server.middlewares.use("/__private_audio/", (req, res, next) => {
        const name = decodeURIComponent((req.url || "").split("?")[0].replace(/^\//, ""));
        const fp = path.join(dir, name);
        if (!fp.startsWith(dir) || !AUDIO_RE.test(fp) || !fs.existsSync(fp)) {
          return next();
        }
        res.setHeader("Content-Type", "audio/mpeg");
        fs.createReadStream(fp).pipe(res);
      });
    },
  };
}

// FRETSTORM is a 100% static front-end (Web Audio runs in the browser),
// so the default Vite static build is all we need. Vercel auto-detects this.
export default defineConfig({
  base: "./",
  plugins: [privateAudio()],
  build: {
    target: "es2020",
    outDir: "dist",
    sourcemap: false,
  },
});
