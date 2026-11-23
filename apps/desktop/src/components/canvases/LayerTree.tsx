import { memo, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ChevronDown, ChevronRight, Frame, Square, Type } from "lucide-react";
import type { PageLayers } from "./graphicsScene";

const glyph = { Frame, Rectangle: Square, Text: Type };
const height = 28;

export const LayerTree = memo(function LayerTree({
  tree,
  folded,
  fold,
  selected,
  pick,
  pagesOpen,
}: {
  tree: PageLayers;
  folded: Set<string>;
  fold: Dispatch<SetStateAction<Set<string>>>;
  pagesOpen: boolean;
  selected: string | null;
  pick: (id: string) => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const [range, setRange] = useState({ first: 0, last: 40 });
  const rows = useMemo(() => {
    const entries: { id: string; depth: number }[] = [];
    function visit(parent: string | null, depth: number) {
      for (const layer of tree.children.get(parent) ?? []) {
        entries.push({ id: layer.id, depth });
        if (!folded.has(layer.id) && tree.children.has(layer.id)) visit(layer.id, depth + 1);
      }
    }
    visit(null, 0);
    return entries;
  }, [tree.topology, folded]);
  useLayoutEffect(() => {
    const list = nav.current!,
      scroll = list.parentElement!;
    const update = () => {
      const y = scroll.getBoundingClientRect().top - list.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(y / height) - 5);
      const last = Math.max(0, Math.ceil((y + scroll.clientHeight) / height) + 5);
      setRange((prev) => (first === prev.first && last === prev.last ? prev : { first, last }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroll);
    for (const child of scroll.children) observer.observe(child);
    scroll.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      scroll.removeEventListener("scroll", update);
    };
  }, [rows, pagesOpen]);
  return (
    <nav ref={nav} aria-label="Layers" style={{ height: rows.length * height, position: "relative" }}>
      {rows.slice(range.first, range.last).map(({ id, depth }, i) => {
        const layer = tree.byId.get(id)!;
        const Glyph = glyph[layer.kind];
        return (
          <div
            key={layer.id}
            className="ce-tree-row"
            data-selected={selected === layer.id}
            style={{
              position: "absolute",
              insetInline: 0,
              top: (range.first + i) * height,
              height,
              paddingLeft: 7 + depth * 14,
            }}
          >
            {tree.children.has(layer.id) ? (
              <button
                className="ce-disclosure"
                aria-label={(folded.has(layer.id) ? "Expand " : "Collapse ") + layer.name}
                aria-expanded={!folded.has(layer.id)}
                onClick={() =>
                  fold((prev) => {
                    const next = new Set(prev);
                    if (next.has(layer.id)) next.delete(layer.id);
                    else next.add(layer.id);
                    return next;
                  })
                }
              >
                {folded.has(layer.id) ? <ChevronRight /> : <ChevronDown />}
              </button>
            ) : (
              <i className="ce-indent" />
            )}
            <button
              className="ce-layer-row"
              aria-pressed={selected === layer.id}
              onClick={() => pick(layer.id)}
            >
              <Glyph size={14} />
              <span>{layer.name}</span>
            </button>
          </div>
        );
      })}
    </nav>
  );
});
