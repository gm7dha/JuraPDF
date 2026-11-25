import { defineConfig } from "vitest/config";
import { transformWithEsbuild, type Plugin } from "vite";
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

/**
 * pdf.js's background worker, with one small change so pictures (scanned
 * pages) show much sooner. Chrome and Edge can unpack JPG pictures themselves,
 * about ten times quicker than pdf.js does, but pdf.js leaves that off because
 * a JPG that carries a "which way up" note (EXIF) came out turned. The change
 * sends just those JPGs the slow way, so the quick way can be switched on for
 * the rest (`isImageDecoderSupported` in src/pdf/pdfjs.ts). Imported as
 * "virtual:pdfjs-worker-url"; the build fails if pdf.js changes under it.
 */
function pdfjsWorker(): Plugin {
  const id = "virtual:pdfjs-worker-url";
  const file = fileURLToPath(new URL("./node_modules/pdfjs-dist/build/pdf.worker.mjs", import.meta.url));
  const anchor = `        case 0xffc2:
          numComponents = data[offset + (2 + 1 + 2 + 2)];
          break markerLoop;
`;
  const exifCheck = `        case 0xffe1:
          if (data[offset + 2] === 0x45 && data[offset + 3] === 0x78 && data[offset + 4] === 0x69 && data[offset + 5] === 0x66) {
            return false;
          }
          break;
`;
  const patched = () => {
    const src = readFileSync(file, "utf8");
    const at = src.indexOf(anchor);
    if (at < 0 || src.indexOf(anchor, at + 1) >= 0 || !src.includes("static canUseImageDecoder(data, colorTransform = -1)")) {
      throw new Error("pdf.js's worker has changed: update the JPG change in vite.config.ts (pdfjsWorker)");
    }
    return src.slice(0, at + anchor.length) + exifCheck + src.slice(at + anchor.length);
  };
  let serving = false;
  return {
    name: "jurapdf-pdfjs-worker",
    configResolved(config) {
      serving = config.command === "serve";
    },
    resolveId: (source) => (source === id ? `\0${id}` : null),
    async load(loaded) {
      if (loaded !== `\0${id}`) return null;
      if (serving) return `export default ${JSON.stringify(`${base}pdfjs/pdf.worker.mjs`)};`;
      const { code } = await transformWithEsbuild(patched(), "pdf.worker.mjs", { minify: true, legalComments: "none" });
      const ref = this.emitFile({ type: "asset", name: "pdf.worker.min.mjs", source: code });
      return `export default import.meta.ROLLUP_FILE_URL_${ref};`;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.match(/\/pdfjs\/pdf\.worker\.mjs(?:\?.*)?$/)) return next();
        res.setHeader("Content-Type", "text/javascript");
        res.end(patched());
      });
    },
  };
}

/**
 * Tesseract (reading words in pictures) needs its worker, its engine and the
 * English letters it's learned, beside the app under ocr/. Fetched only when
 * words are first read (then kept), so they cost nothing until used.
 */
function ocrFiles(): Plugin {
  const at = (path: string) => fileURLToPath(new URL(`./node_modules/${path}`, import.meta.url));
  const files: Record<string, string> = {
    "worker.min.js": at("tesseract.js/dist/worker.min.js"),
    "tesseract-core-simd-lstm.wasm.js": at("tesseract.js-core/tesseract-core-simd-lstm.wasm.js"),
    "tesseract-core-lstm.wasm.js": at("tesseract.js-core/tesseract-core-lstm.wasm.js"),
    "eng.traineddata.gz": at("@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),
  };
  return {
    name: "jurapdf-ocr-files",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url?.match(/\/ocr\/([\w.-]+)(?:\?.*)?$/);
        const file = m && files[m[1]];
        if (!file) return next();
        res.setHeader("Content-Type", m[1].endsWith(".gz") ? "application/gzip" : "text/javascript");
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, file] of Object.entries(files)) this.emitFile({ type: "asset", fileName: `ocr/${name}`, source: readFileSync(file) });
    },
  };
}

export default defineConfig({
  base,
  plugins: [react(), pdfjsFiles(), pdfjsWorker(), ocrFiles()],
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
