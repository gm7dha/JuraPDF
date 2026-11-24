import { useEffect, useState } from "react";

import { useStore } from "../model/store";
import { zoomIn, zoomOut } from "../model/zoom";
import { openFile, openFromFile, saveToFile } from "./fileActions";
import { HelpDialog } from "./HelpDialog";
import { Icons } from "./icons";
import { PageView } from "./PageView";
import { PasswordDialog } from "./PasswordDialog";
import { PrintDialog } from "./PrintDialog";
import { inPopup, inTextBox } from "./popupGuard";
import { Thumbnails } from "./Thumbnails";
import { TopBar } from "./TopBar";
import { ViewBar } from "./ViewBar";

export function App() {
  const pdf = useStore((s) => s.pdf);
  const sidebar = useStore((s) => s.sidebar);
  const dialog = useStore((s) => s.dialog);
  const dropping = useDropToOpen();
  useShortcuts();

  return (
    <div className="app">
      <TopBar />
      <ViewBar />
      {pdf ? (
        <main className={`workspace${sidebar ? "" : " no-sidebar"}`}>
          {sidebar && <Thumbnails />}
          <PageView />
        </main>
      ) : (
        <Welcome />
      )}
      {dropping && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <Icons.Page size={40} />
            <span>Drop the PDF to open it</span>
          </div>
        </div>
      )}
      {dialog === "help" && <HelpDialog />}
      {dialog === "password" && <PasswordDialog />}
      {dialog === "print" && <PrintDialog />}
      <Toasts />
    </div>
  );
}

/** What shows before a PDF is open. */
function Welcome() {
  const opening = useStore((s) => s.opening);
  return (
    <main className="welcome">
      <div className="welcome-card">
        <Icons.Page size={48} />
        <h1>Open a PDF to get started</h1>
        <p className="muted">Drag a PDF onto this window, or choose one from your computer. It stays on your computer: nothing is uploaded.</p>
        <button className="primary-button big" onClick={() => void openFromFile()} disabled={!!opening}>
          <Icons.Open size={18} /> {opening ? `Opening ${opening}…` : "Open a PDF"}
        </button>
      </div>
    </main>
  );
}

/** Dragging a file over the window shows a "drop to open" sign; dropping a PDF opens it. */
function useDropToOpen(): boolean {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const file = e.dataTransfer?.files[0];
      if (file) void openFile(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, []);
  return over;
}

/** Keyboard shortcuts (see the Help dialog). */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      // Open, Save and Print work everywhere except inside a dialog box.
      if (mod && !e.altKey && (key === "o" || key === "s" || key === "p")) {
        if (document.querySelector('[aria-modal="true"]')) return;
        e.preventDefault();
        if (key === "o") void openFromFile();
        else if (key === "s") void saveToFile();
        else if (s.pdf) s.openDialog("print");
        return;
      }
      if (inPopup(e.target, document) || inTextBox(e.target)) return;
      if (mod && !e.altKey) {
        if (key === "=" || key === "+") {
          e.preventDefault();
          s.setZoom(zoomIn(s.shownZoom));
        } else if (key === "-" || key === "_") {
          e.preventDefault();
          s.setZoom(zoomOut(s.shownZoom));
        } else if (key === "0") {
          e.preventDefault();
          s.setZoom("width");
        } else if (key === "1") {
          e.preventDefault();
          s.setZoom(1);
        }
        return;
      }
      if (e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        s.openDialog("help");
        return;
      }
      if (!s.pdf) return;
      const last = s.pdf.sizes.length - 1;
      if (e.key === "ArrowLeft") s.goToPage(s.currentPage - 1);
      else if (e.key === "ArrowRight") s.goToPage(s.currentPage + 1);
      else if (e.key === "Home") s.goToPage(0);
      else if (e.key === "End") s.goToPage(last);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === "error" ? <Icons.Warning size={18} /> : t.kind === "success" ? <Icons.Tick size={18} /> : null}
          <span>{t.text}</span>
          <button className="icon-button small" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            <Icons.Cross size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
