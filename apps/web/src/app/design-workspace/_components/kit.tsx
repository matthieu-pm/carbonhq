import { Doodle, WorkspaceSwitch } from "@/components/app/WorkspaceSwitch";
import type { CSSProperties, ReactNode } from "react";
import {
  Archive,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CodeXml,
  Eye,
  FileBraces,
  Folder,
  FolderOpen,
  Frame,
  Hand,
  Layers,
  LayoutGrid,
  List,
  MessageSquare,
  MousePointer2,
  Pencil,
  Plus,
  Search,
  Square,
  Type,
} from "lucide-react";

export { Doodle, WorkspaceSwitch };

/// Drawn pieces of the desktop Canvas editor, shared by the three Design
/// workspace pages. Each mirrors a real surface in `apps/desktop/src/components/canvases`:
/// labels, tool keys, inspector sections and token kinds are the app's own, so
/// a picture here never shows a control the app lacks.

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

/// The canvas markup ink, `CanvasMarkup`'s own blue.
export const INK = "#168bf0";

export const TOOLS = [
  { name: "Select", key: "V", icon: MousePointer2 },
  { name: "Hand", key: "H", icon: Hand },
  { name: "Frame", key: "F", icon: Frame },
  { name: "Rectangle", key: "R", icon: Square },
  { name: "Text", key: "T", icon: Type },
  { name: "Pen", key: "P", icon: Pencil },
  { name: "Comment", key: "C", icon: MessageSquare },
] as const;
export type ToolName = (typeof TOOLS)[number]["name"];

export const EFFECTS = ["Fill", "Outline", "Border", "Shadow", "Inner shadow", "Filter", "Backdrop filter", "Text stroke"];

export const TOKEN_KINDS = [
  "Color",
  "Opacity",
  "Radius",
  "Spacing",
  "Container",
  "Breakpoint",
  "Font family",
  "Font weight",
  "Font size",
  "Line height",
  "Letter spacing",
];

/// A few of the inspector's frame presets, with the sizes `CanvasInspector` gives them.
export const PRESETS: [group: string, name: string, w: number, h: number][] = [
  ["Phone", "iPhone 16", 393, 852],
  ["Phone", "Android compact", 360, 800],
  ["Tablet", "iPad mini", 744, 1133],
  ["Desktop", "MacBook Air", 1280, 832],
  ["Desktop", "Wireframe", 1440, 1024],
  ["Presentation", "16:9", 1920, 1080],
  ["Paper", "A4", 794, 1123],
  ["Social media", "Story", 1080, 1920],
];

/// What a drawn design is painted with. The token sets on the Canvas page swap these.
export type Look = {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  accentInk: string;
  radius: number;
  font: string;
  thumbs: [string, string, string];
};

export const LOOK: Look = {
  bg: "#FBFAF7",
  surface: "#FFFFFF",
  ink: "#16140F",
  muted: "#7A756B",
  line: "#ECE8DF",
  accent: "#16140F",
  accentInk: "#FFFFFF",
  radius: 12,
  font: "var(--font-inter), sans-serif",
  thumbs: ["#E9D8B8", "#C9D7CF", "#D9CFE6"],
};

/// A drawn app window: the site's frame fill and shadow, the app's palette.
export function Shot({ label, className, style, children }: { label: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div
      data-app-window
      role="img"
      aria-label={label}
      style={style}
      className={cx("app-frame relative flex flex-col overflow-hidden rounded-[12px] font-sans text-ui text-foreground shadow-window", className)}
    >
      <div aria-hidden="true" className="contents">{children}</div>
    </div>
  );
}

function Lights() {
  return (
    <span className="flex shrink-0 gap-2 pl-4">
      <i className="size-3 rounded-full bg-[#FF5F57]" />
      <i className="size-3 rounded-full bg-[#FEBC2E]" />
      <i className="size-3 rounded-full bg-[#28C840]" />
    </span>
  );
}

/// The window's top row in the Design workspace: lights, switch, canvas tabs.
export function TitleBar({ tabs = ["checkout", "onboarding"], active = 0, workspace = "Design" }: { tabs?: string[]; active?: number; workspace?: "Coding" | "Design" }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-3">
      <Lights />
      <WorkspaceSwitch value={workspace} />
      <div className="flex min-w-0 items-center gap-1">
        {tabs.map((t, i) => (
          <span
            key={t}
            className={cx("flex h-7 items-center gap-1.5 rounded-md px-2.5", i === active ? "bg-surface-thumb text-foreground" : "text-muted-foreground")}
          >
            <Doodle className="size-3 opacity-70" />
            {t}
          </span>
        ))}
        <Plus className="ml-1 size-3.5 text-muted-foreground" />
      </div>
    </div>
  );
}

function Segment({ options, active }: { options: string[]; active: string }) {
  return (
    <div className="flex rounded-md bg-foreground/6 p-0.5">
      {options.map((o) => (
        <span key={o} className={cx("flex h-6 flex-1 items-center justify-center rounded-[5px] text-[12px]", o === active ? "bg-surface-thumb text-foreground shadow-[0_1px_2px_#0000001f]" : "text-muted-foreground")}>
          {o}
        </span>
      ))}
    </div>
  );
}

type Row = { name: string; kind: "Frame" | "Rectangle" | "Text"; depth: number; on?: boolean };
const LAYERS: Row[] = [
  { name: "Checkout", kind: "Frame", depth: 0 },
  { name: "Header", kind: "Text", depth: 1 },
  { name: "Line items", kind: "Frame", depth: 1 },
  { name: "Totals", kind: "Frame", depth: 1 },
  { name: "Pay button", kind: "Rectangle", depth: 1, on: true },
  { name: "Order placed", kind: "Frame", depth: 0 },
];
const GLYPH = { Frame, Rectangle: Square, Text: Type };

/// The editor's left column: file name, Design / Theme, pages, layer tree.
/// A layer row's highlight drawn as its own element, so a timeline can fade it in.
export type RowMark = { name: string; className?: string; style?: CSSProperties };

export function NavPanel({ mode = "Design", name = "checkout", children, className, mark }: { mode?: "Design" | "Theme"; name?: string; children?: ReactNode; className?: string; mark?: RowMark }) {
  return (
    <div className={cx("flex w-[236px] shrink-0 flex-col", className)}>
      <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-hairline px-3">
        <Layers className="size-[15px] text-muted-foreground" />
        <strong className="font-[550]">{name}</strong>
      </div>
      <div className="mx-2.5 mt-3 mb-1">
        <Segment options={["Design", "Theme"]} active={mode} />
      </div>
      {mode === "Theme" ? (
        children
      ) : (
        <>
          <div className="flex min-h-8 items-center justify-between px-2.5 pt-1 text-muted-foreground">
            <span className="flex items-center gap-1.5"><ChevronDown className="size-[13px]" />Pages</span>
            <Plus className="size-3.5" />
          </div>
          {["Mobile", "Desktop", "Handoff"].map((p, i) => (
            <span key={p} className={cx("mx-1.5 flex h-7 items-center rounded-md px-[22px]", i === 0 ? "bg-surface-thumb" : "text-muted-foreground")}>{p}</span>
          ))}
          <div className="mt-2 flex min-h-8 items-center px-2.5 text-muted-foreground">Layers</div>
          {LAYERS.map((l) => {
            const Icon = GLYPH[l.kind];
            return (
              <span
                key={l.name}
                style={{ paddingLeft: 10 + l.depth * 16 }}
                className={cx("relative mx-1.5 flex h-7 items-center gap-[7px] rounded-md pr-2", l.on && !mark ? "bg-surface-thumb text-foreground" : "text-foreground/85")}
              >
                {mark?.name === l.name && <i className={cx("absolute inset-0 rounded-md bg-surface-thumb", mark.className)} style={mark.style} />}
                {l.kind === "Frame" ? <ChevronDown className="relative size-3 text-muted-foreground" /> : <span className="w-3" />}
                <Icon className="relative size-3.5 text-muted-foreground" />
                <span className="relative">{l.name}</span>
              </span>
            );
          })}
        </>
      )}
    </div>
  );
}

/// The floating tool bar, bottom centre of the board. Select and Hand split from the drawing tools.
export function Toolbar({ active = "Select", className, onPick, children }: { active?: ToolName | null; className?: string; onPick?: (t: ToolName) => void; children?: ReactNode }) {
  return (
    <div
      role={onPick ? "toolbar" : undefined}
      aria-label={onPick ? "Canvas tools" : undefined}
      className={cx(!className?.includes("absolute") && "relative", "flex items-center gap-0.5 rounded-lg border border-hairline bg-popover p-1 shadow-[0_8px_24px_-8px_#00000066,0_0_0_1px_#0000000a]", className)}
    >
      {children}
      {TOOLS.map(({ name, key, icon: Icon }, i) => {
        const on = name === active;
        const look = cx(
          "relative flex size-8 items-center justify-center rounded-md text-muted-foreground",
          i === 2 && "ml-[13px] before:absolute before:-left-2 before:h-4 before:border-l before:border-hairline",
          on && "bg-foreground/10 text-foreground",
        );
        return onPick ? (
          <button
            key={name}
            type="button"
            aria-pressed={on}
            aria-label={`${name} (${key})`}
            onClick={() => onPick(name)}
            className={cx(look, "cursor-pointer hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring")}
          >
            <Icon className="size-[18px]" />
          </button>
        ) : (
          <span key={name} className={look}>
            <Icon className="size-[18px]" />
          </span>
        );
      })}
    </div>
  );
}

/// A layer under the Select tool: hairline outline, four handles, its size beneath.
export function Selected({ size, children, className }: { size?: string; children: ReactNode; className?: string }) {
  const handle = "absolute size-[7px] border border-[#4b93ff] bg-white";
  return (
    <div className={cx("relative", className)}>
      {children}
      <div className="pointer-events-none absolute -inset-[3px] border border-[#4b93ff] bg-[#4b93ff14]">
        <i className={cx(handle, "-top-1 -left-1")} />
        <i className={cx(handle, "-top-1 -right-1")} />
        <i className={cx(handle, "-bottom-1 -left-1")} />
        <i className={cx(handle, "-right-1 -bottom-1")} />
        {size && (
          <span className="absolute -bottom-6 left-1/2 -translate-x-1/2 rounded-[3px] bg-[#2166ba] px-1.5 py-px font-mono text-[10px] leading-4 whitespace-nowrap text-white">{size}</span>
        )}
      </div>
    </div>
  );
}

/// The frame's name above its top-left corner, as the board labels it.
export function FrameLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[11px] leading-none text-muted-foreground">{children}</span>;
}

/// Phone designs are laid out once at this size and scaled to the width asked
/// for, so their type and spacing keep their proportions at any size.
const DESIGN_W = 300;
const DESIGN_H = 580;

function Scaled({ width, className, children }: { width: number; className?: string; children: ReactNode }) {
  const k = width / DESIGN_W;
  return (
    <div style={{ width, height: DESIGN_H * k }} className={cx("relative shrink-0", className)}>
      <div style={{ transform: `scale(${k})`, transformOrigin: "top left" }} className="absolute top-0 left-0">{children}</div>
    </div>
  );
}

/// A checkout screen drawn as a design on the board. `look` paints it; `select`
/// puts the Pay button under the Select tool.
export function Checkout({ look = LOOK, select = false, width = 300, className, pay: paySlot }: { look?: Look; select?: boolean; width?: number; className?: string; pay?: ReactNode }) {
  const r = look.radius;
  const pay = (
    <div
      style={{ background: look.accent, color: look.accentInk, borderRadius: r }}
      className="flex h-11 items-center justify-center text-[14px] font-semibold transition-[background-color,border-radius] duration-500"
    >
      Pay $86.00
    </div>
  );
  return (
    <Scaled width={width} className={className}>
    <div
      style={{ width: DESIGN_W, height: DESIGN_H, background: look.bg, color: look.ink, fontFamily: look.font }}
      className="flex flex-col px-5 pt-6 pb-5 shadow-[0_1px_3px_#00000026] transition-[background-color,color] duration-500"
    >
      <div className="flex items-center justify-between text-[11px] font-semibold" style={{ color: look.ink }}>
        <span>9:41</span>
        <span className="flex gap-1"><i className="h-2 w-3 rounded-[2px] bg-current opacity-80" /><i className="h-2 w-4 rounded-[2px] bg-current" /></span>
      </div>
      <div className="mt-6 text-[22px] leading-7 font-semibold tracking-[-0.02em]">Checkout</div>
      <div className="mt-1 text-[12px]" style={{ color: look.muted }}>3 items · Ships Tuesday</div>
      <div className="mt-5 flex flex-col gap-3">
        {[
          ["Linen overshirt", "$48.00"],
          ["Canvas tote", "$22.00"],
          ["Wool socks", "$16.00"],
        ].map(([n, p], i) => (
          <div key={n} style={{ background: look.surface, borderRadius: r, borderColor: look.line }} className="flex items-center gap-3 border p-2.5 transition-[background-color,border-radius] duration-500">
            <i style={{ background: look.thumbs[i], borderRadius: Math.max(4, r - 4) }} className="size-10 shrink-0 transition-[background-color,border-radius] duration-500" />
            <span className="flex-1 text-[13px] font-medium">{n}</span>
            <span className="text-[13px]" style={{ color: look.muted }}>{p}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-col gap-1.5 border-t pt-4 text-[12px]" style={{ borderColor: look.line, color: look.muted }}>
        <span className="flex justify-between"><span>Subtotal</span><span>$86.00</span></span>
        <span className="flex justify-between"><span>Shipping</span><span>Free</span></span>
        <span className="flex justify-between text-[14px] font-semibold" style={{ color: look.ink }}><span>Total</span><span>$86.00</span></span>
      </div>
      <div className="mt-auto pt-5">{paySlot ?? (select ? <Selected size="345 × 44">{pay}</Selected> : pay)}</div>
    </div>
    </Scaled>
  );
}

/// One inspector field: a small label over a value well.
export function Well({ label, value, token, swatch }: { label?: string; value: string; token?: string; swatch?: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      {label && <span className="text-[11px] text-muted-foreground">{label}</span>}
      <span className="flex h-7 min-w-0 items-center gap-1.5 rounded-md bg-foreground/6 px-2 text-[12px]">
        {swatch && <i className="size-3.5 shrink-0 rounded-[3px] ring-1 ring-foreground/15" style={{ background: swatch }} />}
        {token ? (
          <span className="truncate rounded-[4px] bg-[#4b93ff26] px-1.5 text-[11px] leading-[18px] text-[#7fb2ff] light:text-[#2166ba]">{token}</span>
        ) : (
          <span className="truncate">{value}</span>
        )}
      </span>
    </span>
  );
}

export function InspectorSection({ title, children, end }: { title: string; children: ReactNode; end?: ReactNode }) {
  return (
    <div className="border-b border-hairline px-3 py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-[550]">{title}</span>
        {end}
      </div>
      {children}
    </div>
  );
}

/// The right column with the Pay button selected: its size, layout, radius and effects.
export function Inspector({ className, accent = "#16140F" }: { className?: string; accent?: string }) {
  return (
    <div className={cx("flex w-[252px] shrink-0 flex-col border-l border-hairline bg-background", className)}>
      <div className="flex h-[42px] shrink-0 items-center justify-end gap-1 border-b border-hairline px-3 text-muted-foreground">
        100% <ChevronDown className="size-3" />
      </div>
      <InspectorSection title="Rectangle">
        <div className="grid grid-cols-2 gap-2">
          <Well label="W" value="345" />
          <Well label="H" value="44" />
          <Well label="X" value="24" />
          <Well label="Y" value="692" />
        </div>
      </InspectorSection>
      <InspectorSection title="Radius">
        <Well value="12" token="radius.md" />
      </InspectorSection>
      <InspectorSection title="Fill" end={<Eye className="size-3.5 text-muted-foreground" />}>
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <Well value="Solid" />
          <Well value="" token="ink" swatch={accent} />
        </div>
      </InspectorSection>
      <InspectorSection title="Shadow" end={<Eye className="size-3.5 text-muted-foreground" />}>
        <div className="grid grid-cols-4 gap-1.5">
          <Well label="X" value="0" />
          <Well label="Y" value="4" />
          <Well label="Blur" value="12" />
          <Well label="Spread" value="0" />
        </div>
      </InspectorSection>
      <div className="flex items-center justify-between px-3 py-3 text-muted-foreground">
        <span>Add effect</span>
        <Plus className="size-3.5" />
      </div>
    </div>
  );
}

/// The Flex section, for a frame laid out as a column.
export function FlexPanel({ className }: { className?: string }) {
  return (
    <div className={cx("flex w-[252px] flex-col bg-background", className)}>
      <InspectorSection title="Layout">
        <div className="grid grid-cols-2 gap-2">
          <Well label="Rotate" value="0°" />
          <Well label="Opacity" value="100%" />
          <Well label="Overflow" value="Hidden" />
          <Well label="Display" value="Flex" />
        </div>
      </InspectorSection>
      <InspectorSection title="Flex">
        <div className="flex flex-col gap-2">
          <Segment options={["Row", "Column"]} active="Column" />
          <div className="grid grid-cols-2 gap-2">
            <Well label="Align" value="Stretch" />
            <Well label="Justify" value="Start" />
            <Well label="Gap" value="" token="space.3" />
            <Well label="Padding" value="" token="space.5" />
          </div>
          <Well label="Wrap" value="No wrap" />
        </div>
      </InspectorSection>
    </div>
  );
}

/// The effect stack: every kind the inspector offers, a few switched on.
export function EffectsPanel({ className, on = ["Fill", "Shadow", "Backdrop filter"] }: { className?: string; on?: string[] }) {
  return (
    <div className={cx("flex w-[252px] flex-col bg-background", className)}>
      <InspectorSection title="Fill" end={<Eye className="size-3.5 text-muted-foreground" />}>
        <div className="flex flex-col gap-2">
          <Segment options={["Solid", "Linear", "Radial", "Conic"]} active="Linear" />
          <div className="relative h-3 rounded-full" style={{ background: "linear-gradient(90deg,#FFB86B,#FF5F8F 50%,#7C6CFF)" }}>
            {[0, 50, 100].map((at) => (
              <i key={at} className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_3px_#00000066]" style={{ left: `${at}%` }} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Well label="Angle" value="90°" />
            <Well label="Opacity" value="100%" />
          </div>
        </div>
      </InspectorSection>
      {EFFECTS.slice(1).map((e) => (
        <div key={e} className="flex h-9 items-center justify-between border-b border-hairline px-3">
          <span className={on.includes(e) ? "text-foreground" : "text-muted-foreground"}>{e}</span>
          <span className={cx("flex h-4 w-7 items-center rounded-full p-0.5", on.includes(e) ? "justify-end bg-[#4b93ff]" : "bg-foreground/12")}>
            <i className="size-3 rounded-full bg-white" />
          </span>
        </div>
      ))}
    </div>
  );
}

export type TokenRow = { kind: string; name: string; value: string };

/// The Theme tab's token list, grouped by kind, colours drawn as swatches.
export function TokenList({ tokens, source, className }: { tokens: TokenRow[]; source?: string; className?: string }) {
  const kinds = [...new Set(tokens.map((t) => t.kind))];
  return (
    <div className={cx("flex min-h-0 flex-col", className)}>
      <div className="flex min-h-8 items-center justify-between px-2.5 pt-2">
        <span className="font-[550]">Theme tokens</span>
        <Plus className="size-3.5 text-muted-foreground" />
      </div>
      <div className="mx-2.5 my-1.5 flex h-7 items-center gap-1.5 rounded-md bg-foreground/6 px-2 text-muted-foreground">
        <Search className="size-3.5" />
        Search tokens…
      </div>
      {source && <div className="px-2.5 pb-1 text-[11px] text-muted-foreground">Imported from {source}</div>}
      {kinds.map((k) => (
        <div key={k} className="pt-1.5">
          <div className="px-2.5 pb-0.5 text-[11px] text-muted-foreground">{k}</div>
          {tokens
            .filter((t) => t.kind === k)
            .map((t) => (
              <div key={t.name} className="mx-1.5 flex h-7 items-center gap-2 rounded-md px-2">
                {k === "Color" ? (
                  <i className="size-3.5 shrink-0 rounded-[3px] ring-1 ring-foreground/15 transition-colors duration-500" style={{ background: t.value }} />
                ) : (
                  <i className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{t.value}</span>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

/// A numbered comment pin.
export function Pin({ n, className, style }: { n: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      style={{ background: INK, ...style }}
      className={cx("flex size-7 items-center justify-center rounded-full rounded-bl-none text-[12px] font-semibold text-white shadow-[0_2px_8px_#168bf066,0_0_0_2px_#fff]", className)}
    >
      {n}
    </span>
  );
}

/// The comment box beside a pin, as it reads before sending.
export function CommentBox({ text, to = "Canvas chat", className, style }: { text: string; to?: string; className?: string; style?: CSSProperties }) {
  return (
    <div style={style} className={cx("w-[270px] rounded-lg border border-hairline bg-popover p-2 shadow-[0_12px_32px_-12px_#00000080]", className)}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-[13px] leading-5 text-foreground">{text}</span>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <ArrowUp className="size-4" />
        </span>
      </div>
      <small className="mt-1 block text-[11px] text-muted-foreground">To {to}</small>
    </div>
  );
}

/// Freehand pen ink. `className` takes the draw-on animation when wanted.
export function Ink({ d, viewBox, className, pathClassName }: { d: string; viewBox: string; className?: string; pathClassName?: string }) {
  return (
    <svg viewBox={viewBox} fill="none" className={cx("pointer-events-none overflow-visible", className)} aria-hidden="true">
      <path d={d} pathLength={1} stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className={pathClassName} />
    </svg>
  );
}

/// A loop drawn round a button-sized target, overshooting where it began.
export const LOOP = "M20 30C14 12 60 4 150 6C250 8 300 18 296 34C292 52 220 60 150 58C70 56 12 50 14 32C15 22 30 16 52 13";

/// The canvas's docked conversation: tabs, the comment sent with its
/// snapshot and path, and the agent working in code.
export function ChatDock({ className, path = "storefront/canvases/flows/checkout.canvas.json", reply = true, note = "Pay button sits below the fold on iPhone 16. Pin it to the bottom." }: { className?: string; path?: string; reply?: boolean; note?: string }) {
  return (
    <div className={cx("flex w-[320px] shrink-0 flex-col border-l border-hairline bg-background", className)}>
      <div className="flex h-[42px] shrink-0 items-center gap-1 border-b border-hairline px-1.5">
        <span className="flex h-7 items-center gap-1.5 rounded-md bg-surface-thumb px-2.5">Canvas chat</span>
        <span className="flex h-7 items-center rounded-md px-2.5 text-muted-foreground">Empty state copy</span>
        <Plus className="ml-auto mr-1.5 size-3.5 text-muted-foreground" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-3">
        <div className="ml-6 flex flex-col items-end gap-1.5">
          <div className="relative h-[92px] w-[132px] overflow-hidden rounded-lg bg-[#FBFAF7] ring-1 ring-foreground/10">
            <div className="absolute inset-x-3 top-3 h-2 w-14 rounded-sm bg-[#16140F]" />
            {[22, 38, 54].map((t) => (
              <div key={t} className="absolute inset-x-3 h-3 rounded-[3px] border border-[#ECE8DF] bg-white" style={{ top: t }} />
            ))}
            <div className="absolute inset-x-3 bottom-2 h-3.5 rounded-[3px] bg-[#16140F]" />
            <svg viewBox="0 0 132 92" className="absolute inset-0" fill="none">
              <ellipse cx="66" cy="82" rx="60" ry="9" stroke={INK} strokeWidth="2" />
            </svg>
          </div>
          <div className="rounded-xl bg-card px-3 py-2 text-chat leading-[1.45] text-card-foreground">
            {note}
            <span className="mt-1.5 block font-mono text-[10.5px] leading-4 break-all text-muted-foreground">Canvas: {path}</span>
          </div>
        </div>
        {reply && (
          <div className="flex flex-col gap-1.5 text-[12.5px]">
            <span className="flex items-center gap-1.5 text-muted-foreground"><FileBraces className="size-3.5" />Read checkout.canvas.json</span>
            <span className="flex items-center gap-1.5 text-muted-foreground"><CodeXml className="size-3.5" />Edit CheckoutSheet.tsx <span className="text-accent-add">+14</span> <span className="text-destructive">−6</span></span>
            <p className="mt-1 text-chat leading-[1.55] text-foreground/90">
              Moved the button into a sticky footer with safe-area padding. It stays visible above the home indicator now.
            </p>
          </div>
        )}
      </div>
      <div className="m-2.5 mt-0 flex h-10 shrink-0 items-center justify-between rounded-xl bg-composer px-3 text-muted-foreground">
        Message…
        <span className="flex size-6 items-center justify-center rounded-full bg-foreground/10"><ArrowUp className="size-3.5" /></span>
      </div>
    </div>
  );
}

/// The whole editor: left column, the board with a checkout frame, and
/// either the inspector or the docked chat on the right.
export function Editor({
  right = "inspector",
  look = LOOK,
  markup = false,
  tool = "Select",
  width = 1120,
  height = 700,
  label = "Carbon's Design workspace: a checkout screen on the canvas, its layers on the left and the Pay button's styles on the right.",
  boardExtra,
}: {
  right?: "inspector" | "chat" | "none";
  look?: Look;
  markup?: boolean;
  tool?: ToolName;
  width?: number;
  height?: number;
  label?: string;
  boardExtra?: ReactNode;
}) {
  return (
    <Shot label={label} style={{ width, height }}>
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <NavPanel />
        <div className="app-sheet relative flex min-w-0 flex-1 overflow-hidden rounded-tl-[10px] border-t border-l border-edge-surface">
          <div className="relative min-w-0 flex-1 overflow-hidden">
            <div className="absolute top-12 left-14">
              <FrameLabel>Checkout · iPhone 16</FrameLabel>
              <Checkout look={look} select={!markup} width={276} />
            </div>
            <div className="absolute top-12 left-[372px] opacity-90">
              <FrameLabel>Order placed</FrameLabel>
              <OrderPlaced look={look} />
            </div>
            {markup && (
              <>
                <Ink d={LOOP} viewBox="0 0 310 64" className="absolute top-[528px] left-[42px] w-[300px]" />
                <Pin n={1} className="absolute top-[508px] left-[318px]" />
              </>
            )}
            {boardExtra}
            <Toolbar active={tool} className="absolute bottom-3.5 left-1/2 -translate-x-1/2" />
          </div>
          {right === "inspector" && <Inspector accent={look.accent} />}
          {right === "chat" && <ChatDock />}
        </div>
      </div>
    </Shot>
  );
}

/// The board alone, phone-sized: what the variant pages show where the whole
/// editor would shrink past reading.
export function BoardShot({ look = LOOK, markup = false, width = 400, height = 620, label = "A checkout screen on the Carbon canvas with the floating tool bar beneath it." }: { look?: Look; markup?: boolean; width?: number; height?: number; label?: string }) {
  return (
    <Shot label={label} style={{ width, height }}>
      <div className="app-sheet relative flex-1 overflow-hidden">
        <div className="absolute top-8 left-1/2 -translate-x-1/2">
          <FrameLabel>Checkout · iPhone 16</FrameLabel>
          <Checkout look={look} select={!markup} width={268} />
        </div>
        {markup && (
          <>
            <Ink d={LOOP} viewBox="0 0 310 64" className="absolute top-[498px] left-[50px] w-[300px]" />
            <Pin n={1} className="absolute top-[478px] left-[330px]" />
          </>
        )}
        <Toolbar active={markup ? "Pen" : "Select"} className="absolute bottom-3.5 left-1/2 -translate-x-1/2 scale-90" />
      </div>
    </Shot>
  );
}

/// The second frame on the board: a confirmation screen.
export function OrderPlaced({ look = LOOK, width = 220 }: { look?: Look; width?: number }) {
  return (
    <Scaled width={width}>
    <div style={{ width: DESIGN_W, height: DESIGN_H, background: look.bg, color: look.ink, fontFamily: look.font }} className="flex flex-col items-center px-5 pt-16 text-center shadow-[0_1px_3px_#00000026] transition-colors duration-500">
      <span style={{ background: look.accent, color: look.accentInk }} className="flex size-12 items-center justify-center rounded-full text-[20px] transition-colors duration-500">✓</span>
      <span className="mt-4 text-[17px] font-semibold tracking-[-0.02em]">Order placed</span>
      <span className="mt-1 text-[11px]" style={{ color: look.muted }}>We will email you when it ships.</span>
      <span className="mt-auto mb-6 w-full border py-2 text-[12px] font-medium" style={{ borderColor: look.line, borderRadius: look.radius }}>Track order</span>
    </div>
    </Scaled>
  );
}

type Card = { name: string; folder: string; edited: string; tint: string };
const CARDS: Card[] = [
  { name: "checkout", folder: "flows", edited: "Edited 4 min ago", tint: "#E9D8B8" },
  { name: "onboarding", folder: "flows", edited: "Edited 1 h ago", tint: "#C9D7CF" },
  { name: "settings", folder: "flows", edited: "Edited yesterday", tint: "#D9CFE6" },
  { name: "launch-hero", folder: "marketing", edited: "Edited 2 days ago", tint: "#F3C9B6" },
  { name: "pricing", folder: "marketing", edited: "Edited 3 days ago", tint: "#CFE0F3" },
  { name: "empty-states", folder: "", edited: "Edited last week", tint: "#E6E1D3" },
];

/// The canvas library: Dashboard and Archive, folders, a project filter and grid view.
export function Library({ width = 980, height = 560, view = "grid" }: { width?: number; height?: number; view?: "grid" | "list" }) {
  return (
    <Shot label="The canvas library: canvases from every attached project, grouped in folders, with an Archive beside the Dashboard." style={{ width, height }}>
      <TitleBar tabs={["checkout"]} active={-1} />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[208px] shrink-0 flex-col gap-0.5 px-1.5 pt-2">
          <span className="flex h-7 items-center gap-2 rounded-md bg-surface-thumb px-2"><LayoutGrid className="size-3.5" />Dashboard</span>
          <span className="flex h-7 items-center gap-2 rounded-md px-2 text-muted-foreground"><Archive className="size-3.5" />Archive</span>
          <span className="mt-4 px-2 pb-1 text-[11px] text-muted-foreground">storefront</span>
          <span className="flex h-7 items-center gap-2 rounded-md px-2"><FolderOpen className="size-3.5 text-muted-foreground" />flows</span>
          <span className="flex h-7 items-center gap-2 rounded-md px-2"><Folder className="size-3.5 text-muted-foreground" />marketing</span>
          <span className="mt-4 px-2 pb-1 text-[11px] text-muted-foreground">atlas</span>
          <span className="flex h-7 items-center gap-2 rounded-md px-2"><Folder className="size-3.5 text-muted-foreground" />reports</span>
        </div>
        <div className="app-sheet flex min-w-0 flex-1 flex-col rounded-tl-[10px] border-t border-l border-edge-surface">
          <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-hairline px-4">
            <strong className="font-[550]">Dashboard</strong>
            <span className="ml-auto flex h-7 items-center gap-1.5 rounded-md bg-foreground/6 px-2.5">All projects <ChevronDown className="size-3" /></span>
            <span className="flex rounded-md bg-foreground/6 p-0.5">
              <span className={cx("flex size-6 items-center justify-center rounded-[5px]", view === "list" ? "bg-surface-thumb" : "text-muted-foreground")}><List className="size-3.5" /></span>
              <span className={cx("flex size-6 items-center justify-center rounded-[5px]", view === "grid" ? "bg-surface-thumb" : "text-muted-foreground")}><LayoutGrid className="size-3.5" /></span>
            </span>
            <span className="flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-primary-foreground"><Plus className="size-3.5" />New canvas</span>
          </div>
          <div className="grid grid-cols-3 gap-4 p-4">
            {CARDS.map((c) => (
              <div key={c.name} className="flex flex-col gap-2">
                <div className="relative aspect-[16/10] overflow-hidden rounded-lg ring-1 ring-foreground/10" style={{ background: c.tint }}>
                  <i className="absolute top-[18%] left-[12%] h-[64%] w-[22%] rounded-[4px] bg-white/85" />
                  <i className="absolute top-[18%] left-[40%] h-[64%] w-[22%] rounded-[4px] bg-white/60" />
                  <i className="absolute top-[18%] left-[68%] h-[40%] w-[20%] rounded-[4px] bg-white/40" />
                </div>
                <span className="flex flex-col">
                  <span>{c.name}</span>
                  <span className="text-[11px] text-muted-foreground">{c.folder ? c.folder + " · " : ""}{c.edited}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Shot>
  );
}

/// The repo with its `canvases` folder: plain files next to the code.
export function RepoTree({ className, highlight = "checkout.canvas.json" }: { className?: string; highlight?: string }) {
  const rows: [depth: number, name: string, folder?: "open" | "shut"][] = [
    [0, "storefront", "open"],
    [1, "canvases", "open"],
    [2, ".archive", "shut"],
    [2, "flows", "open"],
    [3, "checkout.canvas.json"],
    [3, "onboarding.canvas.json"],
    [2, "marketing", "open"],
    [3, "launch-hero.canvas.json"],
    [1, "src", "shut"],
    [1, "DESIGN.md"],
    [1, "package.json"],
  ];
  return (
    <div className={cx("font-mono text-[12.5px] leading-[26px]", className)} role="img" aria-label="A project folder holding a canvases folder of .canvas.json files beside src and DESIGN.md.">
      {rows.map(([d, n, folder]) => (
        <div
          key={n}
          aria-hidden="true"
          style={{ paddingLeft: 12 + d * 18 }}
          className={cx(
            "flex items-center gap-2 pr-3",
            n === highlight ? "bg-[#168bf026] text-white light:text-[#0A0A0A]" : folder ? "text-white/85 light:text-[#0A0A0A]/85" : "text-white/60 light:text-[#0A0A0A]/60",
          )}
        >
          {folder ? <ChevronRight className={cx("size-3 opacity-60", folder === "open" && "rotate-90")} /> : <span className="w-3" />}
          {folder ? <Folder className="size-3.5 opacity-70" /> : <FileBraces className="size-3.5 opacity-60" />}
          {n}
        </div>
      ))}
    </div>
  );
}

/// A keycap, for tool shortcuts.
export function Key({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cx("inline-flex h-6 min-w-6 items-center justify-center rounded-[5px] border border-white/15 bg-white/8 px-1.5 font-mono text-[11px] text-white/85 shadow-[inset_0_-1px_0_#ffffff14] light:border-black/12 light:bg-black/4 light:text-[#0A0A0A]/80", className)}>
      {children}
    </kbd>
  );
}
