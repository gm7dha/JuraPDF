/**
 * Live with Claude in the app: the one LiveClient (src/live/client.ts), wired
 * to the store. Nothing connects until the user clicks Connect to Claude.
 */
import { useSyncExternalStore } from "react";

import { useStore } from "../model/store";
import { base64ToBytes, bytesToBase64 } from "../model/base64";
import { looksLikePdf } from "../model/pdfFile";
import { applyClaudeChange } from "./editing";
import { LiveClient, type LiveHost, type LiveState, type PermissionState, type SocketFactory, type SocketLike } from "../live/client";
import { RelayTransport, type RelayEnv, type RelayWindow } from "../live/relayTransport";
import { RELAY_WINDOW } from "../live/protocol";
import { APP_VERSION } from "../version";
import { browserKind } from "./install";

/** The browser's permission for reaching apps on this computer (Chrome's Local Network Access), if it says. */
async function loopbackPermission(): Promise<PermissionState> {
  const perms = typeof navigator !== "undefined" ? navigator.permissions : undefined;
  if (!perms?.query) return "unknown";
  for (const name of ["loopback-network", "local-network-access"]) {
    try {
      const r = await perms.query({ name } as unknown as PermissionDescriptor);
      return r.state === "granted" || r.state === "denied" || r.state === "prompt" ? r.state : "unknown";
    } catch {
      // This browser doesn't know that permission's name.
    }
  }
  return "unknown";
}

const host: LiveHost = {
  appVersion: APP_VERSION,
  browser: browserKind(),
  current() {
    const pdf = useStore.getState().pdf;
    // The bytes change (a new array) with every version, so they're the key.
    return { key: pdf?.bytes ?? null, name: pdf?.fileName ?? "", file: () => (pdf ? bytesToBase64(pdf.bytes) : "") };
  },
  busy() {
    const s = useStore.getState();
    if (!s.pdf) return "The user has no PDF open in JuraPDF.";
    if (s.dialog === "watermark") return "The user has the Watermark window open in JuraPDF.";
    if (s.dialog === "sign") return "The user has the Sign window open in JuraPDF.";
    if (s.dialog === "headers") return "The user has the Headers and page numbers window open in JuraPDF.";
    if (s.dialog === "stamp") return "The user has the Stamp window open in JuraPDF.";
    if (s.dialog === "compress") return "The user has the Make smaller window open in JuraPDF.";
    if (s.dialog === "print") return "The user has the Print window open in JuraPDF.";
    if (s.dialog === "password") return "JuraPDF is asking the user for a password.";
    if (s.draft || s.placing) return "The user is adding words or a picture to a page in JuraPDF.";
    return null;
  },
  async apply(name, file, label, replace) {
    const bytes = base64ToBytes(file);
    if (!bytes || !looksLikePdf(bytes)) return "what arrived wasn't a PDF";
    return applyClaudeChange(name, bytes, label, replace);
  },
  subscribe: (listener) => useStore.subscribe(listener),
  permission: loopbackPermission,
  // Look for new Claude chats only while JuraPDF is in view (and straight away when it comes back).
  watchVisibility(onChange) {
    if (typeof document === "undefined") return () => {};
    const shown = () => onChange(document.visibilityState === "visible");
    const focused = () => onChange(true);
    document.addEventListener("visibilitychange", shown);
    window.addEventListener("focus", focused);
    return () => {
      document.removeEventListener("visibilitychange", shown);
      window.removeEventListener("focus", focused);
    };
  },
};

/**
 * Safari won't let this https page open ws://127.0.0.1 (WebKit bug 171934),
 * so there the link goes through the extension's small link window
 * (src/live/relayTransport.ts). `?liveRelay` uses that way in any browser
 * (for the smoke test, and to try it out in Chrome).
 */
export const liveRelayMode = host.browser === "safari" || (typeof location !== "undefined" && new URLSearchParams(location.search).has("liveRelay"));

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const relayEnv: RelayEnv = {
  open: (url, name, features) => window.open(url, name, features) as unknown as RelayWindow | null,
  navigate(win, url) {
    (win as unknown as Window).location.href = url;
  },
  listen(fn) {
    const handler = (ev: MessageEvent) => fn({ source: ev.source, origin: ev.origin, data: ev.data });
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  },
  newSession: randomId,
  // Per tab, kept across reloads of it (sessionStorage is per tab), so a reloaded tab takes over its own old window.
  windowName() {
    const key = "jurapdf.liveWindow";
    try {
      const had = sessionStorage.getItem(key);
      if (had && /^jurapdf-claude-link-[0-9a-f]{32}$/.test(had)) return had;
      const name = `${RELAY_WINDOW}-${randomId()}`;
      sessionStorage.setItem(key, name);
      return name;
    } catch {
      return "";
    }
  },
};

export const liveRelay: RelayTransport | null = liveRelayMode && typeof window !== "undefined" ? new RelayTransport(relayEnv) : null;

const directSocket: SocketFactory = (url, protocol) => new WebSocket(url, protocol) as unknown as SocketLike;

if (liveRelay) {
  host.prepare = () => liveRelay.start();
  host.release = () => liveRelay.stop();
}

export const liveClient = new LiveClient(host, liveRelay ? liveRelay.makeSocket : directSocket);

if (liveRelay) {
  liveRelay.onLost = (why) =>
    liveClient.disconnect(
      why === "closed"
        ? "The small JuraPDF ↔ Claude window was closed, so JuraPDF disconnected from Claude. Click Connect to Claude to open it again (and keep it open while you work)."
        : "The small JuraPDF ↔ Claude window was reloaded or left its page, so the link to Claude stopped. Click Connect to Claude to link again (and leave that window as it is while you work).",
    );
}

/** The live link's state, for React. */
export function useLiveState(): LiveState {
  return useSyncExternalStore(
    (fn) => liveClient.onChange(fn),
    () => liveClient.state,
  );
}

// Close the link cleanly when the page goes away.
if (typeof window !== "undefined")
  window.addEventListener("pagehide", () => {
    if (liveClient.connected) liveClient.disconnect();
    // (Safari: the link window goes too, even if it was still looking for Claude.)
    liveRelay?.stop();
  });
