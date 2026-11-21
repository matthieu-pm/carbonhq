import type { PanelTab } from "@/components/RightPanel";

export type TerminalTab = { id: string; number: number };
export type TerminalView = `terminal:${string}`;

export function terminalView(id: string): TerminalView {
  return `terminal:${id}`;
}

export function isTerminalView(view: string): view is TerminalView {
  return view.startsWith("terminal:");
}

export function terminalLabel(tab: TerminalTab) {
  return tab.number === 1 ? "Terminal" : `Terminal ${tab.number}`;
}

export type SessionDock = {
  side: PanelTab[];
  full: PanelTab[];
  active: PanelTab | "terminal" | null;
  terminals: boolean;
  fullTerminals: TerminalTab[];
};

export const EMPTY_DOCK: SessionDock = { side: [], full: [], active: null, terminals: false, fullTerminals: [] };

export function dockTab(dock: SessionDock, tab: PanelTab): SessionDock {
  return {
    ...dock, active: tab,
    side: dock.side.includes(tab) ? dock.side : [...dock.side, tab],
    full: dock.full.filter((t) => t !== tab),
  };
}

export function expandTab(dock: SessionDock, tab: PanelTab): SessionDock {
  return {
    ...dock, active: null,
    side: dock.side.filter((t) => t !== tab),
    full: dock.full.includes(tab) ? dock.full : [...dock.full, tab],
  };
}

export function closeDockTab(dock: SessionDock, tab: PanelTab): SessionDock {
  const side = dock.side.filter((t) => t !== tab);
  const next = side[dock.side.indexOf(tab)] ?? side.at(-1) ?? (dock.terminals ? "terminal" : null);
  return { ...dock, side, full: dock.full.filter((t) => t !== tab), active: dock.active === tab ? next : dock.active };
}

export function reconcileTerminals(dock: SessionDock, tabs: TerminalTab[]): SessionDock {
  const fullTerminals = dock.fullTerminals.filter((full) => tabs.some((tab) => tab.id === full.id));
  const terminals = tabs.length > fullTerminals.length;
  return {
    ...dock, fullTerminals, terminals,
    active: dock.active === "terminal" && !terminals ? dock.side.at(-1) ?? null : dock.active,
  };
}
