import { useCanvasWindowPart } from "@/lib/canvasWindow";
import { useContext, useRef, useState, type PointerEvent } from "react";
import { ArrowUp } from "lucide-react";
import { CanvasCommentTarget } from "@/lib/canvasChat";
import type { Tool, View } from "./CanvasBoard";
import type { CanvasSession } from "./useCanvasDocument";
import { uid, type CommentPin, type InkPoint, type Page } from "./document";

const ink = "#168bf0";

async function snapshot(overlay: HTMLElement, view: View, page: Page, pin: CommentPin) {
  const { default: render } = await import("html2canvas-pro");
  const board = overlay.parentElement;
  if (!overlay.isConnected || !board) throw Error("Reopen the canvas to send this comment.");
  const width = Math.min(800, board.clientWidth),
    height = Math.min(600, board.clientHeight);
  const x = width / 2 - pin.x * view.zoom;
  const y = height / 2 - pin.y * view.zoom;
  const background = await render(board, {
    onclone: (_, clone) => {
      const world = clone.querySelector<HTMLElement>(".ce-world");
      if (world) world.style.transform = `translate(${x}px, ${y}px) scale(${view.zoom})`;
    },
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
  ctx.translate(x, y);
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
  session,
}: {
  page: Page;
  view: View;
  tool: Tool;
  session: CanvasSession;
}) {
  const target = useContext(CanvasCommentTarget);
  const overlay = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ pointer: number; points: InkPoint[] } | null>(null);
  const [points, setPoints] = useState<InkPoint[]>([]);
  const [selection, setPin] = useState<CommentPin | string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const saved = typeof selection === "string";
  const pin = saved ? page.comments?.find(p => p.id === selection) : selection;
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
    session.change((d) => ({
      ...d,
      pages: d.pages.map((p) => (p.id === page.id ? { ...p, strokes: [...(p.strokes ?? []), stroke] } : p)),
    }));
    clear();
  }
  useCanvasWindowPart("markup", async ({command}) => {
    if (command.group !== "comment") throw Error("Unknown comment action.");
    const pin = page.comments?.find(p => p.id === command.args.id);
    if (!pin || !target || !overlay.current) throw Error("Open the page containing this comment.");
    if (locked.current) throw Error("A comment is already being sent.");
    if (!pin.text.trim()) throw Error("Enter comment text before sending.");
    await deliver(pin, true);
  });
  async function deliver(pin: CommentPin, alreadySaved = false) {
    const markup = overlay.current;
    if (!pin.text.trim() || locked.current || !target || !markup) throw Error("Comment is unavailable.");
    const sent = { ...pin, text: pin.text.trim() };
    locked.current = true;
    setSending(true);
    setError("");
    try {
      const send = () => target.send(
        sent.text + "\n\nPage: " + page.name + " (" + Math.round(sent.x) + ", " + Math.round(sent.y) + ")",
        () => snapshot(markup, view, page, sent),
      );
      if (alreadySaved) await send();
      else await session.sendComment(page.id, sent, send);
      setPin(null);
    } catch (e) {
      setError(String(e));
      throw e;
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
              setPin(pin?.id === p.id ? null : p.id);
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
            if (!saved) void deliver(pin).catch(() => {});
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
