import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Ellipsis, Frame, Hand, Maximize, Minus, MousePointer2, Plus, Scan, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { editableText, hasFixedGridPlacement, layerSlot, movedLayer, reorderLayer, resizedLayer, type CanvasEditIntent } from "@/lib/canvasEditing";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import ShortcutKeys from "@/components/ShortcutKeys";
import { Kbd } from "@/components/ui/kbd";
import { useHotkey } from "@/hooks/useHotkey";
import { bounds, fitCamera, flattenNodes, intersects, pickLayer, previewKey, togglePick, zoomCamera, type CanvasPick, type FramePreview, type LayerBox } from "@/lib/canvasBoard";
import { GestureFrame, resolvePreviewMarkup } from "./FrameRenderer";
import { cn } from "@/lib/utils";
import type { Canvas, CanvasCamera, CanvasGeometry } from "@/types/events";
import type { ShortcutId } from "@/lib/shortcuts";
import { IS_MAC } from "@/lib/platform";
import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";

type Draft = {
  edit: CanvasEditIntent;
  edge?: CanvasGeometry;
  outline?: CanvasGeometry;
};

type BoardGesture = {
  id: number;
  x: number;
  y: number;
  camera: CanvasCamera;
  revision: number;
  pan: boolean;
  moved: boolean;
  additive: boolean;
  picks: CanvasPick[];
  target: string | null;
  label: boolean;
  transform?: { frameId: string; layer: LayerBox | null; parent?: LayerBox; resize: boolean; free: boolean; text: boolean };
};

type TextEdit = { frameId: string; nodeId: string; revision: number; box: LayerBox; origin: Pick<CanvasGeometry, "x" | "y">; initial: string };

export default function CanvasBoard({ canvas, active, picks, onPicks, previews, errors, onVisible, onNewFrame, stats, editing = [], captureReveal, edit }: {
  canvas: Canvas; active: boolean; picks: CanvasPick[]; onPicks(picks: CanvasPick[]): void;
  previews: Map<string, FramePreview>; errors: Map<string, string>; onVisible(ids: string[]): void; onNewFrame(): void;
  editing?: string[];
  edit?: {
    disabled: boolean;
    commit(intent: CanvasEditIntent, revision: number): Promise<boolean>;
    addText(): void;
    duplicate(): void;
    remove(): void;
    copy(): void;
    paste(): void;
    canCopy: boolean;
  };
  captureReveal?: { frameId: string; revealId: string } | null;
  stats: { cached: number; bytes: number; captures: number };
}) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCamera] = useState<CanvasCamera>(() => {
    const saved = readLocalStorage<CanvasCamera | null>(`carbon.canvas.camera:${canvas.id}`, null);
    if (saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite) && saved.zoom >= 0.02 && saved.zoom <= 4) return saved;
    return canvas.camera ?? { x: 0, y: 0, zoom: 1 };
  });
  const initial = useRef(false);
  const shownCapture = useRef<string | null>(null);
  const [tool, setTool] = useState<"select" | "hand">("select");
  const [space, setSpace] = useState(false);
  const [marquee, setMarquee] = useState<CanvasGeometry | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const hitTest = useRef<AbortController | null>(null);
  useEffect(() => () => { hitTest.current?.abort(); }, [active]);
  const drag = useRef<BoardGesture | null>(null);
  const draft = useRef<Draft | null>(null);
  const [painted, setPainted] = useState<Draft | null>(null);
  const [textEdit, setTextEdit] = useState<TextEdit | null>(null);
  const lastClick = useRef<{ frameId: string; x: number; y: number; time: number } | null>(null);
  const updateDraft = (next: Draft | null) => { draft.current = next; setPainted(next); };
  const cancelDrag = () => { drag.current = null; setMarquee(null); updateDraft(null); };
  const current = useRef({ picks, frames: canvas.frames, revision: canvas.revision, camera });
  current.current = { camera, picks, frames: canvas.frames, revision: canvas.revision };
  const canEdit = !!edit && !edit.disabled;
  const frameBounds = useMemo(() => bounds(canvas.frames.map((f) => f.geometry)), [canvas.frames]);
  const fit = (selection = false) => {
    const rects = selection ? picks.flatMap((p) => { const f = canvas.frames.find((f) => f.id === p.frameId); if (!f) return []; const b = p.nodeId && previews.get(f.id)?.boxes.find((b) => b.id === p.nodeId); return [b ? { ...b, x: f.geometry.x + b.x, y: f.geometry.y + b.y } : f.geometry]; }) : canvas.frames.map((f) => f.geometry);
    setCamera(fitCamera(bounds(rects), size.width, size.height));
  };
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth && node.clientHeight) setSize({ width: node.clientWidth, height: node.clientHeight });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (!size.width || !size.height || initial.current) return;
    initial.current = true;
    if (!readLocalStorage(`carbon.canvas.camera:${canvas.id}`, null) && !canvas.camera) setCamera(fitCamera(frameBounds, size.width, size.height));
  }, [canvas.id, canvas.camera, frameBounds, size]);
  useEffect(() => {
    if (!initial.current) return;
    const timer = window.setTimeout(() => writeLocalStorage(`carbon.canvas.camera:${canvas.id}`, camera), 250);
    return () => { clearTimeout(timer); writeLocalStorage(`carbon.canvas.camera:${canvas.id}`, camera); };
  }, [camera, canvas.id]);
  useEffect(() => {
    if (active) return;
    cancelDrag();
  }, [active]);
  const previousCount = useRef(canvas.frames.length);
  useLayoutEffect(() => {
    const historyChange = canvas.change.restoredFrom != null || /^(?:Undo|Redo) /.test(canvas.change.author.label ?? "");
    if (!historyChange && canvas.frames.length > previousCount.current && size.width && size.height) setCamera(fitCamera(frameBounds, size.width, size.height));
    previousCount.current = canvas.frames.length;
  }, [canvas.change, canvas.frames.length, frameBounds, size]);
  useLayoutEffect(() => {
    if (!active || !size.width || !size.height || !captureReveal || shownCapture.current === captureReveal.revealId) return;
    const frame = canvas.frames.find(frame => frame.id === captureReveal.frameId);
    if (!frame) return;
    shownCapture.current = captureReveal.revealId;
    setCamera(fitCamera(frame.geometry, size.width, size.height));
    root.current?.focus();
  }, [active, canvas.frames, captureReveal, size]);
  useEffect(() => {
    const node = root.current;
    if (!node || !active) return;
    let pending: CanvasCamera | null = null, raf = 0;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const v = pending ?? current.current.camera;
      const rect = node.getBoundingClientRect();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientHeight : 1;
      pending = event.ctrlKey || event.metaKey ? zoomCamera(v, Math.exp(-event.deltaY * unit * 0.01), event.clientX - rect.left, event.clientY - rect.top)
        : { ...v, x: v.x - event.deltaX * unit, y: v.y - event.deltaY * unit };
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; if (pending) setCamera(pending); pending = null; });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    let gesture: { camera: CanvasCamera; x: number; y: number } | null = null;
    const pinch = (event: Event) => {
      event.preventDefault();
      const e = event as Event & { scale: number; clientX: number; clientY: number };
      if (event.type === "gesturestart") {
        const rect = node.getBoundingClientRect();
        gesture = { camera: pending ?? current.current.camera, x: e.clientX - rect.left, y: e.clientY - rect.top };
      }
      if (gesture && Number.isFinite(e.scale) && e.scale > 0) setCamera(zoomCamera(gesture.camera, e.scale, gesture.x, gesture.y));
      if (event.type === "gestureend") gesture = null;
    };
    const gestures = ["gesturestart", "gesturechange", "gestureend"];
    gestures.forEach((type) => node.addEventListener(type, pinch, { passive: false }));
    const blur = () => { setSpace(false); cancelDrag(); };
    window.addEventListener("blur", blur);
    return () => { node.removeEventListener("wheel", wheel); gestures.forEach((type) => node.removeEventListener(type, pinch)); window.removeEventListener("blur", blur); cancelAnimationFrame(raf); };
  }, [active]);
  const viewport = { x: (-camera.x - 80) / camera.zoom, y: (-camera.y - 80) / camera.zoom, width: (size.width + 160) / camera.zoom, height: (size.height + 160) / camera.zoom };
  const geometryFor = (frame: Canvas["frames"][number]) => painted?.edit.kind === "frames"
    ? { ...frame.geometry, ...painted.edit.geometry[frame.id] } : frame.geometry;
  const visible = canvas.frames.filter((f) => intersects(geometryFor(f), viewport));
  const savedKeys = useMemo(() => new Map(canvas.frames.map(frame => [frame.id, previewKey(frame, canvas.tokens)])), [canvas.frames, canvas.tokens]);
  const freshPreview = (frame: Canvas["frames"][number]) => {
    const preview = previews.get(frame.id);
    return preview?.key.startsWith(`${savedKeys.get(frame.id)}:`) ? preview : undefined;
  };
  const focusedId = picks.at(-1)?.frameId;
  const visibleKey = [focusedId, ...visible.map((f) => f.id)].filter((id, i, all) => id && all.indexOf(id) === i).join(",");
  useEffect(() => onVisible(visibleKey.split(",").filter(Boolean)), [visibleKey, onVisible]);
  useHotkey("canvas.fitAll", () => fit(), { enabled: active, skipInTextField: true });
  useHotkey("canvas.fitSelection", () => fit(true), { enabled: active && picks.length > 0, skipInTextField: true });
  useHotkey("canvas.actualSize", () => setCamera(zoomCamera(camera, 1 / camera.zoom, size.width / 2, size.height / 2)), { enabled: active, skipInTextField: true });
  const point = (event: PointerEvent) => { const rect = root.current!.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    const element = event.target as Element;
    if (element.closest("button,input,textarea,[contenteditable]") || !event.isPrimary || ![0, 1].includes(event.button)) return;
    root.current?.focus({ preventScroll: true });
    hitTest.current?.abort();
    setSelectionError(null);
    const p = point(event);
    const resize = element.closest<HTMLElement>("[data-canvas-resize]");
    const target = resize?.dataset.frameId ?? element.closest<HTMLElement>("[data-frame-id]")?.dataset.frameId ?? null;
    const label = !!element.closest("[data-canvas-frame-label]");
    const pan = event.button === 1 || tool === "hand" || space;
    const frame = canvas.frames.find(frame => frame.id === target);
    const picked = !label && picks.length === 1 && picks[0].frameId === target ? picks[0] : null;
    const x = frame ? (p.x - camera.x) / camera.zoom - frame.geometry.x : 0;
    const y = frame ? (p.y - camera.y) / camera.zoom - frame.geometry.y : 0;
    const boxes = frame ? freshPreview(frame)?.boxes : undefined;
    const layer = picked?.nodeId ? boxes?.find(box => box.id === picked.nodeId) : undefined;
    const inLayer = layer && (resize || intersects(layer, { x, y, width: 0, height: 0 })) ? layer : null;
    const hasLayerSelection = !label && picks.some(pick => pick.frameId === target && pick.nodeId);
    const slot = frame && inLayer ? layerSlot(frame.content.nodes, inLayer.id) : null;
    const transform = !pan && canEdit && frame && !event.shiftKey && (!hasLayerSelection || inLayer)
      ? { frameId: frame.id, layer: inLayer, parent: boxes?.find(box => box.id === (slot?.parent?.id ?? frame.id)), resize: !!resize, free: event.altKey, text: slot?.siblings[slot.index].kind === "text" }
      : undefined;
    drag.current = { id: event.pointerId, ...p, camera, revision: canvas.revision, pan, moved: false, additive: event.shiftKey, picks, target, label, transform };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const p = point(event), dx = p.x - d.x, dy = p.y - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.pan) {
      setCamera({ ...d.camera, x: d.camera.x + dx, y: d.camera.y + dy });
      return;
    }
    if (d.transform) {
      const { frameId, layer, parent, resize, free, text } = d.transform;
      const frame = canvas.frames.find(frame => frame.id === frameId);
      if (!frame || d.revision !== canvas.revision) return;
      const sx = Math.round(dx / d.camera.zoom), sy = Math.round(dy / d.camera.zoom);
      if (layer) {
        const preview = freshPreview(frame);
        if (!preview) return;
        if (!resize && !free && (text || !["absolute", "fixed"].includes(layer.styles.position))) {
          if (!text && hasFixedGridPlacement(layer, parent)) {
            setSelectionError("This layer has a fixed grid position. Hold Option or Alt while dragging to offset it.");
            return;
          }
          const slot = reorderLayer(frame, layer.id, preview.boxes, (p.x - d.camera.x) / d.camera.zoom - frame.geometry.x, (p.y - d.camera.y) / d.camera.zoom - frame.geometry.y);
          updateDraft(slot ? {
            edit: { kind: "reorder", frameId, nodeId: layer.id, index: slot.index, order: slot.order },
            edge: { ...slot.edge, x: frame.geometry.x + slot.edge.x, y: frame.geometry.y + slot.edge.y },
          } : null);
          return;
        }
        if (!sx && !sy) { updateDraft(null); return; }
        const styles = resize ? resizedLayer(layer, sx, sy, text, parent) : movedLayer(layer, sx, sy, text);
        const outline = resize
          ? { ...layer, x: frame.geometry.x + layer.x, y: frame.geometry.y + layer.y, width: Math.max(1, layer.width + sx), height: Math.max(1, layer.height + sy) }
          : { ...layer, x: frame.geometry.x + layer.x + sx, y: frame.geometry.y + layer.y + sy };
        updateDraft({ edit: { kind: "style", frameId, nodeId: layer.id, styles, label: resize ? "Resize layer" : "Move layer" }, outline });
        return;
      }
      if (!sx && !sy) { updateDraft(null); return; }
      const original = frame.geometry;
      const dimension = (value: number) => Math.min(10_000, Math.max(1, Math.round(value)));
      const selected = d.picks.filter(pick => !pick.nodeId).map(pick => pick.frameId);
      const moving = !resize && selected.includes(frameId) ? selected : [frameId];
      if (!d.picks.some(pick => pick.frameId === frameId && !pick.nodeId)) onPicks([{ frameId, nodeId: null }]);
      const geometry = Object.fromEntries(canvas.frames.filter(frame => moving.includes(frame.id)).map(frame => [frame.id, resize
        ? { width: dimension(original.width + sx), height: dimension(original.height + sy) }
        : { x: frame.geometry.x + sx, y: frame.geometry.y + sy }]));
      updateDraft({ edit: { kind: "frames", geometry, label: resize ? "Resize frame" : "Move frames" } });
      return;
    }
    if (d.target && canEdit && !d.additive) return;
    const box = { x: (Math.min(d.x, p.x) - d.camera.x) / d.camera.zoom, y: (Math.min(d.y, p.y) - d.camera.y) / d.camera.zoom, width: Math.abs(dx) / d.camera.zoom, height: Math.abs(dy) / d.camera.zoom };
    setMarquee(box);
    const selected = canvas.frames.filter((f) => intersects(f.geometry, box)).map((f) => ({ frameId: f.id, nodeId: null }));
    onPicks(d.additive ? [...d.picks, ...selected.filter((p) => !d.picks.some((s) => s.frameId === p.frameId && !s.nodeId))] : selected);
  };

  const startText = (frame: Canvas["frames"][number], nodeId: string) => {
    if (!canEdit || textEdit) return false;
    const slot = layerSlot(frame.content.nodes, nodeId);
    if (!slot) return false;
    const text = editableText(slot.siblings[slot.index]);
    const boxes = freshPreview(frame)?.boxes;
    const box = boxes?.find(box => box.id === text?.id) ?? boxes?.find(box => box.id === nodeId);
    if (!text || !box) return false;
    setTextEdit({ frameId: frame.id, nodeId: text.id, revision: canvas.revision, box, origin: frame.geometry, initial: text.text });
    return true;
  };

  const up = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const proposal = d.transform && d.moved ? draft.current : null;
    drag.current = null;
    setMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (d.pan || d.moved) {
      lastClick.current = null;
      if (proposal && edit) void edit.commit(proposal.edit, d.revision).finally(() => {
        if (draft.current === proposal) updateDraft(null);
      });
      else updateDraft(null);
      return;
    }
    if (d.transform?.resize) return;
    if (!d.target) { lastClick.current = null; if (!d.additive) onPicks([]); return; }
    const frame = canvas.frames.find((f) => f.id === d.target);
    if (!frame) return;
    const p = point(event);
    const previous = lastClick.current;
    const twice = !d.additive && !d.label && previous?.frameId === frame.id && event.timeStamp - previous.time < 450 && Math.hypot(p.x - previous.x, p.y - previous.y) < 5;
    lastClick.current = twice ? null : { frameId: frame.id, ...p, time: event.timeStamp };
    const drill = !d.label && !d.additive && (twice || picks.length === 1 && picks[0].frameId === frame.id);
    const preview = freshPreview(frame);
    if (!drill || !preview) {
      onPicks(togglePick(picks, { frameId: frame.id, nodeId: null }, d.additive));
      return;
    }
    const controller = new AbortController();
    hitTest.current = controller;
    const selection = JSON.stringify(picks);
    const revision = canvas.revision;
    void resolvePreviewMarkup(preview, controller.signal).then((markup) => pickLayer(markup, preview.viewport, ((p.x - camera.x) / camera.zoom - frame.geometry.x) * preview.viewport.width / frame.geometry.width, ((p.y - camera.y) / camera.zoom - frame.geometry.y) * preview.viewport.height / frame.geometry.height, controller.signal)).then((nodeId) => {
      const latest = current.current.frames.find((f) => f.id === frame.id);
      if (!controller.signal.aborted && current.current.revision === revision && latest && JSON.stringify(current.current.picks) === selection) {
        const valid = nodeId && flattenNodes(latest.content.nodes).some((n) => n.node.id === nodeId);
        onPicks([{ frameId: frame.id, nodeId: valid ? nodeId : null }]);
        if (twice && valid) startText(latest, nodeId);
      }
    }).catch((error) => { if (!controller.signal.aborted) setSelectionError(String(error)); });
  };
  const screen = (box: CanvasGeometry) => ({
    left: camera.x + box.x * camera.zoom, top: camera.y + box.y * camera.zoom,
    width: box.width * camera.zoom, height: box.height * camera.zoom,
  });
  const textOrigin = textEdit && (canvas.frames.find(frame => frame.id === textEdit.frameId)?.geometry ?? textEdit.origin);
  return <div ref={root} role="region" aria-label="Canvas board" tabIndex={0} data-owns-keys data-canvas-selection className="canvas-board relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    style={{ backgroundSize: `${Math.max(6, 24 * camera.zoom)}px ${Math.max(6, 24 * camera.zoom)}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }}
    data-tool={tool === "hand" || space ? "hand" : "select"} data-camera={JSON.stringify(camera)} data-preview-count={stats.cached} data-preview-bytes={stats.bytes} data-captures={stats.captures}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelDrag}
    onLostPointerCapture={() => { if (drag.current) cancelDrag(); }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      hitTest.current?.abort(); setSelectionError(null);
      if (event.key === " ") { event.preventDefault(); setSpace(true); }
      else if (!event.metaKey && !event.ctrlKey && !event.altKey && ["v", "h"].includes(event.key.toLowerCase())) { event.preventDefault(); setTool(event.key.toLowerCase() === "h" ? "hand" : "select"); }
      else if (event.key === "Escape") {
        event.preventDefault();
        if (drag.current) { cancelDrag(); return; }
        if (textEdit) { setTextEdit(null); return; }
        onPicks(picks.some((p) => p.nodeId) ? [...new Set(picks.map((p) => p.frameId))].map((frameId) => ({ frameId, nodeId: null })) : []);
      }
      else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const index = canvas.frames.findIndex((f) => f.id === focusedId);
        const next = event.key === "Home" ? 0 : event.key === "End" ? canvas.frames.length - 1 : Math.max(0, Math.min(canvas.frames.length - 1, index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1)));
        const frame = canvas.frames[next];
        if (frame) { onPicks(togglePick(picks, { frameId: frame.id, nodeId: null }, event.shiftKey)); if (!intersects(frame.geometry, viewport)) setCamera(fitCamera(frame.geometry, size.width, size.height)); }
      } else if (event.key === "Enter") {
        const frame = canvas.frames.find((f) => f.id === focusedId);
        if (frame && picks.length === 1 && picks[0].nodeId && startText(frame, picks[0].nodeId)) { event.preventDefault(); return; }
        if (frame?.content.nodes[0]) onPicks([{ frameId: frame.id, nodeId: frame.content.nodes[0].id }]);
      }
    }} onKeyUp={(event) => { if (event.key === " ") { event.preventDefault(); setSpace(false); } }} onBlur={() => setSpace(false)}>
    <div className="pointer-events-none absolute origin-top-left" style={{ transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})` }}>
      {visible.map((frame) => {
        const geometry = geometryFor(frame);
        const preview = previews.get(frame.id);
        const gesture = painted?.edit;
        const live = preview && gesture && (gesture.kind === "frames" ? gesture.geometry[frame.id]?.width !== undefined : gesture.frameId === frame.id);
        return <div key={frame.id} data-frame-id={frame.id} className="pointer-events-auto absolute overflow-hidden bg-white shadow-(--shadow-ring)" style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }}>
          {preview ? <img alt={frame.name} draggable={false} src={preview.url} className="pointer-events-none block h-full w-full" /> : <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-neutral-500">{errors.get(frame.id) ?? "Rendering preview…"}</div>}
          {live && <GestureFrame key={preview.key} preview={preview} edit={gesture} />}
        </div>;
      })}
    </div>
    {visible.map((frame) => {
      const geometry = geometryFor(frame);
      return <span key={frame.id} data-frame-id={frame.id} data-canvas-frame-label data-selected={picks.some((p) => p.frameId === frame.id)} className="canvas-frame-label absolute inline-flex items-center gap-1.5 text-xs text-muted-foreground" style={{ left: camera.x + geometry.x * camera.zoom, top: camera.y + geometry.y * camera.zoom - 24, maxWidth: Math.max(50, geometry.width * camera.zoom), height: 20 }}>{editing.includes(frame.id) && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}<span className="truncate">{frame.name}</span>{editing.includes(frame.id) && <span role="status" className="shrink-0 text-primary">Agent editing</span>}</span>;
    })}
    {picks.map((pick) => {
      const frame = canvas.frames.find((f) => f.id === pick.frameId);
      if (!frame) return null;
      const geometry = geometryFor(frame);
      const layer = pick.nodeId ? previews.get(frame.id)?.boxes.find((b) => b.id === pick.nodeId) : null;
      const box = painted?.edit.kind === "style" && painted.edit.nodeId === pick.nodeId && painted.outline
        ? painted.outline : layer ? { ...layer, x: geometry.x + layer.x, y: geometry.y + layer.y } : geometry;
      return <div key={`${pick.frameId}:${pick.nodeId}`} className="canvas-selection pointer-events-none absolute border-2 border-accent-mention" style={screen(box)}>
        {canEdit && picks.length === 1 && (!pick.nodeId || layer && freshPreview(frame)) && !textEdit && <span aria-hidden data-frame-id={frame.id} data-canvas-resize className="canvas-resize-handle" />}
      </div>;
    })}
    {painted?.edge && <div aria-hidden className="canvas-insertion" style={screen(painted.edge)} />}
    {textEdit && textOrigin && <InlineCanvasText key={textEdit.nodeId} edit={textEdit} zoom={camera.zoom}
      position={screen({ ...textEdit.box, x: textOrigin.x + textEdit.box.x, y: textOrigin.y + textEdit.box.y })}
      onFinish={async (value) => {
        if (value !== null && value !== textEdit.initial) {
          const saved = await edit?.commit({ kind: "text", frameId: textEdit.frameId, nodeId: textEdit.nodeId, text: value, previous: textEdit.initial }, textEdit.revision);
          if (!saved) return;
        }
        setTextEdit(null);
        root.current?.focus({ preventScroll: true });
      }} onBlur={() => setTextEdit(null)} />}
    {marquee && <div className="pointer-events-none absolute border border-accent-mention bg-accent-mention/10" style={{ left: camera.x + marquee.x * camera.zoom, top: camera.y + marquee.y * camera.zoom, width: marquee.width * camera.zoom, height: marquee.height * camera.zoom }} />}
    {!canvas.frames.length && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><p>Add a frame to start designing</p><Button variant="secondary" size="sm" className="pointer-events-auto" onClick={onNewFrame}><Plus />New frame</Button></div>}
    {selectionError && <p role="alert" className="absolute top-3 left-3 max-w-sm rounded-lg bg-popover px-3 py-2 text-sm text-destructive">{selectionError}</p>}
    <div className="canvas-board-toolbar" onPointerDown={(e) => e.stopPropagation()}>
      <Control label="Select" hint={<Kbd>V</Kbd>} pressed={tool === "select"} onClick={() => setTool("select")}><MousePointer2 /></Control>
      <Control label="Hand" hint={<><Kbd>H</Kbd><span className="ml-1">or Space-drag</span></>} pressed={tool === "hand"} onClick={() => setTool("hand")}><Hand /></Control>
      {edit && <>
        <hr aria-hidden />
        <Control label="New frame" disabled={edit.disabled} onClick={onNewFrame}><Frame /></Control>
        <Control label="Add text" disabled={edit.disabled || !canvas.frames.length} onClick={edit.addText}><Type /></Control>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="size-7" aria-label="Canvas edit actions" disabled={edit.disabled}><Ellipsis /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            <DropdownMenuItem disabled={!edit.canCopy} onSelect={edit.copy}>Copy layers <kbd className="ml-auto text-xs text-muted-foreground">{IS_MAC ? "⌘C" : "Ctrl+C"}</kbd></DropdownMenuItem>
            <DropdownMenuItem onSelect={edit.paste}>Paste layers <kbd className="ml-auto text-xs text-muted-foreground">{IS_MAC ? "⌘V" : "Ctrl+V"}</kbd></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!picks.length} onSelect={edit.duplicate}>Duplicate <ShortcutKeys ids={["canvas.duplicate"]} className="ml-auto" /></DropdownMenuItem>
            <DropdownMenuItem disabled={!picks.length} onSelect={edit.remove}>Delete selection</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>}
      <hr aria-hidden />
      <Control label="Zoom out" onClick={() => setCamera(zoomCamera(camera, 0.8, size.width / 2, size.height / 2))}><Minus /></Control>
      <Tooltip><TooltipTrigger asChild><button type="button" aria-label={`Zoom ${Math.round(camera.zoom * 100)}%, reset to 100%`} className="min-w-12 rounded-md px-1 text-xs tabular-nums focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setCamera(zoomCamera(camera, 1 / camera.zoom, size.width / 2, size.height / 2))}>{Math.round(camera.zoom * 100)}%</button></TooltipTrigger><TooltipContent>Zoom to 100%<ShortcutKeys ids={["canvas.actualSize"]} /></TooltipContent></Tooltip>
      <Control label="Zoom in" onClick={() => setCamera(zoomCamera(camera, 1.25, size.width / 2, size.height / 2))}><Plus /></Control>
      <hr aria-hidden />
      <Control label="Fit all" shortcut="canvas.fitAll" onClick={() => fit()}><Maximize /></Control>
      <Control label="Fit selection" shortcut="canvas.fitSelection" disabled={!picks.length} onClick={() => fit(true)}><Scan /></Control>
    </div>
  </div>;
}

function InlineCanvasText({ edit, position, zoom, onFinish, onBlur }: {
  edit: TextEdit;
  position: { left: number; top: number; width: number; height: number };
  zoom: number;
  onFinish(value: string | null): Promise<void>;
  onBlur(): void;
}) {
  const [text, setText] = useState(edit.initial);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { input.current?.focus({ preventScroll: true }); input.current?.select(); }, []);
  const styles = edit.box.styles;
  return <textarea ref={input} aria-label="Edit layer text" className="canvas-inline-text" value={text} spellCheck={false}
    style={{ ...position, width: Math.max(120, position.width + 12), minHeight: Math.max(28, position.height + 8), fontFamily: styles["font-family"], fontWeight: styles["font-weight"], fontSize: Math.max(12, (parseFloat(styles["font-size"]) || 16) * zoom) }}
    onChange={(event) => setText(event.target.value)} readOnly={saving} onBlur={() => { if (!saving && text === edit.initial) onBlur(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || saving) return;
      if (event.key === "Escape" || event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") void onFinish(null);
        else {
          setSaving(true);
          void onFinish(text).finally(() => setSaving(false));
        }
      }
    }} />;
}

function Control({ label, shortcut, hint, children, onClick, pressed, disabled }: { label: string; shortcut?: ShortcutId; hint?: ReactNode; children: ReactNode; onClick(): void; pressed?: boolean; disabled?: boolean }) {
  return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={cn("size-7", pressed && "bg-muted text-foreground")}>{children}</Button></TooltipTrigger><TooltipContent>{label}{hint && <span className="ml-2 inline-flex items-center gap-1">{hint}</span>}{shortcut && <ShortcutKeys ids={[shortcut]} />}</TooltipContent></Tooltip>;
}
