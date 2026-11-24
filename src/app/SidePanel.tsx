/** The panel down the left: the pages (small pictures) or the bookmarks, picked with the tabs at its top. */
import { useStore, type SidePane } from "../model/store";
import { Bookmarks } from "./Bookmarks";
import { Thumbnails } from "./Thumbnails";

const TABS: { pane: SidePane; label: string }[] = [
  { pane: "pages", label: "Pages" },
  { pane: "bookmarks", label: "Bookmarks" },
];

export function SidePanel() {
  const pane = useStore((s) => s.sidePane);
  return (
    <aside className={`side-panel ${pane}`}>
      <div className="side-tabs" role="tablist" aria-label="Side panel">
        {TABS.map((t) => (
          <button
            key={t.pane}
            type="button"
            role="tab"
            id={`side-tab-${t.pane}`}
            aria-selected={pane === t.pane}
            aria-controls="side-pane"
            className={`side-tab${pane === t.pane ? " active" : ""}`}
            onClick={() => useStore.getState().setSidePane(t.pane)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="side-pane" id="side-pane" role="tabpanel" aria-labelledby={`side-tab-${pane}`}>
        {pane === "pages" ? <Thumbnails /> : <Bookmarks />}
      </div>
    </aside>
  );
}
