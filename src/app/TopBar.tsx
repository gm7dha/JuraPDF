import { useEffect, useState } from "react";

import { nameFromFileName } from "../model/pdfFile";
import { useStore } from "../model/store";
import { SHORT_VERSION } from "../version";
import { openFromFile, saveToFile } from "./fileActions";
import { Icons } from "./icons";
import { browserKind, installApp, installSteps, isInstalledApp, useCanInstall } from "./install";
import { Modal } from "./Modal";
import { detectPlatform, shortcut } from "./platform";
import { setThemeChoice, themeChoice, type ThemeChoice } from "./theme";

const CHANGELOG_URL = "https://github.com/gm7dha/JuraPDF/blob/main/CHANGELOG.md";

export function TopBar() {
  const pdf = useStore((s) => s.pdf);
  const savedAs = useStore((s) => s.savedAs);
  const openDialog = useStore((s) => s.openDialog);
  const platform = detectPlatform();
  const canInstall = useCanInstall();
  const [installHelp, setInstallHelp] = useState(false);
  const installed = isInstalledApp();

  return (
    <header className="topbar">
      <div className="brand" title="JuraPDF">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={24} height={24} />
        <span>JuraPDF</span>
      </div>
      {pdf && (
        <span className="doc-title" title={pdf.fileName}>
          {nameFromFileName(pdf.fileName)}
        </span>
      )}
      {savedAs && <span className="save-state">Saved · {savedAs}</span>}
      <a className="phase-badge" href={CHANGELOG_URL} target="_blank" rel="noreferrer" title="Your JuraPDF version: click to see what's new">
        {SHORT_VERSION}
        <span className="badge-extra"> preview</span>
      </a>
      <div className="topbar-spacer" />
      {!installed && (
        <button
          className="text-button"
          onClick={() => (canInstall ? void installApp() : setInstallHelp(true))}
          title="Install JuraPDF as an app on this computer. It then opens in its own window, works offline, and can open PDFs you double-click."
        >
          <Icons.Export size={18} style={{ transform: "rotate(180deg)" }} /> <span className="button-label">Install</span>
        </button>
      )}
      <button className="text-button" onClick={() => void openFromFile()} title={`Open a PDF (${shortcut(platform, "O")}). You can also drag one onto the window.`}>
        <Icons.Open size={18} /> <span className="button-label">Open</span>
      </button>
      <button className="text-button" onClick={() => openDialog("print")} disabled={!pdf} title={`Print, with an "Uncontrolled Document" or Work Order watermark if you like (${shortcut(platform, "P")})`}>
        <Icons.Print size={18} /> <span className="button-label">Print</span>
      </button>
      <button className="primary-button" onClick={() => void saveToFile()} disabled={!pdf} title={`Save the PDF to your computer (${shortcut(platform, "S")})`}>
        <Icons.Save size={18} /> <span className="button-label">Save</span>
      </button>
      <SettingsMenu />
      <button className="icon-button" onClick={() => openDialog("help")} aria-label="Help and shortcuts" title="Help and shortcuts (?)">
        <Icons.Help />
      </button>
      {installHelp && (
        <Modal title="Install JuraPDF as an app" onClose={() => setInstallHelp(false)} width={480}>
          <p>Installed, JuraPDF opens in its own window, has its own icon, works without an internet connection, and can open PDFs you double-click.</p>
          <ol className="install-steps">
            {installSteps(browserKind()).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Modal>
      )}
    </header>
  );
}

/** Settings: appearance (kept on this computer). */
function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<ThemeChoice>(themeChoice);
  // The menu is placed on the page itself (fixed), so the top bar's edge can't cut it off.
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.(".settings-menu, .settings-button")) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="settings-wrap">
      <button
        className={`icon-button settings-button${open ? " active" : ""}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
          setOpen(!open);
        }}
        aria-label="Settings"
        aria-expanded={open}
        title="Settings: light or dark"
      >
        <Icons.Settings />
      </button>
      {open && (
        <div className="settings-menu" role="dialog" aria-label="Settings" style={at ? { top: at.top, right: at.right } : undefined}>
          <div className="field-label">Appearance (this computer)</div>
          <div className="segmented three" role="radiogroup" aria-label="Appearance">
            {(
              [
                ["light", "Light"],
                ["dark", "Dark"],
                ["system", "Automatic"],
              ] as const
            ).map(([c, label]) => (
              <button
                type="button"
                key={c}
                role="radio"
                aria-checked={choice === c}
                className={choice === c ? "selected" : ""}
                title={c === "system" ? "Follow your computer's light or dark setting" : undefined}
                onClick={() => {
                  setThemeChoice(c);
                  setChoice(c);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="dialog-hint">The pages themselves always show as they'll print.</p>
        </div>
      )}
    </div>
  );
}
