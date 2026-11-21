import { useContext, useRef, useState, type PointerEvent } from "react";
import { ArrowUp } from "lucide-react";
import { CanvasCommentTarget } from "@/lib/canvasChat";
import type { Tool, View } from "./CanvasBoard";
import type { Change } from "./CanvasTheme";
import { uid, type CommentPin, type InkPoint, type Page } from "./document";

const ink = "#168bf0";

async function snapshot(board: HTMLElement, view: View, page: Page, pin: CommentPin) {
  const { default: render } = await import("html2canvas-pro");
  if (!board.isConnected) throw Error("Reopen the canvas to send this comment.");
  const width = Math.min(800, board.clientWidth),
    height = Math.min(600, board.clientHeight);
  const px = view.x + pin.x * view.zoom,
    py = view.y + pin.y * view.zoom;
  const x = Math.max(0, Math.min(board.clientWidth - width, px - width / 2));
  const y = Math.max(0, Math.min(board.clientHeight - height, py - height / 2));
  const background = await render(board, {
    x,
    y,
    width,
    height,
    scale: 1,
    logging: false,
    backgroundColor: null,
    ignoreElements: (el) => el.matches(".ce-markup, .ce-selection, .ce-frame-label"),
  });
  const image = document.createElement("canvas");
  image.width = background.width;
  image.height = background.height;
  const ctx = image.getContext("2d");
  if (!ctx) throw Error("Could not capture this part of the canvas.");
  ctx.drawImage(background, 0, 0);
  ctx.translate(view.x - x, view.y - y);
  ctx.scale(view.zoom, view.zoom);
  ctx.fillStyle = ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.lineCap = ctx.lineJoin = "round";
  for (const { points } of page.strokes ?? []) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points) ctx.lineTo(...point);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(...points[0], 1.5, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(pin.x, pin.y, 5 / view.zoom, 0, 2 * Math.PI);
  ctx.fill();
  ctx.strokeStyle = "white";
  ctx.lineWidth = 1.5 / view.zoom;
  ctx.stroke();
  return image.toDataURL("image/png").split(",")[1];
}

export function CanvasMarkup({
  page,
  view,
  tool,
  change,
}: {
  page: Page;
  view: View;
  tool: Tool;
  change: Change;
}) {
  const target = useContext(CanvasCommentTarget);
  const overlay = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ pointer: number; points: InkPoint[] } | null>(null);
  const [points, setPoints] = useState<InkPoint[]>([]);
  const [pin, setPin] = useState<CommentPin | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const saved = pin && page.comments?.some((p) => p.id === pin.id);
  const drawingTool = tool === "Pen" || tool === "Comment";
  function position(e: { clientX: number; clientY: number }): InkPoint {
    const r = overlay.current!.getBoundingClientRect();
    return [(e.clientX - r.left - view.x) / view.zoom, (e.clientY - r.top - view.y) / view.zoom];
  }
  function down(e: PointerEvent<HTMLDivElement>) {
    if (!drawingTool || e.button !== 0 || !e.isPrimary) return;
    e.stopPropagation();
    if (locked.current) return;
    const point = position(e);
    if (tool === "Comment") {
      setError("");
      setPin({ id: uid(), x: point[0], y: point[1], text: "" });
      return;
    }
    setPin(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { pointer: e.pointerId, points: [point] };
    setPoints([point]);
  }
  function sample(e: PointerEvent) {
    const stroke = drawing.current;
    if (!stroke || stroke.pointer !== e.pointerId) return;
    for (const event of [...(e.nativeEvent.getCoalescedEvents?.() ?? []), e]) {
      const point = position(event);
      const last = stroke.points[stroke.points.length - 1];
      if (last[0] !== point[0] || last[1] !== point[1]) stroke.points.push(point);
    }
    return stroke.points;
  }
  function clear() {
    drawing.current = null;
    setPoints([]);
  }
  function up(e: PointerEvent) {
    const sampled = sample(e);
    if (!sampled) return;
    const stroke = { id: uid(), points: sampled };
    change((d) => ({
      ...d,
      pages: d.pages.map((p) => (p.id === page.id ? { ...p, strokes: [...(p.strokes ?? []), stroke] } : p)),
    }));
    clear();
  }
  async function send() {
    const board = overlay.current?.parentElement;
    if (!pin || !pin.text.trim() || locked.current || !target || !board) return;
    const sent = { ...pin, text: pin.text.trim() };
    locked.current = true;
    setSending(true);
    setError("");
    try {
      await target.send(
        sent.text + "\n\nPage: " + page.name + " (" + Math.round(sent.x) + ", " + Math.round(sent.y) + ")",
        () => snapshot(board, view, page, sent),
      );
      change((d) => ({
        ...d,
        pages: d.pages.map((p) => (p.id === page.id ? { ...p, comments: [...(p.comments ?? []), sent] } : p)),
      }));
      setPin(null);
    } catch (e) {
      setError(String(e));
    } finally {
      locked.current = false;
      setSending(false);
    }
  }
  const markers = [...(page.comments ?? []), ...(pin && !saved ? [pin] : [])];
  const left = (x: number) => view.x + view.zoom * x;
  const top = (y: number) => view.y + view.zoom * y;
  return (
    <div
      ref={overlay}
      className="ce-markup"
      data-drawing={drawingTool}
      onPointerDown={down}
      onPointerMove={(e) => {
        const sampled = sample(e);
        if (sampled) setPoints([...sampled]);
      }}
      onPointerUp={up}
      onPointerCancel={clear}
      onLostPointerCapture={clear}
    >
      <svg className="ce-ink" aria-hidden="true">
        <g
          transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}
          fill={ink}
          stroke={ink}
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {[...(page.strokes ?? []), ...(points.length ? [{ id: "drawing", points }] : [])].map((s) =>
            s.points.length === 1 ? (
              <circle key={s.id} cx={s.points[0][0]} cy={s.points[0][1]} r={1.5} stroke="none" />
            ) : (
              <polyline key={s.id} points={s.points.join(" ")} fill="none" />
            ),
          )}
        </g>
      </svg>
      {markers.map((p, i) => (
        <button
          key={p.id}
          type="button"
          className="ce-comment-pin"
          aria-label={`Comment ${i + 1}: ${p.text || "New comment"}`}
          style={{ left: left(p.x), top: top(p.y) }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (!locked.current) {
              setPin(pin?.id === p.id ? null : p);
              setError("");
            }
          }}
        >
          {i + 1}
        </button>
      ))}
      {pin && (
        <form
          className="ce-comment-box"
          aria-label="Canvas comment"
          onPointerDown={(e) => e.stopPropagation()}
          style={{
            left: `clamp(4px, ${left(pin.x) + 37}px, 100% - min(290px, 100% - 8px) - 4px)`,
            top: `clamp(4px, ${top(pin.y) - 31}px, 100% - 72px)`,
          }}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !sending) {
              e.stopPropagation();
              setPin(null);
            }
          }}
        >
          {saved ? (
            <p>{pin.text}</p>
          ) : (
            <>
              <input
                key={pin.id}
                autoFocus
                placeholder="Add a comment"
                aria-label="Add a comment"
                value={pin.text}
                readOnly={sending}
                onChange={(e) => setPin({ ...pin, text: e.target.value })}
              />
              <button
                type="submit"
                disabled={!pin.text.trim() || sending || !target}
                aria-label={`Send to ${target?.title ?? "conversation"}`}
              >
                <ArrowUp size={16} />
              </button>
              {target && <small>To {target.title}</small>}
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </div>
  );
}
