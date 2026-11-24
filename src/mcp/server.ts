/**
 * JuraPDF for Claude: an MCP server (run by the Claude desktop app from the
 * JuraPDF extension) that lets Claude read and change PDFs: watermarks,
 * turning, moving, deleting and adding pages, joining and splitting PDFs.
 *
 * Started as: node server/index.mjs <folder for PDFs>
 * Talks MCP over stdin/stdout, so nothing else may be printed to stdout:
 * all logging goes to stderr.
 *
 * It also listens on 127.0.0.1 (this computer only) for "Live with Claude":
 * when the user clicks Connect to Claude in JuraPDF, the tools work on the
 * PDF open in that tab (src/mcp/live.ts, src/live/protocol.ts).
 */
// First: nothing but MCP may reach stdout.
import { log } from "./quietStdout";
import { homedir } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PdfFolder } from "./files";
import { LiveBridge } from "./live";
import { startLiveServer } from "./websocket";
import { LIVE_PORTS } from "../live/protocol";
import { Session } from "./session";
import { callTool, FORMAT_GUIDE, TOOLS } from "./tools";

/** Set when the extension is bundled (scripts/build-claude-extension.mjs). */
declare const __JURAPDF_VERSION__: string | undefined;
const VERSION = typeof __JURAPDF_VERSION__ === "string" ? __JURAPDF_VERSION__ : "0.0.0";


/** The folder chosen when the extension was installed (or Documents/JuraPDF). */
function folderPath(): string {
  const given = process.argv[2] || process.env.JURAPDF_FOLDER;
  // An unfilled setting arrives as the literal placeholder: fall back to the default.
  if (given && !given.includes("${")) return given;
  return join(homedir(), "Documents", "JuraPDF");
}

async function main() {
  const folder = new PdfFolder(folderPath());
  log(`JuraPDF ${VERSION}: PDF folder ${folder.root}`);
  let session: Session | null = null;

  // Live with Claude: wait (on this computer only) for a JuraPDF tab to connect.
  const live = new LiveBridge(VERSION, log);
  if (process.env.JURAPDF_LIVE !== "off") {
    const ports = process.env.JURAPDF_LIVE_PORT ? [Number(process.env.JURAPDF_LIVE_PORT)] : [...LIVE_PORTS];
    // JURAPDF_LIVE_DEV=1 also lets in JuraPDF served on this computer (its own tests and development only).
    const allowLocalOrigins = process.env.JURAPDF_LIVE_DEV === "1";
    startLiveServer({ ports, accept: (conn) => live.connect(conn), log, allowLocalOrigins })
      .then((started) => {
        if (started) {
          live.port = started.port;
          started.server.unref();
          log(`Live link ready on 127.0.0.1:${started.port}.`);
        } else {
          live.startProblem = `ports ${ports.join(", ")} on this computer are all in use (JuraPDF may already be running for many other Claude chats). Close some other Claude chats or windows, or restart Claude.`;
          log(`Live link: ${live.startProblem}`);
        }
      })
      .catch((e) => {
        live.startProblem = `the link couldn't start (${e instanceof Error ? e.message : String(e)}).`;
        log(`Live link: ${live.startProblem}`);
      });
  } else live.startProblem = "it's switched off for this copy of the extension.";

  const server = new Server(
    { name: "jurapdf", version: VERSION },
    {
      capabilities: { tools: {} },
      instructions: `JuraPDF works on the user's PDFs: it reads their words, adds watermarks (words or a picture) saved into the pages, turns, moves, deletes and adds pages, joins PDFs and saves some pages as a new PDF. The user sees the result in JuraPDF at https://gm7dha.github.io/JuraPDF/ (live, or by opening the saved file).
${FORMAT_GUIDE}`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false },
    })),
  }));

  // A call Claude cancels (notifications/cancelled) aborts `extra.signal`: the tool's change is taken back,
  // and the SDK sends no reply for it.
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (!session) {
      session = new Session(folder);
      session.live = live;
    }
    const result = await callTool(session, request.params.name, request.params.arguments ?? {}, extra.signal);
    return { content: result.content, ...(result.isError ? { isError: true } : {}) };
  });

  // When Claude stops the extension (closes our input), stop too, so the live link's port is freed.
  const stop = () => {
    live.close();
    setTimeout(() => process.exit(0), 50);
  };
  server.onclose = stop;
  process.stdin.on("end", stop);
  process.stdin.on("close", stop);
  await server.connect(new StdioServerTransport());
  log("ready");
}

main().catch((e) => {
  log("Failed to start:", e instanceof Error ? e.stack ?? e.message : e);
  process.exit(1);
});
