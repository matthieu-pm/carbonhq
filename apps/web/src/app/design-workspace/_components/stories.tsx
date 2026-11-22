import type { CSSProperties, ReactNode } from "react";
import { ArrowUp, ChevronDown, CodeXml, Eye, FileBraces, Plus, Search } from "lucide-react";
import hm from "@/components/home/motion.module.css";
import { PlayWhenVisible } from "@/components/home/PlayWhenVisible";
import { Fit } from "./Fit";
import {
  Checkout,
  FrameLabel,
  INK,
  InspectorSection,
  LOOK,
  NavPanel,
  OrderPlaced,
  Pin,
  Shot,
  TitleBar,
  Toolbar,
  cx,
  type Look,
} from "./kit";

/// The hero previews: three short scenes that play themselves on the
/// homepage's clock (`motion.module.css`). `PlayWhenVisible` runs it only on
/// screen, and every scene is laid out so 0.9 of the loop is its finished
/// picture, which is what reduced motion shows.

const at = (s: number, l = 0.06, ramp?: number) => ({ "--s": s, "--l": l, "--ramp": ramp }) as CSSProperties;
const CLOCK = "var(--home-clock)";

type Move = { t0: number; t1: number; x: number; y: number };

/// A cursor's position along a list of eased moves, as an inline transform
/// read off the clock, shown between `show[0]` and `show[1]`.
function path(start: [number, number], moves: Move[], show: [number, number]): CSSProperties {
  let x = `${start[0]}`;
  let y = `${start[1]}`;
  let [px, py] = start;
  for (const m of moves) {
    const u = `clamp(0, (${CLOCK} - ${m.t0}) / ${m.t1 - m.t0}, 1)`;
    const eased = `(${u} * ${u} * (3 - 2 * ${u}))`;
    x += ` + ${m.x - px} * ${eased}`;
    y += ` + ${m.y - py} * ${eased}`;
    [px, py] = [m.x, m.y];
  }
  return {
    transform: `translate(calc((${x}) * 1px), calc((${y}) * 1px))`,
    opacity: `calc(clamp(0, (${CLOCK} - ${show[0]}) * 25, 1) * (1 - clamp(0, (${CLOCK} - ${show[1]}) * 25, 1)))`,
  };
}

function Cursor({ style }: { style: CSSProperties }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" className="pointer-events-none absolute top-0 left-0 z-30 drop-shadow-[0_2px_4px_#00000059]" style={style}>
      <path d="M3.9 3.05 20.1 9.45Q21.5 10 20.07 10.46L14.23 12.34Q12.8 12.8 12.34 14.23L10.46 20.07Q10 21.5 9.45 20.1L3.05 3.9Q2.5 2.5 3.9 3.05Z" fill="#000" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/// A click: a ring flashing where the cursor lands.
function Click({ x, y, s }: { x: number; y: number; s: number }) {
  return <i className={cx("pointer-events-none absolute z-20 size-7 rounded-full border-2 border-[#4b93ff] bg-[#4b93ff26]", hm.blip)} style={{ left: x - 14, top: y - 14, ...at(s, 0.035) }} />;
}

/// Two states of one thing in the same spot; the second takes over at `s`.
function Swap({ s, before, after, className }: { s: number; before: ReactNode; after: ReactNode; className?: string }) {
  return (
    <span className={cx("grid", className)}>
      <span className={cx("col-start-1 row-start-1", hm.fadeOut)} style={at(s)}>{before}</span>
      <span className={cx("col-start-1 row-start-1", hm.appear)} style={at(s)}>{after}</span>
    </span>
  );
}

/// Text typed in a few beats: each prefix shows alone, cut in hard, so no
/// two overlap; the whole stays once typed.
function Typed({ s, steps, className }: { s: number; steps: string[]; className?: string }) {
  const beat = 0.035;
  const on = (t: number) => `clamp(0, (${CLOCK} - ${t}) * 1000, 1)`;
  return (
    <span className={cx("grid", className)}>
      {steps.map((t, i) => {
        const start = s + i * beat;
        const last = i === steps.length - 1;
        return (
          <span key={t} className="col-start-1 row-start-1" style={{ opacity: last ? on(start) : `calc(${on(start)} * (1 - ${on(start + beat)}))` }}>
            {t}
            {!last && <i className="ml-px inline-block h-[1em] w-px translate-y-[2px] bg-current" />}
          </span>
        );
      })}
    </span>
  );
}

/// Shown until `t`, then cut away at once.
const until = (t: number) => ({ opacity: `calc(1 - clamp(0, (${CLOCK} - ${t}) * 1000, 1))` });

/// The selection outline drawn round a layer, faded in at `s`.
function Selection({ s, label }: { s: number; label: string }) {
  const handle = "absolute size-[7px] border border-[#4b93ff] bg-white";
  return (
    <span className={cx("pointer-events-none absolute -inset-[3px] border border-[#4b93ff] bg-[#4b93ff14]", hm.appear)} style={at(s)}>
      <i className={cx(handle, "-top-1 -left-1")} />
      <i className={cx(handle, "-top-1 -right-1")} />
      <i className={cx(handle, "-bottom-1 -left-1")} />
      <i className={cx(handle, "-right-1 -bottom-1")} />
      <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 rounded-[3px] bg-[#2166ba] px-1.5 py-px font-mono text-[10px] leading-4 whitespace-nowrap text-white">{label}</span>
    </span>
  );
}

function Pay({ look, radius }: { look: Look; radius: number }) {
  return (
    <span style={{ background: look.accent, color: look.accentInk, borderRadius: radius }} className="absolute inset-0 flex items-center justify-center text-[14px] font-semibold">
      Pay $86.00
    </span>
  );
}

/// An inspector well whose content may move: a label over a value box.
function Field({ label, children, focus }: { label?: string; children: ReactNode; focus?: number }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {label && <span className="text-[11px] text-muted-foreground">{label}</span>}
      <span className="relative flex h-7 min-w-0 items-center gap-1.5 rounded-md bg-foreground/6 px-2 text-[12px]">
        {children}
        {focus !== undefined && <i className={cx("absolute inset-0 rounded-md ring-1 ring-[#4b93ff]", hm.blip)} style={at(focus, 0.08)} />}
      </span>
    </span>
  );
}

const chip = "truncate rounded-[4px] bg-[#4b93ff26] px-1.5 text-[11px] leading-[18px] text-[#7fb2ff] light:text-[#2166ba]";
const swatch = "size-3.5 shrink-0 rounded-[3px] ring-1 ring-foreground/15";

const BLUE: Look = { ...LOOK, accent: "#2F6BFF", accentInk: "#FFFFFF" };

/// Wraps a scene in the clock and its visibility switch; `className` lays out
/// the children. `dur` is one loop.
export function Story({ dur = "14s", children, className }: { dur?: string; children: ReactNode; className?: string }) {
  return (
    <PlayWhenVisible>
      <div className={cx(hm.timeline, className)} style={{ "--dur": dur } as CSSProperties}>
        {children}
      </div>
    </PlayWhenVisible>
  );
}

/* ───────────── The board: select a layer, change two properties ───────────── */

// Board origin inside the window, and the Pay button's centre on the board.
const BX = 237;
const BY = 41;

/// Select the Pay button, round its corners from 12 to 22, then swap its fill
/// from the ink token to the accent token.
export function InspectScene() {
  return (
    <>
      <Fit width={1440} height={880} className="max-sm:hidden">
        <Shot label="A Carbon canvas. The cursor selects the Pay button, the inspector changes its radius from 12 to 22, then its fill from ink to accent, and the button repaints each time." style={{ width: 1440, height: 880 }}>
          <TitleBar />
          <div className="flex min-h-0 flex-1">
            <NavPanel mark={{ name: "Pay button", className: hm.appear, style: at(0.14) }} />
            <div className="app-sheet relative flex min-w-0 flex-1 overflow-hidden rounded-tl-[10px] border-t border-l border-edge-surface">
              <div className="relative min-w-0 flex-1 overflow-hidden">
                <div className="absolute top-14 left-16">
                  <FrameLabel>Checkout · iPhone 16</FrameLabel>
                  <Checkout pay={<InspectPay />} />
                </div>
                <div className="absolute top-14 left-[420px]">
                  <FrameLabel>Order placed</FrameLabel>
                  <OrderPlaced width={240} />
                </div>
                <div className="absolute top-14 left-[716px]">
                  <FrameLabel>Launch promo · Square</FrameLabel>
                  <Promo look={LOOK} />
                </div>
                <Toolbar active="Select" className="absolute bottom-4 left-1/2 -translate-x-1/2" />
              </div>
              <div className="flex w-[252px] shrink-0 flex-col border-l border-hairline bg-background">
                <div className="flex h-[42px] shrink-0 items-center justify-end gap-1 border-b border-hairline px-3 text-muted-foreground">
                  100% <ChevronDown className="size-3" />
                </div>
                <div className="grid">
                  <div className={cx("col-start-1 row-start-1", hm.fadeOut)} style={at(0.14)}>
                    <InspectorSection title="Page">
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Background"><i className={swatch} style={{ background: "#1F1F1F" }} />#1F1F1F</Field>
                        <Field label="Opacity">100%</Field>
                      </div>
                    </InspectorSection>
                  </div>
                  <div className={cx("col-start-1 row-start-1", hm.appear)} style={at(0.14)}>
                    <RectInspector />
                  </div>
                </div>
              </div>
            </div>
          </div>
          <Click x={BX + 214} y={BY + 73 + 538} s={0.13} />
          <Click x={1314} y={290} s={0.3} />
          <Click x={1364} y={370} s={0.5} />
          <Cursor
            style={path(
              [820, 520],
              [
                { t0: 0.02, t1: 0.12, x: BX + 214, y: BY + 73 + 538 },
                { t0: 0.18, t1: 0.29, x: 1314, y: 290 },
                { t0: 0.4, t1: 0.49, x: 1364, y: 370 },
                { t0: 0.6, t1: 0.7, x: 1000, y: 600 },
              ],
              [0.01, 0.7],
            )}
          />
        </Shot>
      </Fit>
      <Fit width={400} height={660} className="sm:hidden">
        <Shot label="The Pay button selected on the canvas, its radius going from 12 to 22 and its fill from ink to accent." style={{ width: 400, height: 660 }}>
          <div className="app-sheet relative flex-1 overflow-hidden">
            <div className="absolute top-5 left-1/2 -translate-x-1/2">
              <FrameLabel>Checkout · iPhone 16</FrameLabel>
              <Checkout width={250} pay={<InspectPay />} />
            </div>
            <div className="absolute inset-x-3 bottom-3 rounded-lg border border-hairline bg-popover p-3 shadow-[0_12px_32px_-12px_#00000080]">
              <div className="grid grid-cols-2 gap-2">
                <RadiusField />
                <FillField />
              </div>
            </div>
          </div>
          <Click x={200} y={445} s={0.13} />
          <Click x={106} y={622} s={0.3} />
          <Click x={290} y={622} s={0.5} />
          <Cursor
            style={path(
              [300, 250],
              [
                { t0: 0.02, t1: 0.12, x: 200, y: 445 },
                { t0: 0.18, t1: 0.29, x: 106, y: 622 },
                { t0: 0.4, t1: 0.49, x: 290, y: 622 },
                { t0: 0.6, t1: 0.7, x: 330, y: 300 },
              ],
              [0.01, 0.7],
            )}
          />
        </Shot>
      </Fit>
    </>
  );
}

function InspectPay() {
  return (
    <span className="relative block h-11">
      <span className={hm.fadeOut} style={at(0.32)}><Pay look={LOOK} radius={12} /></span>
      <span className={hm.blip} style={at(0.32, 0.2)}><Pay look={LOOK} radius={22} /></span>
      <span className={hm.appear} style={at(0.52)}><Pay look={BLUE} radius={22} /></span>
      <Selection s={0.14} label="345 × 44" />
    </span>
  );
}

function RadiusField() {
  return (
    <Field label="Radius" focus={0.29}>
      <Swap s={0.32} before="12" after="22" />
    </Field>
  );
}

function FillField() {
  return (
    <Field label="Fill" focus={0.49}>
      <Swap
        s={0.52}
        className="min-w-0"
        before={<span className="flex items-center gap-1.5"><i className={swatch} style={{ background: LOOK.accent }} /><span className={chip}>ink</span></span>}
        after={<span className="flex items-center gap-1.5"><i className={swatch} style={{ background: BLUE.accent }} /><span className={chip}>accent</span></span>}
      />
    </Field>
  );
}

function RectInspector() {
  return (
    <>
      <InspectorSection title="Rectangle">
        <div className="grid grid-cols-2 gap-2">
          <Field label="W">345</Field>
          <Field label="H">44</Field>
          <Field label="X">24</Field>
          <Field label="Y">692</Field>
        </div>
      </InspectorSection>
      <InspectorSection title="Radius">
        <Field focus={0.29}>
          <Swap s={0.32} before="12" after="22" />
        </Field>
      </InspectorSection>
      <InspectorSection title="Fill" end={<Eye className="size-3.5 text-muted-foreground" />}>
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <Field>Solid</Field>
          <Field focus={0.49}>
            <Swap
              s={0.52}
              className="min-w-0"
              before={<span className="flex items-center gap-1.5"><i className={swatch} style={{ background: LOOK.accent }} /><span className={chip}>ink</span></span>}
              after={<span className="flex items-center gap-1.5"><i className={swatch} style={{ background: BLUE.accent }} /><span className={chip}>accent</span></span>}
            />
          </Field>
        </div>
      </InspectorSection>
      <InspectorSection title="Shadow" end={<Eye className="size-3.5 text-muted-foreground" />}>
        <div className="grid grid-cols-4 gap-1.5">
          <Field label="X">0</Field>
          <Field label="Y">4</Field>
          <Field label="Blur">12</Field>
          <Field label="Spread">0</Field>
        </div>
      </InspectorSection>
    </>
  );
}

/* ───────────── The loop: edit a token, linked layers repaint ───────────── */

const TOKEN_ROWS: [kind: string, name: string, value: string][] = [
  ["Color", "paper", "#FBFAF7"],
  ["Color", "ink", "#16140F"],
  ["Color", "line", "#ECE8DF"],
  ["Color", "accent", ""],
  ["Radius", "md", "12px"],
  ["Font family", "body", "Inter, sans-serif"],
];

const TOKEN_EDIT = { s: 0.2, done: 0.4, paint: 0.44 };

/// The Theme tab with the accent token being retyped.
function TokenPanel({ popover = true }: { popover?: boolean }) {
  let last = "";
  return (
    <div className="flex flex-col">
      <div className="flex min-h-8 items-center justify-between px-2.5 pt-2">
        <span className="font-[550]">Theme tokens</span>
        <Plus className="size-3.5 text-muted-foreground" />
      </div>
      <div className="mx-2.5 my-1.5 flex h-7 items-center gap-1.5 rounded-md bg-foreground/6 px-2 text-muted-foreground">
        <Search className="size-3.5" />
        Search tokens…
      </div>
      <div className="px-2.5 pb-1 text-[11px] text-muted-foreground">Imported from storefront/DESIGN.md</div>
      {TOKEN_ROWS.map(([kind, name, value]) => {
        const head = kind !== last;
        last = kind;
        const accent = name === "accent";
        return (
          <div key={name} className="relative">
            {head && <div className="px-2.5 pt-1.5 pb-0.5 text-[11px] text-muted-foreground">{kind}</div>}
            <div className={cx("relative mx-1.5 flex h-7 items-center gap-2 rounded-md px-2", accent && "z-10")}>
              {accent && <i className={cx("absolute inset-0 rounded-md bg-surface-thumb", hm.blip)} style={at(0.13, 0.32)} />}
              {kind === "Color" ? (
                accent ? (
                  <Swap s={TOKEN_EDIT.done} className="relative" before={<i className={cx(swatch, "block")} style={{ background: LOOK.accent }} />} after={<i className={cx(swatch, "block")} style={{ background: BLUE.accent }} />} />
                ) : (
                  <i className={swatch} style={{ background: value }} />
                )
              ) : (
                <i className="size-3.5 shrink-0" />
              )}
              <span className="relative min-w-0 flex-1 truncate">{name}</span>
              <span className="relative font-mono text-[11px] text-muted-foreground">
                {accent ? <Swap s={TOKEN_EDIT.done} before="#16140F" after="#2F6BFF" /> : value}
              </span>
            </div>
            {accent && popover && (
              <div className={cx("absolute right-2.5 left-2.5 z-20 mt-0.5 rounded-lg border border-hairline bg-popover p-2 shadow-[0_12px_32px_-12px_#00000080]", hm.blip)} style={at(0.16, 0.25)}>
                <div className="mb-1 text-[11px] text-muted-foreground">Value</div>
                <div className="flex h-7 items-center rounded-md bg-foreground/6 px-2 font-mono text-[12px] ring-1 ring-[#4b93ff]">
                  <span className="grid">
                    <span className="col-start-1 row-start-1" style={until(TOKEN_EDIT.s)}>#16140F</span>
                    <Typed s={TOKEN_EDIT.s} steps={["#2", "#2F6", "#2F6BF", "#2F6BFF"]} className="col-start-1 row-start-1" />
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/// A square promo frame whose badge and button are bound to the accent token.
function Promo({ look }: { look: Look }) {
  return (
    <div style={{ background: look.bg, color: look.ink, fontFamily: look.font }} className="flex size-[300px] flex-col p-6 shadow-[0_1px_3px_#00000026]">
      <span style={{ background: look.accent, color: look.accentInk }} className="self-start rounded-full px-2.5 py-1 text-[11px] font-semibold">New</span>
      <span className="mt-auto text-[26px] leading-[30px] font-semibold tracking-[-0.03em]">The linen edit is here.</span>
      <span className="mt-2 text-[13px]" style={{ color: look.muted }}>Free shipping through Sunday.</span>
      <span style={{ background: look.accent, color: look.accentInk, borderRadius: look.radius }} className="mt-5 flex h-10 items-center justify-center text-[13px] font-semibold">Shop now</span>
    </div>
  );
}

/// Both looks stacked: the new one fades in once the token is saved.
function Repaint({ children }: { children: (look: Look) => ReactNode }) {
  return (
    <div className="grid">
      <div className="col-start-1 row-start-1">{children(LOOK)}</div>
      <div className={cx("col-start-1 row-start-1", hm.appear)} style={at(TOKEN_EDIT.paint, 0.06, 8)}>{children(BLUE)}</div>
    </div>
  );
}

function Linked({ s, className }: { s: number; className: string }) {
  return (
    <span className={cx("absolute z-10 flex items-center gap-1 rounded-[4px] bg-[#2166ba] px-1.5 py-px font-mono text-[10px] leading-4 whitespace-nowrap text-white shadow-[0_2px_6px_#00000040]", hm.appear, className)} style={at(s)}>
      accent
    </span>
  );
}

/// Change the accent token's value in the Theme tab; the Pay button and the
/// confirmation mark, both bound to it, repaint on both frames.
export function TokenScene() {
  return (
    <>
      <Fit width={1440} height={880} className="max-sm:hidden">
        <Shot label="A Carbon canvas with the Theme tab open. The accent token is retyped from near-black to blue, and the Pay button and the order confirmation mark, both bound to it, repaint." style={{ width: 1440, height: 880 }}>
          <TitleBar />
          <div className="flex min-h-0 flex-1">
            <NavPanel mode="Theme">
              <TokenPanel />
            </NavPanel>
            <div className="app-sheet relative flex min-w-0 flex-1 overflow-hidden rounded-tl-[10px] border-t border-l border-edge-surface">
              <div className="relative min-w-0 flex-1 overflow-hidden">
                <div className="absolute top-14 left-16">
                  <FrameLabel>Checkout · iPhone 16</FrameLabel>
                  <div className="relative">
                    <Repaint>{(look) => <Checkout look={look} />}</Repaint>
                    <Linked s={0.5} className="bottom-[68px] left-[200px]" />
                  </div>
                </div>
                <div className="absolute top-14 left-[420px]">
                  <FrameLabel>Order placed</FrameLabel>
                  <div className="relative">
                    <Repaint>{(look) => <OrderPlaced look={look} width={300} />}</Repaint>
                    <Linked s={0.54} className="top-[66px] left-[176px]" />
                  </div>
                </div>
                <div className="absolute top-14 left-[776px]">
                  <FrameLabel>Launch promo · Square</FrameLabel>
                  <div className="relative">
                    <Repaint>{(look) => <Promo look={look} />}</Repaint>
                    <Linked s={0.58} className="bottom-[60px] left-[200px]" />
                  </div>
                </div>
                <Toolbar active="Select" className="absolute bottom-4 left-1/2 -translate-x-1/2" />
              </div>
            </div>
          </div>
          <Click x={150} y={346} s={0.13} />
          <Cursor
            style={path(
              [900, 520],
              [
                { t0: 0.02, t1: 0.12, x: 150, y: 346 },
                { t0: 0.42, t1: 0.54, x: 760, y: 420 },
              ],
              [0.01, 0.64],
            )}
          />
        </Shot>
      </Fit>
      <Fit width={400} height={700} className="sm:hidden">
        <Shot label="The accent token retyped from near-black to blue, and the Pay button bound to it repainting." style={{ width: 400, height: 700 }}>
          <div className="app-sheet relative flex-1 overflow-hidden">
            <div className="absolute top-3 right-3 left-3 rounded-lg border border-hairline bg-background">
              <TokenRowMobile />
            </div>
            <div className="absolute top-[150px] left-1/2 -translate-x-1/2">
              <FrameLabel>Checkout · iPhone 16</FrameLabel>
              <div className="relative">
                <Repaint>{(look) => <Checkout look={look} width={260} />}</Repaint>
                <Linked s={0.5} className="bottom-[58px] left-[170px]" />
              </div>
            </div>
          </div>
        </Shot>
      </Fit>
    </>
  );
}

function TokenRowMobile() {
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <span className="font-[550]">Theme tokens</span>
        <span className="text-[11px] text-muted-foreground">Color</span>
      </div>
      <div className="flex h-8 items-center gap-2 rounded-md bg-surface-thumb px-2">
        <Swap s={TOKEN_EDIT.done} before={<i className={cx(swatch, "block")} style={{ background: LOOK.accent }} />} after={<i className={cx(swatch, "block")} style={{ background: BLUE.accent }} />} />
        <span className="flex-1">accent</span>
        <span className="flex h-6 items-center rounded-md bg-foreground/6 px-2 font-mono text-[12px] ring-1 ring-[#4b93ff]">
          <span className="grid">
            <span className="col-start-1 row-start-1" style={until(TOKEN_EDIT.s)}>#16140F</span>
            <Typed s={TOKEN_EDIT.s} steps={["#2", "#2F6", "#2F6BF", "#2F6BFF"]} className="col-start-1 row-start-1" />
          </span>
        </span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        <Swap s={TOKEN_EDIT.paint} before="Linked to 3 layers" after="3 linked layers repainted" />
      </div>
    </div>
  );
}

/* ───────────── Two workspaces: pin a comment, it lands in chat ───────────── */

const HAND = { tool: 0.12, pin: 0.26, box: 0.28, type: 0.3, send: 0.44, sent: 0.47, read: 0.58, edit: 0.64, reply: 0.72 };
const NOTE = "Keep this above the home indicator.";

function CommentCard({ className }: { className?: string }) {
  return (
    <div className={cx("w-[260px] rounded-lg border border-hairline bg-popover p-2 shadow-[0_12px_32px_-12px_#00000080]", hm.blip, className)} style={at(HAND.box, HAND.sent - HAND.box)}>
      <div className="flex items-center gap-2">
        <span className="grid min-w-0 flex-1 text-[13px] leading-5 text-foreground">
          <span className="col-start-1 row-start-1 text-muted-foreground" style={until(HAND.type)}>Add a comment</span>
          <Typed s={HAND.type} steps={["Keep this", "Keep this above the", NOTE]} className="col-start-1 row-start-1" />
        </span>
        <span className="relative flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <ArrowUp className="size-4" />
        </span>
      </div>
      <small className="mt-1 block text-[11px] text-muted-foreground">To Canvas chat</small>
    </div>
  );
}

/// The message as it lands: snapshot, note, canvas path; then the agent working.
function Landed({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
      <div className="grid flex-none">
        <p className={cx("col-start-1 row-start-1 pt-6 text-center text-[12.5px] text-muted-foreground", hm.fadeOut)} style={at(HAND.sent)}>
          Comments you send from the canvas land here.
        </p>
        <div className={cx("col-start-1 row-start-1 ml-6 flex flex-col items-end gap-1.5", hm.appear)} style={at(HAND.sent, 0.06, 12)}>
          <div className="relative h-[92px] w-[132px] overflow-hidden rounded-lg bg-[#FBFAF7] ring-1 ring-foreground/10">
            {[14, 30, 46].map((t) => (
              <div key={t} className="absolute inset-x-3 h-3 rounded-[3px] border border-[#ECE8DF] bg-white" style={{ top: t }} />
            ))}
            <div className="absolute inset-x-3 bottom-4 h-3.5 rounded-[3px] bg-[#16140F]" />
            <i className="absolute right-2 bottom-3.5 size-2.5 rounded-full border border-white" style={{ background: INK }} />
          </div>
          <div className="rounded-xl bg-card px-3 py-2 text-chat leading-[1.45] text-card-foreground">
            {NOTE}
            <span className="mt-1.5 block font-mono text-[10.5px] leading-4 break-all text-muted-foreground">Canvas: storefront/canvases/flows/checkout.canvas.json</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 text-[12.5px]">
        <span className={cx("flex items-center gap-1.5 text-muted-foreground", hm.appear)} style={at(HAND.read)}><FileBraces className="size-3.5" />Read checkout.canvas.json</span>
        <span className={cx("flex items-center gap-1.5 text-muted-foreground", hm.appear)} style={at(HAND.edit)}><CodeXml className="size-3.5" />Edit CheckoutSheet.tsx <span className="text-accent-add">+14</span> <span className="text-destructive">−6</span></span>
        <p className={cx("mt-1 text-chat leading-[1.55] text-foreground/90", hm.appear, compact && "text-[13px]")} style={at(HAND.reply, 0.06, 12)}>
          Moved the button into a sticky footer with safe-area padding, so it stays above the home indicator.
        </p>
      </div>
    </div>
  );
}

function Dock() {
  return (
    <div className="flex w-[340px] shrink-0 flex-col border-l border-hairline bg-background">
      <div className="flex h-[42px] shrink-0 items-center gap-1 border-b border-hairline px-1.5">
        <span className="flex h-7 items-center rounded-md bg-surface-thumb px-2.5">Canvas chat</span>
        <Plus className="mr-1.5 ml-auto size-3.5 text-muted-foreground" />
      </div>
      <Landed />
      <div className="m-2.5 mt-0 flex h-10 shrink-0 items-center justify-between rounded-xl bg-composer px-3 text-muted-foreground">
        Message…
        <span className="flex size-6 items-center justify-center rounded-full bg-foreground/10"><ArrowUp className="size-3.5" /></span>
      </div>
    </div>
  );
}

/// Pick the Comment tool, pin the Pay button, type a note and send it. The
/// canvas chat shows the note with its snapshot and path, then the agent's work.
export function HandoffScene() {
  const pay = { x: BX + 64 + 280, y: BY + 73 + 538 };
  return (
    <>
      <Fit width={1440} height={880} className="max-sm:hidden">
        <Shot label="A Carbon canvas with its chat docked. The cursor picks the Comment tool, pins the Pay button and sends a note. The note lands in the canvas chat with a snapshot and the canvas path, and the agent edits the checkout code." style={{ width: 1440, height: 880 }}>
          <TitleBar />
          <div className="flex min-h-0 flex-1">
            <NavPanel />
            <div className="app-sheet relative flex min-w-0 flex-1 overflow-hidden rounded-tl-[10px] border-t border-l border-edge-surface">
              <div className="relative min-w-0 flex-1 overflow-hidden">
                <div className="absolute top-14 left-16">
                  <FrameLabel>Checkout · iPhone 16</FrameLabel>
                  <Checkout />
                </div>
                <div className="absolute top-14 left-[420px]">
                  <FrameLabel>Order placed</FrameLabel>
                  <OrderPlaced width={240} />
                </div>
                <Pin n={1} className={cx("absolute", hm.appear)} style={{ left: pay.x - BX - 2, top: pay.y - BY - 30, ...at(HAND.pin) }} />
                <CommentCard className="absolute top-[600px] left-[384px]" />
                <Toolbar active={null} className="absolute bottom-4 left-1/2 -translate-x-1/2">
                  <i className={cx("absolute top-1 left-1 size-8 rounded-md bg-foreground/10", hm.fadeOut)} style={at(HAND.tool)} />
                  <i className={cx("absolute top-1 left-[221px] size-8 rounded-md bg-foreground/10", hm.appear)} style={at(HAND.tool)} />
                </Toolbar>
              </div>
              <Dock />
            </div>
          </div>
          <Click x={TOOL_X} y={846} s={HAND.tool} />
          <Click x={pay.x} y={pay.y} s={HAND.pin - 0.01} />
          <Click x={859} y={663} s={HAND.send} />
          <Cursor
            style={path(
              [760, 500],
              [
                { t0: 0.02, t1: 0.11, x: TOOL_X, y: 846 },
                { t0: 0.15, t1: 0.24, x: pay.x, y: pay.y },
                { t0: 0.38, t1: 0.43, x: 859, y: 663 },
                { t0: 0.52, t1: 0.6, x: 980, y: 380 },
              ],
              [0.01, 0.62],
            )}
          />
        </Shot>
      </Fit>
      <Fit width={400} height={760} className="sm:hidden">
        <Shot label="A comment pinned to the Pay button and sent; it lands in the canvas chat with a snapshot and the canvas path, and the agent replies." style={{ width: 400, height: 760 }}>
          <div className="app-sheet relative flex-1 overflow-hidden">
            <div className="absolute top-4 left-6">
              <FrameLabel>Checkout · iPhone 16</FrameLabel>
              <Checkout width={210} />
            </div>
            <Pin n={1} className={cx("absolute", hm.appear)} style={{ left: 214, top: 372, ...at(HAND.pin) }} />
            <CommentCard className="absolute top-[300px] left-[120px] w-[260px]" />
            <div className={cx("absolute inset-x-3 bottom-3 flex h-[330px] flex-col rounded-xl border border-hairline bg-background shadow-[0_-12px_32px_-12px_#00000080]", hm.appear)} style={at(HAND.sent, 0.06, 12)}>
              <div className="flex h-9 shrink-0 items-center border-b border-hairline px-3 text-muted-foreground">Canvas chat</div>
              <Landed compact />
            </div>
          </div>
        </Shot>
      </Fit>
    </>
  );
}

// The Comment button's centre: the bar is centred on the board, which spans
// the window between the left column and the docked chat.
const TOOL_X = BX + (1440 - 237 - 340) / 2 - 259 / 2 + 237;
