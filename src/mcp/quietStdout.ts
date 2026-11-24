/**
 * stdout carries the conversation with Claude, so anything else printed there
 * would break it. Imported first by server.ts, before anything else is loaded
 * (pdf.js prints warnings as it loads): every console message goes to stderr.
 */
export const log = (...args: unknown[]) => process.stderr.write(`[jurapdf] ${args.map(String).join(" ")}\n`);
console.log = log;
console.info = log;
console.warn = log;
console.debug = log;
