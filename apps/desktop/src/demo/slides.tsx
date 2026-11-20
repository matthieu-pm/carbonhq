import React, { useRef } from "react";
import ReactDOM from "react-dom/client";

import SpaceTabs from "@/components/layout/SpaceTabs";
import SpacesView from "@/components/spaces/SpacesView";
import { useSpaceTabs } from "@/lib/spaceTabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type { Page, PageSummary, Project } from "@/types/events";
import "../App.css";

/// Spaces' Slides section with three decks in different authored themes, and
/// the deck editor around them. Saves land in memory; "Agent edit" bumps a
/// deck's revision behind the editor, which is how a conflict is reached.

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const PROJECTS: Project[] = [{ path: "/Users/demo/carbon", name: "carbon" } as Project];

const DECKS: Record<string, object> = {
  "deck-1": {
    name: "Spaces launch review", language: "en",
    design: { theme: "bold", colorScheme: "deep-purple" },
    slides: [
      { id: "cover", layout: "cover", title: "Spaces launch review", subtitle: "Beta 5 · November 2026" },
      { id: "agenda", layout: "agenda", title: "Agenda", items: ["Where we are", "What shipped", "What is next"] },
      { id: "metrics", layout: "metrics", title: "First two weeks", blocks: [["1,240", "Pages created"], ["318", "Decks"], ["92%", "Weekly return"]].map(([value, label]) => ({ type: "metric", metric: { value, label } })) },
      { id: "next", layout: "list", title: "Next", items: ["Image library", "Google Drive", "Shared Spaces"] },
      { id: "end", layout: "closing", title: "Thank you" },
    ],
  },
  "deck-2": {
    name: "Pricing proposal", language: "en",
    design: { theme: "minimal", colorScheme: "forest-green" },
    slides: [
      { id: "cover", layout: "cover", title: "Pricing proposal", subtitle: "For the December board" },
      { id: "plans", layout: "three-column", title: "Three plans", items: ["Free", "Pro", "Team"] },
      { id: "ask", layout: "statement", title: "Move Team to seats" },
    ],
  },
  "deck-3": {
    name: "Onboarding research", language: "en",
    design: { theme: "classic", colorScheme: "corporate-blue" },
    slides: [
      { id: "cover", layout: "cover", title: "Onboarding research", subtitle: "Twelve interviews" },
      { id: "quote", layout: "quote", title: "What we heard", quote: { text: "I didn't know the agent could write the doc for me.", attribution: "Participant 7" } },
    ],
  },
};
const store = new Map<string, Page>();
const summary = (page: Page): PageSummary => ({
  format: page.format, id: page.id, title: page.title, projectPaths: page.projectPaths, revision: page.revision,
  created: page.created, modified: page.modified, trashed: page.trashed, favorite: page.favorite,
  excerpt: page.format ? `${(JSON.parse(page.markdown) as { slides: unknown[] }).slides.length} slides` : page.markdown.slice(0, 180),
});
Object.entries(DECKS).forEach(([id, deck], index) => store.set(id, {
  format: "opf", id, title: (deck as { name: string }).name, markdown: JSON.stringify(deck), projectPaths: index === 0 ? ["/Users/demo/carbon"] : [],
  revision: 3, created: ago(400), modified: ago([2, 30, 200][index]), trashed: false, favorite: index === 0,
}));
store.set("page-1", { id: "page-1", title: "Spaces launch plan", markdown: "# Spaces launch plan\n\nShip Pages and Slides in beta 5.", projectPaths: [], revision: 1, created: ago(500), modified: ago(5), trashed: false, favorite: false });

const callbacks = new Map<number, (event: { event: string; payload: unknown }) => void>();
const subscribed = new Map<number, string>();
let nextCallback = 1;
const emit = (event: string, payload: unknown) => subscribed.forEach((name, id) => { if (name === event) callbacks.get(id)?.({ event, payload }); });

// `listen`'s unlisten reaches for this; without it every unmount throws.
(window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback: (fn: (event: { event: string; payload: unknown }) => void) => { const id = nextCallback++; callbacks.set(id, fn); return id; },
  invoke: async (outer: string, outerArgs: Record<string, unknown>) => {
    const wrapped = outer === "server_invoke";
    const cmd = wrapped ? (outerArgs.cmd as string) : outer;
    const args = (wrapped ? outerArgs.args : outerArgs) as Record<string, unknown>;
    if (cmd === "list_pages") {
      const query = String(args.query ?? "").toLowerCase();
      return [...store.values()].filter((p) => p.trashed === args.trashed && p.title.toLowerCase().includes(query)).map(summary);
    }
    if (cmd === "read_page") {
      const found = store.get(String(args.id));
      if (!found) throw new Error("demo: no such Page");
      return { ...found };
    }
    if (cmd === "update_page") {
      const found = store.get(String(args.id));
      if (!found) throw new Error("demo: no such Page");
      if (args.revision !== found.revision) throw new Error(`Revision conflict: expected ${found.revision}`);
      const next = { ...found, ...(args as Partial<Page>), revision: found.revision + 1, modified: new Date().toISOString() };
      store.set(found.id, next);
      emit("pages_changed", { id: found.id });
      return { ...next };
    }
    if (cmd === "create_slide_deck") {
      const id = `deck-${store.size + 1}`;
      const page: Page = { format: "opf", id, title: String(args.title), markdown: String(args.markdown), projectPaths: [], revision: 1, created: ago(0), modified: ago(0), trashed: false, favorite: false };
      store.set(id, page);
      return { ...page };
    }
    if (cmd === "save_powerpoint_file") { console.info("demo: export", args.title, String(args.data).length, "base64 chars"); return null; }
    if (cmd === "list_page_assets" || cmd === "page_backlinks") return [];
    if (cmd === "page_sync_status") return { page: store.get(String(args.id)), link: null, status: "unlinked", error: null, conflict: null };
    if (cmd === "list_servers") return [];
    if (cmd === "plugin:event|listen") { subscribed.set(Number(args.handler), String(args.event)); return Number(args.handler); }
    if (cmd.startsWith("plugin:event|")) return 1;
    throw new Error(`demo: nothing stubbed for ${cmd}`);
  },
};

/// Rewrites the first deck's second slide title behind the editor, as an agent would.
function agentEdit() {
  const page = store.get("deck-1")!;
  const deck = JSON.parse(page.markdown) as { slides: { title?: string }[] };
  deck.slides[1].title = `Agenda (rev ${page.revision + 1})`;
  store.set(page.id, { ...page, markdown: JSON.stringify(deck), revision: page.revision + 1, modified: new Date().toISOString() });
  emit("pages_changed", { id: page.id });
}

function Demo() {
  const tabs = useSpaceTabs();
  const closer = useRef<(id: string) => void>(() => {});
  return (
    <TooltipProvider>
      <div className="app-shell relative flex h-screen flex-col bg-background" style={{ "--titlebar-h": "0px" } as React.CSSProperties}>
        <DemoThemeBar /><button className="fixed right-4 bottom-4 z-50 rounded-md border border-border bg-popover px-2 py-1 text-xs" onClick={agentEdit}>Agent edit</button>
        <div className="flex h-10 shrink-0 items-center" style={{ "--tabs-lead": "0px" } as React.CSSProperties}>
          <SpaceTabs state={tabs} projects={PROJECTS} active onClose={(id) => closer.current(id)} alignX={0} />
        </div>
        <div className="flex min-h-0 flex-1">
          <SpacesView active projects={PROJECTS} visibleProjects={null} onClose={() => {}}
            sidebarCollapsed={false} onExpandSidebar={() => {}} peek={false} onPeekHover={() => {}}
            onNavigate={() => {}} closeTabRef={closer} />
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
