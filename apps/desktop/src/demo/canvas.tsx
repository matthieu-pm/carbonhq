import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import ReactDOM from "react-dom/client";
import {
  ArrowLeft, ArrowRight, ArrowUp, Camera, Check, CircleDot, Crosshair, Frame, Globe, Maximize, Minus, MousePointer2,
  PanelRight, Pencil, Play, Plus, RotateCw, Smartphone, Square, Terminal, Type, X,
} from "lucide-react";

import { FilesGlyph18, House3Glyph18 } from "@/components/icons/nucleo";
import AppShell from "@/components/layout/AppShell";
import { RAIL_W } from "@/components/layout/Rail";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import { cn } from "@/lib/utils";
import "../App.css";

Object.assign(window, { __TAURI_INTERNALS__: {
  invoke: async (command: string) => (command.startsWith("plugin:event|") ? 1 : null),
} });

type Variant = "a" | "b" | "c";
type CanvasFrame = { id: string; name: string; variant: Variant; note: string; x: number };
type Pick = { frame: string; layer: string | null };
type Chip = { key: string; label: string; element: boolean; variant: Variant | null };
type Message =
  | { role: "user"; text: string; chips: Chip[] }
  | { role: "tool"; icon: "terminal" | "edit" | "camera"; text: string }
  | { role: "agent"; text: string };
type Box = { left: number; top: number; width: number; height: number };

const FRAME_W = 390;
const FRAME_H = 720;
const FRAME_GAP = 80;
const PREVIEW = "preview";

const LAYERS: Record<Variant, string[]> = {
  a: ["Header", "Items", "Promo code", "Totals", "Payment", "Pay button"],
  b: ["Header", "Summary", "Payment", "Pay button"],
  c: ["Header", "Express pay", "Summary", "Payment", "Pay button"],
};

// The frames are the reader's product, not Carbon's chrome, so they carry a
// palette of their own that no theme here reaches.
const PRODUCT = {
  "--brand": "#4f46e5", "--ink": "#111827", "--sub": "#6b7280", "--line": "#e5e7eb", "--surface": "#ffffff",
  "--soft": "#f4f4f6", "--radius-md": "12px",
  fontFamily: "Inter, system-ui, sans-serif", color: "var(--ink)", background: "var(--surface)", fontSize: 15, lineHeight: 1.4,
} as CSSProperties;
const TOKENS: [string, string][] = [["--brand", "#4f46e5"], ["--ink", "#111827"], ["--soft", "#f4f4f6"], ["--line", "#e5e7eb"], ["--radius-md", "12px"]];
const ITEMS: [string, string, string, string][] = [["Linen overshirt", "Sand · M", "€89", "#d6c7b0"], ["Canvas tote", "Natural", "€32", "#b9c4b1"]];

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: strong ? 600 : 400, color: strong ? "var(--ink)" : "var(--sub)", fontSize: strong ? 17 : 15 }}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

/// A stand-in checkout screen, drawn three ways. Each section names itself in
/// `data-layer`, which is what the canvas, the layers list and Inspect select by.
function Checkout({ variant }: { variant: Variant }) {
  const card: CSSProperties = { border: "1px solid var(--line)", borderRadius: "var(--radius-md)", padding: 16 };
  const header = (
    <div data-layer="Header" style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 20px 12px" }}>
      <ArrowLeft size={20} />
      <span style={{ fontSize: 20, fontWeight: 600 }}>Checkout</span>
      {variant !== "a" && <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--sub)" }}>Step 2 of 2</span>}
    </div>
  );
  const pay = (
    <div data-layer="Pay button" style={{
      margin: "auto 20px 24px", height: 52, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 600,
      background: variant === "b" ? "var(--ink)" : "var(--brand)", borderRadius: variant === "a" ? "var(--radius-md)" : 26,
    }}>Pay €125</div>
  );
  if (variant === "a") {
    return (
      <div style={{ ...PRODUCT, width: FRAME_W, height: FRAME_H, display: "flex", flexDirection: "column" }}>
        {header}
        <div data-layer="Items" style={{ ...card, margin: "8px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
          {ITEMS.map(([name, detail, price, swatch]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 52, height: 52, borderRadius: 8, background: swatch }} />
              <div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{name}</div><div style={{ color: "var(--sub)", fontSize: 13 }}>{detail}</div></div>
              <span style={{ fontWeight: 500 }}>{price}</span>
            </div>
          ))}
        </div>
        <div data-layer="Promo code" style={{ ...card, margin: "8px 20px", display: "flex", justifyContent: "space-between", color: "var(--sub)" }}>
          <span>Promo code</span><span style={{ color: "var(--brand)", fontWeight: 500 }}>Apply</span>
        </div>
        <div data-layer="Totals" style={{ ...card, margin: "8px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
          <Row label="Subtotal" value="€121" /><Row label="Shipping" value="€4" /><Row label="Total" value="€125" strong />
        </div>
        <div data-layer="Payment" style={{ ...card, margin: "8px 20px", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 40, height: 26, borderRadius: 5, background: "var(--ink)" }} />
          <div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>Visa ending 4242</div><div style={{ color: "var(--sub)", fontSize: 13 }}>Expires 08/28</div></div>
          <span style={{ color: "var(--brand)", fontWeight: 500 }}>Change</span>
        </div>
        {pay}
      </div>
    );
  }
  return (
    <div style={{ ...PRODUCT, width: FRAME_W, height: FRAME_H, display: "flex", flexDirection: "column" }}>
      {header}
      {variant === "c" && (
        <div data-layer="Express pay" style={{ margin: "8px 20px 4px", height: 48, borderRadius: 24, background: "var(--ink)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>
          Pay with Apple Pay
        </div>
      )}
      <div data-layer="Summary" style={{ margin: "12px 20px", padding: 20, borderRadius: 20, background: "var(--soft)" }}>
        <div style={{ color: "var(--sub)", fontSize: 13 }}>2 items · ships in 2 days</div>
        <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.02em", margin: "4px 0 14px" }}>€125</div>
        <div style={{ display: "flex", gap: 8 }}>
          {ITEMS.map(([name, , , swatch]) => <div key={name} style={{ width: 44, height: 44, borderRadius: 10, background: swatch }} />)}
          <span style={{ marginLeft: "auto", alignSelf: "center", color: "var(--brand)", fontWeight: 500 }}>View order</span>
        </div>
      </div>
      <div data-layer="Payment" style={{ margin: "8px 20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {["Visa ·· 4242", "Add a card"].map((label, i) => (
          <div key={label} style={{ padding: 16, borderRadius: "var(--radius-md)", border: i === 0 ? "2px solid var(--brand)" : "1px solid var(--line)", fontWeight: 500, color: i === 0 ? "var(--ink)" : "var(--sub)" }}>
            <div style={{ width: 32, height: 20, borderRadius: 4, background: i === 0 ? "var(--ink)" : "var(--line)", marginBottom: 20 }} />
            {label}
          </div>
        ))}
      </div>
      {pay}
    </div>
  );
}

/// Where a picked frame or layer sits inside `root`, in `root`'s own pixels,
/// so the outline is drawn outside the zoomed layer and keeps a constant weight.
function measure(root: HTMLElement | null, pick: Pick | null): Box | null {
  if (!root || !pick) return null;
  const frame = root.querySelector<HTMLElement>(`[data-frame="${pick.frame}"]`);
  const target = pick.layer ? frame?.querySelector<HTMLElement>(`[data-layer="${pick.layer}"]`) : frame;
  if (!target) return null;
  const outer = root.getBoundingClientRect();
  const inner = target.getBoundingClientRect();
  return { left: inner.left - outer.left, top: inner.top - outer.top, width: inner.width, height: inner.height };
}

function Outline({ box, label, dashed, children }: { box: Box; label?: string; dashed?: boolean; children?: ReactNode }) {
  return (
    <div className={cn("pointer-events-none absolute border-accent-mention", dashed ? "border border-dashed" : "border-2")} style={box}>
      {label && <span className="absolute -top-5 left-0 rounded-sm bg-accent-mention px-1 text-[10px] leading-4 font-medium whitespace-nowrap text-background">{label}</span>}
      {children}
    </div>
  );
}

function IconButton({ label, keys, active, disabled, onClick, children }: { label: string; keys?: string; active?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} aria-pressed={active} aria-disabled={disabled} onClick={disabled ? undefined : onClick}
          className={cn("size-7 text-muted-foreground", active && "bg-muted text-foreground", disabled && "opacity-40")}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}{keys && <span className="ml-2 text-muted-foreground">{keys}</span>}</TooltipContent>
    </Tooltip>
  );
}

function ChipTag({ chip, onRemove }: { chip: Chip; onRemove?: () => void }) {
  const Glyph = chip.element ? Crosshair : Frame;
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-accent-mention/15 px-1.5 py-0.5 text-xs font-medium text-accent-mention">
      <Glyph className="size-3" />{chip.label}
      {onRemove && <button type="button" aria-label={`Remove ${chip.label}`} onClick={onRemove} className="cursor-pointer opacity-70 hover:opacity-100"><X className="size-3" /></button>}
    </span>
  );
}

const FIRST_CHIP: Chip = { key: "checkout", label: "Checkout", element: false, variant: "a" };
const OPENING: Message[] = [
  { role: "user", text: "Explore a calmer layout for this. Fewer boxes, one clear action.", chips: [FIRST_CHIP] },
  { role: "tool", icon: "terminal", text: "carbon canvas get checkout --jsx" },
  { role: "tool", icon: "terminal", text: "carbon canvas write variant-b" },
  { role: "agent", text: "Variant B is on the canvas beside the original. It folds the items into one summary, turns the payment methods into two tiles and keeps your --brand and --radius-md tokens." },
];
const TOOL_ICONS = { terminal: Terminal, edit: Pencil, camera: Camera };

function Demo() {
  const [frames, setFrames] = useState<CanvasFrame[]>([
    { id: "checkout", name: "Checkout", variant: "a", note: "Captured from /checkout", x: 0 },
    { id: "variant-b", name: "Variant B", variant: "b", note: "Made by the agent", x: FRAME_W + FRAME_GAP },
  ]);
  const [view, setView] = useState({ x: 60, y: 80, k: 0.6 });
  const [pick, setPick] = useState<Pick | null>({ frame: "variant-b", layer: null });
  const [box, setBox] = useState<Box | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [tab, setTab] = useState<"chat" | "preview" | "properties">("chat");
  const [running, setRunning] = useState(true);
  const [live, setLive] = useState<Variant>("a");
  const [mode, setMode] = useState<"navigate" | "inspect">("navigate");
  const [hover, setHover] = useState<Box | null>(null);
  const [hoverLayer, setHoverLayer] = useState<string | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>(OPENING);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [published, setPublished] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const previewPage = useRef<HTMLDivElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const fit = useCallback((count: number) => {
    const el = stage.current;
    if (!el) return;
    const width = count * FRAME_W + (count - 1) * FRAME_GAP;
    const k = Math.min((el.clientWidth - 64) / width, (el.clientHeight - 150) / FRAME_H, 1);
    setView({ k, x: (el.clientWidth - width * k) / 2, y: (el.clientHeight - FRAME_H * k) / 2 + 8 });
  }, []);
  useLayoutEffect(() => fit(frames.length), [fit, frames.length, panelOpen]);
  useLayoutEffect(() => setBox(measure(stage.current, pick)), [pick, view, frames]);
  useEffect(() => { transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); }, [messages, working]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // React registers wheel listeners as passive, and a passive one cannot stop
  // the page from zooming under a pinch.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setView((v) => {
        if (!e.ctrlKey && !e.metaKey) return { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
        const k = Math.min(2, Math.max(0.2, v.k * Math.exp(-e.deltaY * 0.01)));
        const px = e.clientX - rect.left, py = e.clientY - rect.top;
        return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const nameOf = (id: string) => frames.find((frame) => frame.id === id)?.name ?? id;
  const addToChat = useCallback((chip: Chip) => {
    setChips((prev) => (prev.some((c) => c.key === chip.key) ? prev : [...prev, chip]));
    setPanelOpen(true);
    setTab("chat");
  }, []);
  const addPick = useCallback(() => {
    if (!pick) return;
    const frame = frames.find((f) => f.id === pick.frame);
    if (!frame) return;
    addToChat({ key: `${pick.frame}/${pick.layer ?? ""}`, label: pick.layer ? `${frame.name} › ${pick.layer}` : frame.name, element: false, variant: frame.variant });
  }, [pick, frames, addToChat]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") { e.preventDefault(); addPick(); }
      if (e.key === "Escape") setMode("navigate");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addPick]);

  const zoom = (factor: number) => setView((v) => {
    const el = stage.current!;
    const k = Math.min(2, Math.max(0.2, v.k * factor));
    const px = el.clientWidth / 2, py = el.clientHeight / 2;
    return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
  });

  const onStageDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button")) return;
    const frame = target.closest<HTMLElement>("[data-frame]")?.dataset.frame;
    if (!frame) {
      setPick(null);
      drag.current = { x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    // The first click takes the frame and the next one reaches into it.
    const layer = pick?.frame === frame ? target.closest<HTMLElement>("[data-layer]")?.dataset.layer ?? null : null;
    setPick({ frame, layer });
  };
  const onStageMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const capture = () => {
    const n = frames.filter((f) => f.id.startsWith("capture")).length + 1;
    const id = `capture-${n}`;
    setFrames((prev) => [...prev, { id, name: n === 1 ? "Checkout, live" : `Checkout, live ${n}`, variant: live, note: "Captured from /checkout", x: prev.length * (FRAME_W + FRAME_GAP) }]);
    setPick({ frame: id, layer: null });
    setNotice("Added to canvas");
  };

  const send = () => {
    if (working || (!draft.trim() && chips.length === 0)) return;
    const sent = chips;
    setMessages((prev) => [...prev, { role: "user", text: draft.trim() || "Apply this design to the checkout page.", chips: sent }]);
    setDraft("");
    setChips([]);
    setWorking(true);
    const design = sent.find((chip) => !chip.element && chip.variant);
    window.setTimeout(() => {
      if (design?.variant) {
        setLive(design.variant);
        setMessages((prev) => [...prev,
          { role: "tool", icon: "terminal", text: `carbon canvas get ${design.key.split("/")[0]} --jsx` },
          { role: "tool", icon: "edit", text: "Edit src/app/checkout/page.tsx" },
          { role: "tool", icon: "camera", text: "carbon browser screenshot /checkout" },
          { role: "agent", text: "Built it in page.tsx, reusing OrderSummary and Button with your own tokens. The Preview shows the result. Nothing is committed yet." },
        ]);
        setTab("preview");
      } else {
        const id = `variant-${frames.length + 1}`;
        setFrames((prev) => [...prev, { id, name: "Variant C", variant: "c", note: "Made by the agent", x: prev.length * (FRAME_W + FRAME_GAP) }]);
        setPick({ frame: id, layer: null });
        setMessages((prev) => [...prev,
          { role: "tool", icon: "terminal", text: "carbon canvas write variant-c" },
          { role: "agent", text: "Variant C is on the canvas. It adds an express pay button above the summary." },
        ]);
      }
      setWorking(false);
    }, 1400);
  };

  const onPreviewMove = (e: React.PointerEvent) => {
    if (mode !== "inspect") return;
    const layer = (e.target as HTMLElement).closest<HTMLElement>("[data-layer]")?.dataset.layer ?? null;
    setHoverLayer(layer);
    setHover(layer ? measure(previewPage.current, { frame: PREVIEW, layer }) : null);
  };
  const onPreviewClick = () => {
    if (mode !== "inspect" || !hoverLayer) return;
    addToChat({ key: `${PREVIEW}/${hoverLayer}`, label: `${hoverLayer} · page.tsx`, element: true, variant: null });
    setMode("navigate");
    setHover(null);
  };

  const picked = pick && frames.find((f) => f.id === pick.frame);
  const rail = (
    <nav aria-label="Navigation" className="flex shrink-0 flex-col items-center gap-1 pt-1 pb-2" style={{ width: RAIL_W }}>
      {([["Home", <House3Glyph18 />], ["Spaces", <FilesGlyph18 />], ["Issues", <CircleDot />], ["Canvas", <Frame />]] as [string, ReactNode][]).map(([label, glyph]) => (
        <Tooltip key={label}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={label} aria-current={label === "Canvas" ? "page" : undefined}
              className={cn("size-9 text-muted-foreground transition-none hover:bg-sidebar-accent/50 hover:text-foreground [&_svg:not([class*='size-'])]:size-4.5",
                label === "Canvas" && "bg-sidebar-accent text-foreground hover:bg-sidebar-accent")}>
              {glyph}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ))}
    </nav>
  );

  const header = (
    <div className="flex h-(--titlebar-h) items-center gap-2 pr-3 text-sm" style={{ paddingLeft: RAIL_W + 8 }}>
      <span className="rounded-lg bg-sidebar-accent px-2.5 py-1 font-medium">checkout-redesign</span>
      <span className="px-2.5 py-1 text-muted-foreground">onboarding</span>
      <span className="ml-2 text-xs text-muted-foreground">acme-web · worktree-blue-fern</span>
      <div className="flex-1" />
      <Button size="sm" variant="ghost" onClick={() => { setRunning((v) => !v); setPanelOpen(true); setTab("preview"); }}>
        {running ? <Square /> : <Play />}{running ? "Stop preview" : "Start preview"}
      </Button>
      <div className="relative">
        <Button size="sm" variant="secondary" aria-expanded={publishOpen} onClick={() => setPublishOpen((v) => !v)}><Globe />Publish</Button>
        {publishOpen && (
          <div className="absolute top-9 right-0 z-40 w-80 rounded-xl border border-border bg-popover p-3 text-sm text-popover-foreground shadow-card">
            <p className="font-medium">{published ? "Your preview is live" : "Publish to the web"}</p>
            {published ? (
              <p className="mt-1 rounded-md bg-muted px-2 py-1.5 font-mono text-xs">https://acme-web-7f3k.vercel.app</p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">Builds this worktree through your Vercel account and gives it a link anyone can open.</p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">Environment variables</p>
            {([["NEXT_PUBLIC_API_URL", true, "Public"], ["STRIPE_SECRET_KEY", false, "Secret"]] as [string, boolean, string][]).map(([key, on, tag]) => (
              <label key={key} className="mt-1.5 flex items-center gap-2 font-mono text-xs">
                <input type="checkbox" defaultChecked={on} />{key}
                <span className="ml-auto rounded-sm bg-muted px-1 font-sans text-[10px] text-muted-foreground">{tag}</span>
              </label>
            ))}
            <Button size="sm" className="mt-3 w-full" onClick={() => setPublished(true)}>{published ? "Update" : "Publish"}</Button>
          </div>
        )}
      </div>
      <IconButton label={panelOpen ? "Close panel" : "Open panel"} active={panelOpen} onClick={() => setPanelOpen((v) => !v)}><PanelRight /></IconButton>
    </div>
  );

  const layersList = (
    <div className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-hairline bg-surface-frame/50 p-3 text-sm">
      <section>
        <h2 className="mb-1 px-2 text-xs text-muted-foreground">Layers</h2>
        {frames.map((frame) => {
          const open = pick?.frame === frame.id;
          return (
            <div key={frame.id}>
              <button type="button" onClick={() => setPick({ frame: frame.id, layer: null })}
                className={cn("flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-left hover:bg-sidebar-accent/50", open && !pick?.layer && "bg-sidebar-accent")}>
                <Frame className="size-3.5 text-muted-foreground" /><span className="truncate">{frame.name}</span>
              </button>
              {open && LAYERS[frame.variant].map((layer) => (
                <button type="button" key={layer} onClick={() => setPick({ frame: frame.id, layer })}
                  className={cn("flex w-full cursor-pointer items-center gap-2 rounded-lg py-1 pr-2 pl-7 text-left text-muted-foreground hover:bg-sidebar-accent/50", pick?.layer === layer && "bg-sidebar-accent text-foreground")}>
                  <Square className="size-3" /><span className="truncate">{layer}</span>
                </button>
              ))}
            </div>
          );
        })}
      </section>
      <section>
        <h2 className="mb-1 px-2 text-xs text-muted-foreground">Tokens, from your code</h2>
        {TOKENS.map(([name, value]) => (
          <div key={name} className="flex items-center gap-2 px-2 py-1">
            <span className="size-3.5 rounded-sm border border-border" style={{ background: value.startsWith("#") ? value : "transparent" }} />
            <span className="font-mono text-xs">{name}</span>
            <span className="ml-auto font-mono text-xs text-muted-foreground">{value}</span>
          </div>
        ))}
      </section>
    </div>
  );

  const canvas = (
    <div ref={stage} onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={() => { drag.current = null; }}
      className="relative min-w-0 flex-1 cursor-default touch-none overflow-hidden select-none"
      style={{ backgroundImage: "radial-gradient(var(--hairline-strong) 1px, transparent 1px)", backgroundSize: `${24 * view.k}px ${24 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        {frames.map((frame) => (
          <div key={frame.id} className="absolute top-0" style={{ left: frame.x, width: FRAME_W }}>
            <div className="absolute bottom-full mb-2 flex w-full items-baseline gap-2 whitespace-nowrap text-muted-foreground" style={{ fontSize: 12 / view.k }}>
              <span className={cn(pick?.frame === frame.id && "text-accent-mention")}>{frame.name}</span>
              <span className="truncate opacity-70">{frame.note}</span>
            </div>
            <div data-frame={frame.id} className="overflow-hidden shadow-(--shadow-ring)"><Checkout variant={frame.variant} /></div>
          </div>
        ))}
      </div>
      {box && pick && (
        <Outline box={box} label={pick.layer ?? undefined}>
          <Button size="xs" onClick={addPick} className="pointer-events-auto absolute -top-7 right-0">Add to chat<span className="opacity-60">⌘L</span></Button>
        </Outline>
      )}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-card">
        <IconButton label="Select" keys="V" active><MousePointer2 /></IconButton>
        <IconButton label="Frame" keys="F"><Frame /></IconButton>
        <IconButton label="Text" keys="T"><Type /></IconButton>
      </div>
      <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-xl border border-border bg-popover p-1 text-xs shadow-card">
        <IconButton label="Zoom out" onClick={() => zoom(1 / 1.25)}><Minus /></IconButton>
        <span className="w-10 text-center text-muted-foreground tabular-nums">{Math.round(view.k * 100)}%</span>
        <IconButton label="Zoom in" onClick={() => zoom(1.25)}><Plus /></IconButton>
        <IconButton label="Fit all frames" onClick={() => fit(frames.length)}><Maximize /></IconButton>
      </div>
      {notice && <div role="status" className="absolute top-3 left-1/2 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-1.5 text-xs shadow-card">{notice}</div>}
    </div>
  );

  const chat = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={transcript} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm">
        {messages.map((message, i) => {
          if (message.role === "user") {
            return (
              <div key={i} className="ml-8 self-end rounded-2xl bg-secondary px-3 py-2 text-secondary-foreground">
                {message.chips.length > 0 && <div className="mb-1 flex flex-wrap gap-1">{message.chips.map((chip) => <ChipTag key={chip.key} chip={chip} />)}</div>}
                {message.text}
              </div>
            );
          }
          if (message.role === "tool") {
            const Glyph = TOOL_ICONS[message.icon];
            return <div key={i} className="flex items-center gap-2 font-mono text-xs text-muted-foreground"><Glyph className="size-3.5 shrink-0" /><span className="truncate">{message.text}</span></div>;
          }
          return <p key={i} className="leading-relaxed">{message.text}</p>;
        })}
        {working && <p className="animate-pulse text-xs text-muted-foreground">Working…</p>}
      </div>
      <div className="p-3 pt-0">
        <div className="rounded-2xl border border-border bg-composer p-2.5 shadow-card">
          {chips.length > 0 && <div className="mb-2 flex flex-wrap gap-1">{chips.map((chip) => <ChipTag key={chip.key} chip={chip} onRemove={() => setChips((prev) => prev.filter((c) => c.key !== chip.key))} />)}</div>}
          <textarea aria-label="Message the agent" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={chips.some((chip) => chip.element) ? "Say what should change" : chips.length ? "Apply this design to the checkout page" :"Ask for a variation, or select a frame and press ⌘L"}
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          <div className="flex items-center text-xs text-muted-foreground">
            <span>Claude Code · worktree-blue-fern</span>
            <Button size="icon" aria-label="Send" onClick={send} className="ml-auto size-7 rounded-full bg-primary text-primary-foreground"><ArrowUp /></Button>
          </div>
        </div>
      </div>
    </div>
  );

  const preview = running ? (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-hairline px-2 py-1.5">
        <IconButton label="Back"><ArrowLeft /></IconButton>
        <IconButton label="Forward"><ArrowRight /></IconButton>
        <IconButton label="Reload"><RotateCw /></IconButton>
        <span className="mx-1 flex-1 truncate rounded-lg bg-surface-well px-2.5 py-1 font-mono text-xs text-muted-foreground">localhost:5173/checkout</span>
        <span className="flex items-center gap-1 text-xs text-muted-foreground"><Smartphone className="size-3.5" />390 × 720</span>
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-surface-well p-4">
        <div ref={previewPage} onPointerMove={onPreviewMove} onPointerLeave={() => setHover(null)} onClick={onPreviewClick}
          className={cn("relative shrink-0", mode === "inspect" && "cursor-crosshair")} style={{ width: FRAME_W * 0.8, height: FRAME_H * 0.8 }}>
          <div data-frame={PREVIEW} className="origin-top-left overflow-hidden rounded-xl shadow-(--shadow-ring)" style={{ transform: "scale(0.8)", width: FRAME_W }}>
            <Checkout variant={live} />
          </div>
          {mode === "inspect" && hover && <Outline box={hover} label={hoverLayer ?? undefined} dashed />}
        </div>
      </div>
      <div className="flex items-center justify-center gap-1 border-t border-hairline p-1.5 text-xs">
        <Button size="sm" variant="ghost" aria-pressed={mode === "navigate"} className={cn(mode === "navigate" && "bg-muted")} onClick={() => setMode("navigate")}><MousePointer2 />Navigate</Button>
        <Button size="sm" variant="ghost" aria-pressed={mode === "inspect"} className={cn(mode === "inspect" && "bg-muted")} onClick={() => setMode("inspect")}><Crosshair />Inspect</Button>
        <Button size="sm" variant="ghost" onClick={capture}><Camera />Capture</Button>
      </div>
    </div>
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
      <p className="font-medium">Run your app beside your designs</p>
      <p className="font-mono text-xs text-muted-foreground">pnpm dev · worktree-blue-fern</p>
      <Button size="sm" onClick={() => setRunning(true)}><Play />Start preview</Button>
    </div>
  );

  const panel = (
    <aside className="flex w-[420px] flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-2 py-1.5 text-sm">
        {(["chat", "preview", "properties"] as const).map((id) => (
          <button type="button" key={id} aria-pressed={tab === id} onClick={() => setTab(id)}
            className={cn("cursor-pointer rounded-lg px-2.5 py-1 capitalize text-muted-foreground hover:text-foreground", tab === id && "bg-muted text-foreground")}>
            {id}
            {id === "preview" && running && <span className="ml-1.5 inline-block size-1.5 rounded-full bg-accent-add align-middle" />}
          </button>
        ))}
      </div>
      {tab === "chat" && chat}
      {tab === "preview" && preview}
      {tab === "properties" && <Properties stage={stage} pick={pick} name={picked ? (pick?.layer ?? picked.name) : null} frame={picked ? nameOf(picked.id) : null} />}
    </aside>
  );

  return (
    <TooltipProvider>
      <div className="h-screen w-screen overflow-hidden bg-surface-frame text-foreground">
        <AppShell rail={rail} sidebar={null} header={header} footer={null} panel={panel} panelOpen={panelOpen}
          page={<>{layersList}{canvas}</>} pageOpen>
          {null}
        </AppShell>
        <DemoThemeBar />
      </div>
    </TooltipProvider>
  );
}

/// The picked layer's real computed styles, read back off the frame, so the
/// panel shows what the markup says and never a number typed into the demo.
function Properties({ stage, pick, name, frame }: { stage: RefObject<HTMLDivElement | null>; pick: Pick | null; name: string | null; frame: string | null }) {
  const [rows, setRows] = useState<[string, string][]>([]);
  useLayoutEffect(() => {
    const root = stage.current?.querySelector<HTMLElement>(`[data-frame="${pick?.frame}"]`);
    const el = pick?.layer ? root?.querySelector<HTMLElement>(`[data-layer="${pick.layer}"]`) : root?.firstElementChild as HTMLElement | null;
    if (!el) return setRows([]);
    const css = getComputedStyle(el);
    setRows([
      ["Size", `${el.offsetWidth} × ${el.offsetHeight}`], ["Layout", css.display === "flex" ? `Flex, ${css.flexDirection}` : css.display],
      ["Padding", css.padding], ["Gap", css.gap], ["Radius", css.borderRadius], ["Fill", css.backgroundColor],
      ["Border", css.borderTopWidth === "0px" ? "None" : `${css.borderTopWidth} ${css.borderTopColor}`],
      ["Text", `${css.fontSize} / ${css.fontWeight}`], ["Colour", css.color],
    ]);
  }, [stage, pick]);
  if (!name) return <p className="p-4 text-sm text-muted-foreground">Select a frame or a layer to see its properties.</p>;
  return (
    <div className="flex flex-col gap-1 overflow-y-auto p-3 text-sm">
      <p className="px-1 font-medium">{name}</p>
      <p className="mb-2 px-1 text-xs text-muted-foreground">{frame}</p>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center gap-2 px-1 py-1">
          <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
          <span className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-surface-well px-2 py-1 font-mono text-xs">
            {value.startsWith("rgb") && <span className="size-3 shrink-0 rounded-sm border border-border" style={{ background: value }} />}
            <span className="truncate">{value}</span>
          </span>
        </div>
      ))}
      <p className="mt-3 flex items-center gap-1.5 px-1 text-xs text-muted-foreground"><Check className="size-3.5" />Values bound to --brand and --radius-md stay linked to your code.</p>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<Demo />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
