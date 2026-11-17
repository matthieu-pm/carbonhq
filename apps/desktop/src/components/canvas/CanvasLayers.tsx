import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronRight, Frame, Image, Square, Type } from "lucide-react";

import type { CanvasFrame, CanvasNode } from "@/types/events";
import { cn } from "@/lib/utils";

type Pick = { frameId: string; nodeId: string | null };

type Row = {
  key: string;
  pick: Pick;
  depth: number;
  parent: string | null;
  label: string;
  /// What the row is, for its glyph and for a screen reader.
  kind: "frame" | "element" | "text" | "image";
  detail: string | null;
  hasChildren: boolean;
  setSize: number;
  posInSet: number;
};

const keyOf = (pick: Pick) => `${pick.frameId}/${pick.nodeId ?? ""}`;
const GLYPHS = { frame: Frame, element: Square, text: Type, image: Image };
const IMAGE_TAGS = new Set(["img", "picture", "svg", "video", "canvas"]);

/// The frames and their elements as a tree, selected in step with the board.
///
/// One flat list of `treeitem`s carrying `aria-level`, rather than nested
/// groups: it is what lets a row's focus, selection and indent all come from
/// one array, and it is a shape the tree pattern names outright.
///
/// Plain arrows move and select, the way a layers list in a design tool does;
/// Shift with an arrow adds the next row to the selection; Shift-, ⌘- or
/// Ctrl-click toggles one. Nothing here moves, renames or deletes a layer.
export default function CanvasLayers({
  frames,
  picks,
  onPick,
}: {
  frames: CanvasFrame[];
  picks: { frameId: string; nodeId: string | null }[];
  onPick: (pick: { frameId: string; nodeId: string | null }, additive: boolean) => void;
}) {
  const tree = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const parents = useMemo(() => parentMap(frames), [frames]);
  const selected = useMemo(() => new Set(picks.map(keyOf)), [picks]);

  // A pick made on the board opens every row above it, so the list always
  // shows what is selected. Collapsing afterwards is the reader's to do.
  useEffect(() => {
    const reveal: string[] = [];
    for (const pick of picks) {
      if (!pick.nodeId) continue;
      for (let up = parents.get(keyOf(pick)); up; up = parents.get(up)) reveal.push(up);
    }
    if (!reveal.length) return;
    setExpanded((open) => (reveal.every((key) => open.has(key)) ? open : new Set([...open, ...reveal])));
  }, [picks, parents]);

  const rows = useMemo(() => visibleRows(frames, expanded), [frames, expanded]);

  // The last pick is where Tab lands and what scrolls into view, without
  // taking focus from the board that made it.
  // The row may only exist once the reveal above has rendered, so the scroll
  // waits for it rather than firing once and missing.
  const lastPick = picks.length ? keyOf(picks[picks.length - 1]) : null;
  const reveal = useRef<string | null>(null);
  useEffect(() => {
    reveal.current = lastPick;
    if (lastPick) setFocusKey(lastPick);
  }, [lastPick]);
  useEffect(() => {
    const el = reveal.current && rowElement(tree.current, reveal.current);
    if (!el) return;
    el.scrollIntoView({ block: "nearest" });
    reveal.current = null;
  }, [lastPick, rows]);

  const current = rows.some((row) => row.key === focusKey) ? focusKey : rows[0]?.key ?? null;

  const focusRow = (key: string) => {
    setFocusKey(key);
    const el = rowElement(tree.current, key);
    el?.focus();
    el?.scrollIntoView({ block: "nearest" });
  };
  const toggle = (key: string, open?: boolean) => setExpanded((prev) => {
    const next = new Set(prev);
    if (open ?? !next.has(key)) next.add(key);
    else next.delete(key);
    return next;
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = rows.findIndex((row) => row.key === current);
    const row = rows[at];
    if (!row) return;
    const move = (to: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (!next || next.key === row.key) return;
      focusRow(next.key);
      // Extending never toggles a row already in the selection back out.
      if (!e.shiftKey) onPick(next.pick, false);
      else if (!selected.has(next.key)) onPick(next.pick, true);
    };
    switch (e.key) {
      case "ArrowDown": move(at + 1); break;
      case "ArrowUp": move(at - 1); break;
      case "Home": move(0); break;
      case "End": move(rows.length - 1); break;
      case "ArrowRight":
        if (row.hasChildren && !expanded.has(row.key)) toggle(row.key, true);
        else if (row.hasChildren) move(at + 1);
        break;
      case "ArrowLeft":
        if (row.hasChildren && expanded.has(row.key)) toggle(row.key, false);
        else if (row.parent) {
          const parent = rows.find((r) => r.key === row.parent);
          if (parent) { focusRow(parent.key); onPick(parent.pick, false); }
        }
        break;
      case "Enter":
      case " ":
        onPick(row.pick, e.shiftKey || e.metaKey || e.ctrlKey);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const onRowClick = (row: Row, e: MouseEvent) => {
    setFocusKey(row.key);
    onPick(row.pick, e.shiftKey || e.metaKey || e.ctrlKey);
  };

  if (!frames.length) {
    return <p className="px-2 py-1 text-xs text-muted-foreground">No frames yet. Add one with New frame.</p>;
  }

  return (
    <div
      ref={tree}
      role="tree"
      aria-label="Layers"
      aria-multiselectable="true"
      onKeyDown={onKeyDown}
      className="flex flex-col gap-px text-ui outline-none"
    >
      {rows.map((row) => {
        const Glyph = GLYPHS[row.kind];
        const isSelected = selected.has(row.key);
        const isOpen = expanded.has(row.key);
        return (
          <div
            key={row.key}
            role="treeitem"
            data-row={row.key}
            aria-level={row.depth + 1}
            aria-setsize={row.setSize}
            aria-posinset={row.posInSet}
            aria-selected={isSelected}
            aria-expanded={row.hasChildren ? isOpen : undefined}
            tabIndex={row.key === current ? 0 : -1}
            onClick={(e) => onRowClick(row, e)}
            onFocus={() => setFocusKey(row.key)}
            style={{ paddingLeft: 4 + row.depth * 12 }}
            className={cn(
              "group flex h-7 shrink-0 cursor-default items-center gap-1 rounded-md pr-2 select-none",
              "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
              row.kind === "frame" ? "text-foreground" : "text-muted-foreground",
              isSelected ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50",
            )}
          >
            {/* Pointer only: the row itself is what the keyboard expands. */}
            <span
              aria-hidden
              onClick={row.hasChildren ? (e) => { e.stopPropagation(); toggle(row.key); } : undefined}
              className={cn("flex size-4 shrink-0 items-center justify-center rounded-sm", row.hasChildren && "cursor-pointer hover:text-foreground")}
            >
              {row.hasChildren && <ChevronRight className={cn("size-3 transition-transform duration-150", isOpen && "rotate-90")} />}
            </span>
            <Glyph className={cn("shrink-0", row.kind === "frame" ? "size-3.5" : "size-3", "text-muted-foreground")} />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            {row.detail && <span className={cn("shrink-0 text-xs text-muted-foreground tabular-nums", !isSelected && "hidden group-hover:inline")}>{row.detail}</span>}
          </div>
        );
      })}
    </div>
  );
}

function rowElement(root: HTMLElement | null, key: string): HTMLElement | null {
  return root?.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`) ?? null;
}

/// Each node row's parent row, frames included, so a pick can open its way up.
function parentMap(frames: CanvasFrame[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (frameId: string, nodes: CanvasNode[], parent: string) => {
    for (const node of nodes) {
      const key = keyOf({ frameId, nodeId: node.id });
      map.set(key, parent);
      if (node.kind === "element") walk(frameId, node.children, key);
    }
  };
  for (const frame of frames) walk(frame.id, frame.content.nodes, keyOf({ frameId: frame.id, nodeId: null }));
  return map;
}

function visibleRows(frames: CanvasFrame[], expanded: Set<string>): Row[] {
  const rows: Row[] = [];
  const walk = (frameId: string, nodes: CanvasNode[], depth: number, parent: string) => {
    nodes.forEach((node, i) => {
      const key = keyOf({ frameId, nodeId: node.id });
      const children = node.kind === "element" ? node.children : [];
      rows.push({
        key,
        pick: { frameId, nodeId: node.id },
        depth,
        parent,
        label: nodeLabel(node),
        kind: node.kind === "text" ? "text" : IMAGE_TAGS.has(node.tag.toLowerCase()) ? "image" : "element",
        detail: null,
        hasChildren: children.length > 0,
        setSize: nodes.length,
        posInSet: i + 1,
      });
      if (children.length && expanded.has(key)) walk(frameId, children, depth + 1, key);
    });
  };
  frames.forEach((frame, i) => {
    const key = keyOf({ frameId: frame.id, nodeId: null });
    rows.push({
      key,
      pick: { frameId: frame.id, nodeId: null },
      depth: 0,
      parent: null,
      label: frame.name || "Untitled frame",
      kind: "frame",
      detail: `${Math.round(frame.geometry.width)} × ${Math.round(frame.geometry.height)}`,
      hasChildren: frame.content.nodes.length > 0,
      setSize: frames.length,
      posInSet: i + 1,
    });
    if (expanded.has(key)) walk(frame.id, frame.content.nodes, 1, key);
  });
  return rows;
}

function nodeLabel(node: CanvasNode): string {
  if (node.name.trim()) return node.name;
  if (node.kind === "text") return node.text.trim().replace(/\s+/g, " ").slice(0, 80) || "Text";
  return node.tag;
}
