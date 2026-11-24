import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The version shown in the app comes from package.json (see CHANGELOG.md).
const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// JuraPDF is served from https://gm7dha.github.io/<repo name>/ (now /JuraPDF/),
// so every asset URL is prefixed with "/<repo name>/". CI passes BASE_PATH from
// the repository's name, so the site keeps working if the repo is renamed.
const repo = process.env.GITHUB_REPOSITORY?.split("/")[1];
const wanted = process.env.BASE_PATH || (repo ? `/${repo}/` : "/JuraPDF/");
// Always "/name/", even if BASE_PATH was typed without its slashes.
const base = `/${wanted.replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");

/**
 * pdf.js needs a few files of its own beside the app: character maps (for
 * Chinese, Japanese and Korean text) and the 14 standard PDF fonts. They're
 * served from node_modules while developing and copied into the build under
 * pdfjs/, so they also work offline once JuraPDF is installed.
 */
function pdfjsFiles(): Plugin {
  const root = fileURLToPath(new URL("./node_modules/pdfjs-dist/", import.meta.url));
  const folders = ["cmaps", "standard_fonts"];
  return {
    name: "jurapdf-pdfjs-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/pdfjs\/(cmaps|standard_fonts)\/([\w.-]+)(?:\?.*)?$/);
        if (!m) return next();
        try {
          res.end(readFileSync(join(root, m[1], m[2])));
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const folder of folders) {
        for (const file of readdirSync(join(root, folder))) {
          if (file.endsWith(".md")) continue;
          this.emitFile({ type: "asset", fileName: `pdfjs/${folder}/${file}`, source: readFileSync(join(root, folder, file)) });
        }
      }
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), pdfjsFiles()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    target: "es2022",
    // pdf.js is large by nature; don't warn about it.
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Generous: a shared CI machine can be slow.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
