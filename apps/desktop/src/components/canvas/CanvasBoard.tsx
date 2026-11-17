import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Hand, Maximize, Minus, MousePointer2, Plus, Scan } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import ShortcutKeys from "@/components/ShortcutKeys";
import { Kbd } from "@/components/ui/kbd";
import { useHotkey } from "@/hooks/useHotkey";
import { bounds, fitCamera, intersects, pickLayer, togglePick, zoomCamera, type CanvasPick, type FramePreview } from "@/lib/canvasBoard";
import { cn } from "@/lib/utils";
import type { Canvas, CanvasCamera, CanvasGeometry } from "@/types/events";
import type { ShortcutId } from "@/lib/shortcuts";
import { readLocalStorage, writeLocalStorage } from "@/hooks/useLocalStorage";

export default function CanvasBoard({ canvas, active, picks, onPicks, previews, errors, onVisible, onNewFrame, stats }: {
  canvas: Canvas; active: boolean; picks: CanvasPick[]; onPicks(picks: CanvasPick[]): void;
  previews: Map<string, FramePreview>; errors: Map<string, string>; onVisible(ids: string[]): void; onNewFrame(): void;
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
  const [tool, setTool] = useState<"select" | "hand">("select");
  const [space, setSpace] = useState(false);
  const [marquee, setMarquee] = useState<CanvasGeometry | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; camera: CanvasCamera; pan: boolean; moved: boolean; additive: boolean; picks: CanvasPick[]; target: string | null } | null>(null);
  const current = useRef({ camera, picks, tool, space });
  current.current = { camera, picks, tool, space };
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
  const previousCount = useRef(canvas.frames.length);
  useLayoutEffect(() => {
    if (canvas.frames.length > previousCount.current && size.width && size.height) setCamera(fitCamera(frameBounds, size.width, size.height));
    previousCount.current = canvas.frames.length;
  }, [canvas.frames.length, frameBounds, size]);
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
    const blur = () => { setSpace(false); drag.current = null; setMarquee(null); };
    window.addEventListener("blur", blur);
    return () => { node.removeEventListener("wheel", wheel); window.removeEventListener("blur", blur); cancelAnimationFrame(raf); };
  }, [active]);
  const viewport = { x: (-camera.x - 80) / camera.zoom, y: (-camera.y - 80) / camera.zoom, width: (size.width + 160) / camera.zoom, height: (size.height + 160) / camera.zoom };
  const visible = canvas.frames.filter((f) => intersects(f.geometry, viewport));
  const focusedId = picks.at(-1)?.frameId;
  const visibleKey = [focusedId, ...visible.map((f) => f.id)].filter((id, i, all) => id && all.indexOf(id) === i).join(",");
  useEffect(() => onVisible(visibleKey.split(",").filter(Boolean)), [visibleKey, onVisible]);
  useHotkey("canvas.fitAll", () => fit(), { enabled: active, skipInTextField: true });
  useHotkey("canvas.fitSelection", () => fit(true), { enabled: active && picks.length > 0, skipInTextField: true });
  useHotkey("canvas.actualSize", () => setCamera(zoomCamera(camera, 1 / camera.zoom, size.width / 2, size.height / 2)), { enabled: active, skipInTextField: true });
  const point = (event: PointerEvent) => { const rect = root.current!.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("button") || !event.isPrimary || ![0, 1].includes(event.button)) return;
    root.current?.focus();
    const p = point(event);
    const target = (event.target as Element).closest<HTMLElement>("[data-frame-id]")?.dataset.frameId ?? null;
    drag.current = { id: event.pointerId, ...p, camera, pan: event.button === 1 || tool === "hand" || space, moved: false, additive: event.shiftKey, picks, target };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const p = point(event), dx = p.x - d.x, dy = p.y - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.pan) { setCamera({ ...d.camera, x: d.camera.x + dx, y: d.camera.y + dy }); return; }
    const box = { x: (Math.min(d.x, p.x) - d.camera.x) / d.camera.zoom, y: (Math.min(d.y, p.y) - d.camera.y) / d.camera.zoom, width: Math.abs(dx) / d.camera.zoom, height: Math.abs(dy) / d.camera.zoom };
    setMarquee(box);
    const selected = canvas.frames.filter((f) => intersects(f.geometry, box)).map((f) => ({ frameId: f.id, nodeId: null }));
    onPicks(d.additive ? [...d.picks, ...selected.filter((p) => !d.picks.some((s) => s.frameId === p.frameId && !s.nodeId))] : selected);
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null; setMarquee(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (d.pan || d.moved) return;
    if (!d.target) { if (!d.additive) onPicks([]); return; }
    const frame = canvas.frames.find((f) => f.id === d.target)!;
    const p = point(event);
    const drill = !d.additive && picks.length === 1 && picks[0].frameId === frame.id;
    const nodeId = drill ? pickLayer(previews.get(frame.id)?.boxes ?? [], (p.x - camera.x) / camera.zoom - frame.geometry.x, (p.y - camera.y) / camera.zoom - frame.geometry.y) : null;
    onPicks(togglePick(picks, { frameId: frame.id, nodeId }, d.additive));
  };
  return <div ref={root} role="region" aria-label="Canvas board" tabIndex={0} className={cn("canvas-board relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", (tool === "hand" || space) && "cursor-grab")}
    style={{ backgroundSize: `${Math.max(6, 24 * camera.zoom)}px ${Math.max(6, 24 * camera.zoom)}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }}
    data-camera={JSON.stringify(camera)} data-preview-count={stats.cached} data-preview-bytes={stats.bytes} data-captures={stats.captures}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setMarquee(null); }} onLostPointerCapture={() => { drag.current = null; setMarquee(null); }}
    onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === " ") { event.preventDefault(); setSpace(true); }
      else if (event.key === "v" || event.key === "h") setTool(event.key === "h" ? "hand" : "select");
      else if (event.key === "Escape") { event.preventDefault(); onPicks(picks.some((p) => p.nodeId) ? picks.map((p) => ({ ...p, nodeId: null })) : []); }
      else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const index = canvas.frames.findIndex((f) => f.id === focusedId);
        const next = event.key === "Home" ? 0 : event.key === "End" ? canvas.frames.length - 1 : Math.max(0, Math.min(canvas.frames.length - 1, index + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1)));
        const frame = canvas.frames[next];
        if (frame) { onPicks(togglePick(picks, { frameId: frame.id, nodeId: null }, event.shiftKey)); if (!intersects(frame.geometry, viewport)) setCamera(fitCamera(frame.geometry, size.width, size.height)); }
      } else if (event.key === "Enter") {
        const frame = canvas.frames.find((f) => f.id === focusedId);
        if (frame?.content.nodes[0]) onPicks([{ frameId: frame.id, nodeId: frame.content.nodes[0].id }]);
      }
    }} onKeyUp={(event) => { if (event.key === " ") { event.preventDefault(); setSpace(false); } }} onBlur={() => setSpace(false)}>
    <div className="pointer-events-none absolute origin-top-left" style={{ transform: `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})` }}>
      {visible.map((frame) => <div key={frame.id} data-frame-id={frame.id} className="pointer-events-auto absolute bg-white shadow-(--shadow-ring)" style={{ left: frame.geometry.x, top: frame.geometry.y, width: frame.geometry.width, height: frame.geometry.height }}>
        {previews.get(frame.id) ? <img alt={frame.name} draggable={false} src={previews.get(frame.id)!.url} className="pointer-events-none block h-full w-full" /> : <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-neutral-500">{errors.get(frame.id) ?? "Rendering preview…"}</div>}
      </div>)}
    </div>
    {visible.map((frame) => <span key={frame.id} data-frame-id={frame.id} data-selected={picks.some((p) => p.frameId === frame.id)} className="canvas-frame-label pointer-events-none absolute truncate text-xs text-muted-foreground" style={{ left: camera.x + frame.geometry.x * camera.zoom, top: camera.y + frame.geometry.y * camera.zoom - 24, maxWidth: Math.max(50, frame.geometry.width * camera.zoom), height: 20 }}>{frame.name}</span>)}
    {picks.map((pick) => { const frame = canvas.frames.find((f) => f.id === pick.frameId); if (!frame) return null; const layer = pick.nodeId ? previews.get(frame.id)?.boxes.find((b) => b.id === pick.nodeId) : null; const box = layer ? { ...layer, x: frame.geometry.x + layer.x, y: frame.geometry.y + layer.y } : frame.geometry; return <div key={`${pick.frameId}:${pick.nodeId}`} className="canvas-selection pointer-events-none absolute border-2 border-accent-mention" style={{ left: camera.x + box.x * camera.zoom, top: camera.y + box.y * camera.zoom, width: box.width * camera.zoom, height: box.height * camera.zoom }} />; })}
    {marquee && <div className="pointer-events-none absolute border border-accent-mention bg-accent-mention/10" style={{ left: camera.x + marquee.x * camera.zoom, top: camera.y + marquee.y * camera.zoom, width: marquee.width * camera.zoom, height: marquee.height * camera.zoom }} />}
    {!canvas.frames.length && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground"><p>Add a frame to start designing</p><Button variant="secondary" size="sm" className="pointer-events-auto" onClick={onNewFrame}><Plus />New frame</Button></div>}
    <div className="canvas-board-toolbar" onPointerDown={(e) => e.stopPropagation()}>
      <Control label="Select" hint={<Kbd>V</Kbd>} pressed={tool === "select"} onClick={() => setTool("select")}><MousePointer2 /></Control>
      <Control label="Hand" hint={<><Kbd>H</Kbd><span className="ml-1">or Space-drag</span></>} pressed={tool === "hand"} onClick={() => setTool("hand")}><Hand /></Control>
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

function Control({ label, shortcut, hint, children, onClick, pressed, disabled }: { label: string; shortcut?: ShortcutId; hint?: ReactNode; children: ReactNode; onClick(): void; pressed?: boolean; disabled?: boolean }) {
  return <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={cn("size-7", pressed && "bg-muted text-foreground")}>{children}</Button></TooltipTrigger><TooltipContent>{label}{hint && <span className="ml-2 inline-flex items-center gap-1">{hint}</span>}{shortcut && <ShortcutKeys ids={[shortcut]} />}</TooltipContent></Tooltip>;
}
