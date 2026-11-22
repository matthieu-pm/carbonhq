"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { TitleBar, Toolbar } from "./kit";
import styles from "./board-tour.module.css";

const frames = [
  { id: "Desktop", label: "Landing · MacBook Air", width: 1280, height: 832, x: 0, y: 0, mobile: [0, 1460] },
  { id: "Slide", label: "Keynote · 16:9", width: 1920, height: 1080, x: 1450, y: 0, mobile: [0, 0] },
  { id: "Story", label: "Story", width: 1080, height: 1920, x: 3930, y: 0, mobile: [2130, 0] },
  { id: "iPhone", label: "Welcome · iPhone 16", width: 393, height: 852, x: 0, y: 1070, mobile: [0, 2770] },
  { id: "Watch", label: "Apple Watch", width: 198, height: 242, x: 560, y: 1070, mobile: [640, 2770] },
  { id: "iPad", label: "Onboarding · iPad mini", width: 744, height: 1133, x: 900, y: 1070, mobile: [1070, 2770] },
  { id: "A4", label: "Poster · A4", width: 794, height: 1123, x: 1770, y: 1310, mobile: [3520, 320] },
  { id: "Square", label: "Post · Square", width: 1080, height: 1080, x: 2670, y: 1310, mobile: [2150, 2580] },
] as const;

type FrameId = (typeof frames)[number]["id"];
const views: (FrameId | "Fit")[] = ["Fit", "iPhone", "iPad", "Desktop", "Slide", "Square", "Story", "A4", "Watch"];
const tour: { view: FrameId | "Fit"; delay: number }[] = [
  { view: "iPhone", delay: 1200 },
  { view: "Slide", delay: 2600 },
  { view: "Story", delay: 2600 },
  { view: "Fit", delay: 2600 },
];

function CampaignArt({ format }: { format: FrameId }) {
  return (
    <span aria-hidden="true" className={styles.design} data-format={format}>
      <span className={styles.art}><i /><i /><i /><i /></span>
      <span className={styles.brand}>Carbon</span>
      <span className={styles.headline}>Ship the screen you sketched.</span>
      <span className={styles.cta}>{format === "Watch" ? "Ship" : "Get started"}</span>
    </span>
  );
}

export function BoardTour() {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 960, height: 560 });
  const [view, setView] = useState<FrameId | "Fit">("Fit");
  const [step, setStep] = useState(0);
  const [manual, setManual] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const el = stage.current!;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    let resizeFrame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(measure);
    });
    measure();
    resize.observe(el);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.intersectionRatio >= 0.4), { threshold: 0.4 });
    observer.observe(el);
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setReduced(media.matches);
      if (media.matches) setView("Fit");
    };
    sync();
    media.addEventListener("change", sync);
    return () => {
      cancelAnimationFrame(resizeFrame);
      resize.disconnect();
      observer.disconnect();
      media.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    if (!visible || reduced || manual || step >= tour.length) return;
    const timer = window.setTimeout(() => {
      setView(tour[step].view);
      setStep(step + 1);
    }, tour[step].delay);
    return () => clearTimeout(timer);
  }, [step, visible, reduced, manual]);

  const compact = size.width < 600;
  const layout = frames.map(f => ({ ...f, x: compact ? f.mobile[0] : f.x, y: compact ? f.mobile[1] : f.y }));
  const selected = layout.find(f => f.id === view);
  const target = selected ?? {
    x: 0, y: 0,
    width: Math.max(...layout.map(f => f.x + f.width)),
    height: Math.max(...layout.map(f => f.y + f.height)),
  };
  const zoom = Math.min((size.width - (compact ? 32 : 64)) / target.width, (size.height - 100) / target.height);
  const x = (size.width - target.width * zoom) / 2 - target.x * zoom;
  const y = (size.height - target.height * zoom) / 2 - target.y * zoom;
  const choose = (next: typeof view) => { setManual(true); setView(next); };

  return (
    <div onPointerDownCapture={() => setManual(true)} onKeyDownCapture={e => {
      setManual(true);
      if (e.key === "Escape") choose("Fit");
    }}>
      <div data-app-window className="app-frame overflow-hidden rounded-xl border border-hairline font-sans text-ui text-foreground shadow-window">
        <div className="flex items-center justify-between gap-1 pr-3">
          <div className="min-w-0 overflow-hidden" aria-hidden="true"><TitleBar tabs={["launch"]} /></div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-[11px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => choose("Fit")} className="rounded px-2 py-1 text-xs hover:bg-surface-thumb">Zoom to fit</button>
          </div>
        </div>
        <div ref={stage} role="group" aria-label="Launch canvas" className={styles.stage}>
          <div className={styles.world} style={{ transform: `translate(${x}px,${y}px) scale(${zoom})` }}>
            {layout.map(f => (
              <button key={f.id} type="button" aria-label={`${f.label}, ${f.width} by ${f.height}`}
                aria-pressed={view === f.id} onClick={() => choose(f.id)}
                onFocus={e => { if (e.currentTarget.matches(":focus-visible")) choose(f.id); }}
                className={styles.frame} data-dim={!!selected && view !== f.id}
                style={{ left: f.x, top: f.y, width: f.width, height: f.height, "--inverse": 1 / zoom } as CSSProperties}>
                {(selected?.id === f.id || f.width * zoom >= 40) && (
                  <span className={styles.label}>
                    {f.width * zoom < 135 ? f.id : f.label}
                    {f.width * zoom >= 210 && <small> {f.width} × {f.height}</small>}
                  </span>
                )}
                <CampaignArt format={f.id} />
              </button>
            ))}
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center"><Toolbar active="Hand" /></div>
        </div>
      </div>
      <div role="group" aria-label="Focus a frame" className="mt-5 flex flex-wrap justify-center gap-1.5">
        {views.map(v => <button key={v} type="button" aria-pressed={view === v} onClick={() => choose(v)} className="min-h-9 rounded-md px-3 font-mono text-xs text-white/65 hover:bg-white/10 aria-pressed:bg-white/15 aria-pressed:text-white light:text-black/65 light:hover:bg-black/5 light:aria-pressed:bg-black/10 light:aria-pressed:text-black">{v}</button>)}
      </div>
      <p className="sr-only" aria-live="polite">{manual && (selected ? selected.label : "All frames in view")}</p>
    </div>
  );
}
