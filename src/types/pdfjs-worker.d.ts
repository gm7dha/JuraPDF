/** pdf.js's worker, imported in the Claude extension so it runs in the same process (src/mcp/reading.ts). */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
