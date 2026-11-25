/** pdf.js's worker, imported in the Claude extension so it runs in the same process (src/mcp/reading.ts). */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}

/** pdf.js's worker for the app, changed a little (see pdfjsWorker in vite.config.ts): its address. */
declare module "virtual:pdfjs-worker-url" {
  const url: string;
  export default url;
}
