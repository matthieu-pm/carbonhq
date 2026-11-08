import React, { useRef, useState } from "react";
import ReactDOM from "react-dom/client";

import SpaceTabs from "@/components/layout/SpaceTabs";
import SpacesView from "@/components/spaces/SpacesView";
import { useSpaceTabs } from "@/lib/spaceTabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type { PageSummary, Project } from "@/types/events";
import "../App.css";

/// The Spaces sidebar and Pages table with faked Pages and Linear documents:
/// the table, its checkbox gutter and selection bar, and the Linear view.

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const PROJECTS: Project[] = [
  { path: "/Users/demo/carbon", name: "carbon" } as Project,
  { path: "/Users/demo/site", name: "site" } as Project,
];
const page = (n: number, title: string, hours: number, extra: Partial<PageSummary> = {}): PageSummary => ({
  id: `page-${n}`, title, projectPaths: [], revision: 1, created: ago(hours + 10), modified: ago(hours),
  trashed: false, favorite: false, excerpt: "A short excerpt of what the Page says, for the grid view.", ...extra,
});
const PAGES: PageSummary[] = [
  page(1, "Spaces launch plan", 3, { projectPaths: ["/Users/demo/carbon"], favorite: true }),
  page(2, "Release checklist", 17, { projectPaths: ["/Users/demo/carbon"] }),
  page(3, "Homepage interview notes", 48),
  page(4, "Pricing page copy", 60, { projectPaths: ["/Users/demo/site"] }),
  page(5, "SQL day one guide", 24 * 30),
  page(6, "Your guide to Pages", 24 * 31, { favorite: true }),
  page(7, "Old draft", 24 * 90, { trashed: true }),
];
const LINEAR = [
  { id: "d1", title: "Q4 roadmap", url: "https://linear.app/x/document/d1", updatedAt: ago(5), trashed: false, project: { id: "p1", name: "Carbon" } },
  { id: "d2", title: "Onboarding research", url: "https://linear.app/x/document/d2", updatedAt: ago(80), trashed: false, project: null },
];

// `listen`'s unlisten reaches for this; without it every unmount throws.
(window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback: () => 1,
  invoke: async (outer: string, outerArgs: Record<string, unknown>) => {
    const wrapped = outer === "server_invoke";
    const cmd = wrapped ? (outerArgs.cmd as string) : outer;
    const args = (wrapped ? outerArgs.args : outerArgs) as Record<string, unknown>;
    if (cmd === "list_pages") {
      const query = String(args.query ?? "").toLowerCase();
      return PAGES.filter((p) => p.trashed === args.trashed && p.title.toLowerCase().includes(query));
    }
    if (cmd === "read_page") {
      const found = PAGES.find((p) => p.id === args.id);
      if (!found) throw new Error("demo: no such Page");
      return { ...found, markdown: `# ${found.title}\n\n${found.excerpt}` };
    }
    if (cmd === "list_page_assets" || cmd === "page_backlinks") return [];
    if (cmd === "page_sync_status") {
      const found = PAGES.find((p) => p.id === args.id);
      return { page: { ...found, markdown: "" }, link: null, status: "unlinked", error: null, conflict: null };
    }
    if (cmd === "list_linear_documents") return { documents: LINEAR, nextCursor: null };
    if (cmd === "list_servers") return [];
    if (cmd.startsWith("plugin:event|")) return 1;
    throw new Error(`demo: nothing stubbed for ${cmd}`);
  },
};

/// A stand-in rail: the toggle collapses the sidebar, and hovering the files
/// square peeks it, on the app's 200ms close delay.
function Demo() {
  const [collapsed, setCollapsed] = useState(false);
  const tabs = useSpaceTabs();
  const closer = useRef<(id: string) => void>(() => {});
  const [peek, setPeek] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const hover = (over: boolean) => {
    window.clearTimeout(timer.current);
    if (over) setPeek(true);
    else timer.current = window.setTimeout(() => setPeek(false), 200);
  };
  return (
    <TooltipProvider>
      {/* `app-shell` is what the floating card draws into, as in the app. */}
      <div className="app-shell relative flex h-screen flex-col bg-background" style={{ "--titlebar-h": "0px" } as React.CSSProperties}>
        <DemoThemeBar />
        <div className="flex h-10 shrink-0 items-center" style={{ "--tabs-lead": "0px" } as React.CSSProperties}>
          <SpaceTabs state={tabs} projects={PROJECTS} active onClose={(id) => closer.current(id)} alignX={52} />
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="flex w-[52px] shrink-0 flex-col items-center gap-2 pt-2">
            <button className="rounded-md border border-border px-1 text-xs" onClick={() => setCollapsed((v) => !v)}>{collapsed ? "Open" : "Close"}</button>
            <button aria-label="Spaces" className="size-9 rounded-md bg-muted" onPointerEnter={() => collapsed && hover(true)} onPointerLeave={() => collapsed && hover(false)} />
          </div>
          <SpacesView active projects={PROJECTS} visibleProjects={null} onClose={() => {}}
            sidebarCollapsed={collapsed} onExpandSidebar={() => setCollapsed(false)} peek={peek && collapsed} onPeekHover={hover}
            onNavigate={() => setPeek(false)} closeTabRef={closer} />
        </div>
      </div>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Demo />
  </React.StrictMode>,
);
