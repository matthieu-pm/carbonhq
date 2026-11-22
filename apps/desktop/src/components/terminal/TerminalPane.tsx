import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { createPortal } from "react-dom";
import { PANEL_LABELS, type PanelTab } from "@/components/RightPanel";
import { terminalLabel, type TerminalTab } from "@/lib/sessionDock";
import { SessionToolIcon } from "@/components/layout/SessionToolTab";
import { useHotkey } from "@/hooks/useHotkey";
import { Maximize2, Plus, X } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { PanelCard } from "@/components/layout/AppShell";
import { HeaderIconButton } from "@/components/layout/IssueTabs";
import { ItemTab } from "@/components/layout/ViewTabs";
import { TerminalOutline18 } from "@/components/icons/nucleo/TerminalOutline18";
import { useResizable, useViewportWidth } from "@/components/ResizeHandle";
import { chordFor } from "@/hooks/useShortcuts";
import { IS_MAC } from "@/lib/platform";
import { invoke } from "@/lib/transport";

export type TerminalControls = {
  addFull: () => void;
  close: (id: string) => void;
  selectSide: (id: string) => void;
};
type Frame = { start: number; data: string; exited: boolean; end: number };

function call<T>(cmd: string, sessionId: string, args: Record<string, unknown>) {
  // The desktop bridge supplies its installation identity. A standalone browser keeps its own.
  let owner: string | undefined;
  if (!("__TAURI_INTERNALS__" in window)) {
    owner = localStorage.getItem("carbon.terminal.owner") ?? undefined;
    if (!owner) {
      owner = crypto.randomUUID();
      localStorage.setItem("carbon.terminal.owner", owner);
    }
  }
  return invoke<T>(cmd, { sessionId, owner, ...args });
}

function toggleKey(e: globalThis.KeyboardEvent) {
  const chord = chordFor("terminal.toggle");
  return (
    chord &&
    e.key.toLowerCase() === chord.key.toLowerCase() &&
    (IS_MAC ? e.metaKey : e.ctrlKey) === chord.meta &&
    e.altKey === chord.alt &&
    e.shiftKey === chord.shift
  );
}

function routeKey(e: KeyboardEvent) {
  if (!toggleKey(e.nativeEvent) && !e.metaKey) e.stopPropagation();
}

function Shell({ sessionId, id, outlet }: { sessionId: string; id: string; outlet: HTMLElement | null }) {
  const [surface] = useState(() => {
    const node = document.createElement("div");
    node.className = "flex min-h-0 min-w-0 flex-1 flex-col p-2";
    return node;
  });
  useLayoutEffect(() => {
    if (!outlet) return;
    outlet.appendChild(surface);
    surface.querySelector("textarea")?.focus();
    return () => surface.remove();
  }, [surface, outlet]);
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  useEffect(() => {
    const el = host.current!;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: getComputedStyle(el).getPropertyValue("--font-mono").trim() || "monospace",
      disableStdin: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    term.attachCustomKeyEventHandler((e) => !toggleKey(e));
    let live = true;
    let ready = false;
    let sentSize = "";
    let pendingInput = "";
    let writing = false;
    const updateTheme = () => {
      const style = getComputedStyle(el);
      term.options.theme = {
        background: style.backgroundColor,
        foreground: style.color,
        cursor: style.color,
      };
    };
    updateTheme();
    const colors = new MutationObserver(updateTheme);
    colors.observe(document.documentElement, { attributes: true });
    async function sendInput(data: string) {
      if (!ready) return;
      pendingInput += data;
      if (writing) return;
      writing = true;
      try {
        while (pendingInput) {
          const batch = pendingInput;
          pendingInput = "";
          await call("terminal_write", sessionId, { id, data: batch });
        }
      } catch (e) {
        pendingInput = "";
        if (live) setStatus(String(e));
      } finally {
        writing = false;
      }
    }
    function resize() {
      if (!el.clientWidth || !el.clientHeight) return;
      fit.fit();
      const next = term.cols + "x" + term.rows;
      if (ready && sentSize !== next) {
        sentSize = next;
        void call("terminal_resize", sessionId, { id, cols: term.cols, rows: term.rows }).catch((e) => {
          if (live) {
            sentSize = "";
            setStatus(String(e));
          }
        });
      }
    }
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    const input = term.onData((data) => void sendInput(data));
    // Keep the shell's bytes off the shared event stream. Reattach with the last acknowledged offset.
    async function read() {
      let offset = 0;
      let replayEnd: number | undefined;
      while (live) {
        try {
          const frame = await call<Frame>("terminal_read", sessionId, { id, offset, wait: ready });
          if (!live) return;
          replayEnd ??= frame.end;
          if (frame.start !== offset) term.reset();
          const data = Uint8Array.from(atob(frame.data), (c) => c.charCodeAt(0));
          if (data.length) await new Promise<void>((done) => term.write(data, done));
          if (!live) return;
          offset = frame.start + data.length;
          if (frame.exited) {
            term.options.disableStdin = true;
            ready = false;
            setStatus("Shell exited.");
            return;
          }
          if (offset >= replayEnd && !ready) {
            ready = true;
            term.options.disableStdin = false;
            resize();
          }
          setStatus("");
        } catch (e) {
          if (!live) return;
          ready = false;
          term.options.disableStdin = true;
          sentSize = "";
          replayEnd = undefined;
          setStatus(String(e));
          if (String(e).includes("Terminal tab closed")) return;
          await new Promise((done) => setTimeout(done, 1200));
        }
      }
    }
    resize();
    term.focus();
    void read();
    return () => {
      live = false;
      observer.disconnect();
      colors.disconnect();
      input.dispose();
      term.dispose();
    };
  }, [sessionId, id]);
  return createPortal(
    <>
      <div
        className="min-h-0 min-w-0 flex-1 overflow-hidden bg-background text-foreground"
        ref={host}
        onKeyDown={routeKey}
      />
      {status && (
        <p role="status" className="px-2 py-1 text-ui text-muted-foreground">
          {status}
        </p>
      )}
    </>, surface
  );
}

const selectedTabs = new Map<string, string>();

type PaneProps = {
  sessionId: string;
  rail: HTMLDivElement | null;
  sideOpen: boolean;
  fullHost: HTMLElement | null;
  fullTabs: TerminalTab[];
  fullId?: string;
  controls: Ref<TerminalControls>;
  expandTerminal: (tab: TerminalTab, hasSideShells: boolean) => void;
  onTerminalList: (tabs: TerminalTab[]) => void;
  contentHost: (node: HTMLDivElement | null) => void;
  terminals: boolean;
  views: PanelTab[];
  selectedView: PanelTab | null;
  showView: (view: PanelTab) => void;
  expandView: (view: PanelTab) => void;
  closeView: (view: PanelTab) => void;
  showTerminal: () => void;
  hide: () => void;
};

export default function TerminalPane({
  sessionId, rail, contentHost, terminals, views, selectedView,
  showView, expandView, closeView, showTerminal, hide, sideOpen, fullHost, fullTabs, fullId, controls, expandTerminal, onTerminalList,
}: PaneProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [active, setActive] = useState("");
  const [sideOutlet, setSideOutlet] = useState<HTMLDivElement | null>(null);
  const sideTabs = tabs.filter((t) => !fullTabs.some((full) => full.id === t.id));
  const needsShells = terminals || fullTabs.length > 0;
  const sideTab = sideTabs.find((t) => t.id === active) ?? sideTabs[0];
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const overlay = useViewportWidth() < 960;
  const { style, handle } = useResizable({
    storageKey: "carbon.terminal.width",
    initial: 420,
    min: 240,
    edge: "left",
    label: "Side tab width",
    pane: "terminal",
    publish: sideOpen && !overlay,
    // Leave room for the navigation and session controls on the same rail.
    floor: 440,
  });
  const tabStrip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tabStrip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [rail, active, selectedView]);
  const mounted = useRef(false);
  function select(id: string) {
    selectedTabs.set(sessionId, id);
    setActive(id);
  }
  async function load(additional: boolean, current: () => boolean, full = false) {
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    try {
      const next = await call<TerminalTab[]>("terminal_open", sessionId, { id, additional });
      if (!current()) return;
      setTabs(next);
      onTerminalList(next);
      if (full) {
        const created = next.find((t) => t.id === id);
        if (created) expandTerminal(created, next.some((t) => t.id !== id && !fullTabs.some((f) => f.id === t.id)));
        return;
      }
      const prior = selectedTabs.get(sessionId);
      select(additional ? id : (next.find((t) => t.id === prior)?.id ?? next[0].id));
      if (additional) showTerminal();
    } catch (e) {
      if (current())
        setError(
          String(e).includes("unknown command terminal_open")
            ? "Update the Carbon server for this session to use terminal tabs."
            : String(e),
        );
    } finally {
      if (current()) setBusy(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!needsShells || tabs.length) return;
    let current = true;
    void load(false, () => current);
    return () => { current = false; };
  }, [sessionId, needsShells]);
  async function close(id: string) {
    setBusy(true);
    setError("");
    try {
      await call("terminal_close", sessionId, { id });
      if (!mounted.current) return;
      const next = tabs.filter((t) => t.id !== id);
      setTabs(next);
      onTerminalList(next);
      if (!next.length) {
        selectedTabs.delete(sessionId);
      } else if (selectedTabs.get(sessionId) === id) {
        const index = tabs.findIndex((tab) => tab.id === id);
        select((next[index] ?? next[next.length - 1]).id);
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  useImperativeHandle(controls, () => ({
    addFull: () => { if (!busy) void load(true, () => mounted.current, true); },
    close: (id) => { if (!busy) void close(id); },
    selectSide: select,
  }));
  const step = (delta: number) => {
    const options = [...views, ...sideTabs.map((t) => t.id)];
    if (!options.length) return;
    const at = options.indexOf(selectedView ?? sideTab?.id ?? "");
    const next = (at + delta + options.length) % options.length;
    if (next < views.length) showView(views[next]);
    else { select(options[next]); showTerminal(); }
  };
  useHotkey("panel.tab.prev", () => step(-1), { enabled: sideOpen });
  useHotkey("panel.tab.next", () => step(1), { enabled: sideOpen });
  return (
    <>
    {sideOpen && <PanelCard
      className={overlay ? "absolute right-2 top-(--titlebar-h) bottom-2 z-20" : undefined}
      resizeHandle={handle}
    >
      <aside
        aria-label={selectedView ? PANEL_LABELS[selectedView] : "Terminal"}
        aria-busy={busy}
        style={style}
        className="flex min-w-0 flex-col bg-background"
      >
        {rail && createPortal(
          <div style={style} className="flex h-(--titlebar-h) min-w-0 items-center gap-1 px-1">
            <div
              ref={tabStrip}
              role="tablist"
              aria-label="Side tabs"
              className="flex min-w-0 items-center gap-1 overflow-x-auto px-0.5 py-1"
            >
              {views.map((view) => <ItemTab key={view} fixed label={PANEL_LABELS[view]}
                icon={<SessionToolIcon tab={view} />} active={selectedView === view}
                onPick={() => showView(view)} onClose={() => closeView(view)} />)}
              {sideTabs.map((tab) => (
                <ItemTab
                  key={tab.id}
                  fixed
                  icon={<TerminalOutline18 className="size-3.5" />}
                  label={terminalLabel(tab)}
                  active={!selectedView && tab.id === sideTab?.id}
                  onPick={() => { select(tab.id); showTerminal(); }}
                  onClose={busy ? undefined : () => void close(tab.id)}
                />
              ))}
            </div>
            <HeaderIconButton
              label="New terminal"
              disabled={busy}
              onClick={() => void load(true, () => mounted.current)}
            >
              <Plus className="size-4" />
            </HeaderIconButton>
            <div className="flex-1" />
            {(selectedView || sideTab) && <HeaderIconButton label="Open full view" disabled={!selectedView && busy} onClick={() => {
              if (selectedView) expandView(selectedView);
              else if (sideTab) expandTerminal(sideTab, sideTabs.length > 1);
            }}>
              <Maximize2 className="size-4" />
            </HeaderIconButton>}
            <HeaderIconButton label={selectedView ? "Hide side pane" : "Hide terminal"} onClick={hide}>
              <X className="size-4" />
            </HeaderIconButton>
          </div>, rail)}
        <div ref={contentHost} className={selectedView ? "@container/diff flex min-h-0 min-w-0 flex-1" : "hidden"} />
        {!selectedView && busy && !tabs.length && <p role="status" className="px-2 py-1 text-ui text-muted-foreground">Opening terminal…</p>}
        {error && (
          <p role="alert" className="px-2 py-1 text-ui">
            {error}
          </p>
        )}
        {!selectedView && <div ref={setSideOutlet} className="flex min-h-0 flex-1 flex-col" />}
      </aside>
    </PanelCard>}
    {tabs.filter((tab) => tab.id === fullId || (sideOpen && !selectedView && tab.id === sideTab?.id)).map((tab) => (
      <Shell key={tab.id} id={tab.id} sessionId={sessionId} outlet={tab.id === fullId ? fullHost : sideOutlet} />
    ))}
    {fullId && error && fullHost && createPortal(<p role="alert" className="px-2 py-1 text-ui">{error}</p>, fullHost)}
    </>
  );
}
