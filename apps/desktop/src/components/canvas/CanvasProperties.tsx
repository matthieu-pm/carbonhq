import type { ReactNode } from "react";

import type { CanvasFrame, CanvasNode } from "@/types/events";

type Box = { x: number; y: number; width: number; height: number; styles: Record<string, string>; text: string };
type Field = [label: string, value: string];

/// Read-only properties of the one picked frame or layer.
///
/// Every value is the frame's own computed style as the renderer measured it,
/// passed in as `box`. Nothing is defaulted: a property the browser reports as
/// its initial value (no gap, no fill, square corners) is left out rather than
/// shown as a zero, and with no measurement yet the panel shows the frame's
/// stored geometry and the layer's authored styles, labelled as such.
export default function CanvasProperties({
  frame,
  node,
  box,
  count,
}: {
  frame: CanvasFrame | null;
  node: CanvasNode | null;
  box: Box | null;
  count: number;
}) {
  if (count > 1) {
    return <Empty title={`${count} selected`} detail="Select one frame or layer to see its properties." />;
  }
  if (count === 0 || !frame) {
    return <Empty title="Nothing selected" detail="Select a frame or a layer on the board or in the layers list." />;
  }

  const name = node ? node.name.trim() || (node.kind === "text" ? "Text" : node.tag) : frame.name || "Untitled frame";
  const kind = node ? (node.kind === "text" ? "Text" : `<${node.tag}>`) : "Frame";
  const styles = box?.styles ?? {};

  const geometry: Field[] = node
    ? box ? [["Size", size(box.width, box.height)], ["Position", `${num(box.x)}, ${num(box.y)}`]] : []
    : [["Size", size(frame.geometry.width, frame.geometry.height)], ["Position", `${num(frame.geometry.x)}, ${num(frame.geometry.y)}`]];

  const layout = box ? compact([
    ["Display", layoutLabel(styles)],
    ["Positioning", styles.position === "static" ? "" : styles.position ?? ""],
    ["Align", flexOrGrid(styles) ? alignLabel(styles) : ""],
    ["Gap", meaningful(styles.gap, ["normal", "0px"])],
    ["Padding", sides(styles, "padding")],
    ["Margin", sides(styles, "margin")],
  ]) : [];

  const appearance = box ? compact([
    ["Fill", meaningful(styles["background-color"], ["rgba(0, 0, 0, 0)", "transparent"])],
    ["Image", meaningful(styles["background-image"], ["none"])],
    ["Radius", meaningful(styles["border-radius"], ["0px"])],
  ]) : [];

  const hasText = box ? box.text.trim().length > 0 : false;
  const text = box && hasText ? compact([
    ["Font", firstFamily(styles["font-family"])],
    ["Size", styles["font-size"] ? `${styles["font-size"]} / ${styles["line-height"] ?? "normal"}` : ""],
    ["Weight", styles["font-weight"] ?? ""],
    ["Tracking", meaningful(styles["letter-spacing"], ["normal", "0px"])],
    ["Colour", styles.color ?? ""],
  ]) : [];

  const authored = !box && node?.kind === "element" ? Object.entries(node.styles) as Field[] : [];
  const blank = !node && frame.content.nodes.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 text-ui select-text">
      <header className="px-1">
        <p className="truncate font-medium" title={name}>{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {kind}{node && <> in {frame.name || "Untitled frame"}</>}
        </p>
      </header>

      <Section title="Geometry" fields={geometry} />
      <Section title="Layout" fields={layout} />
      <Section title="Appearance" fields={appearance} />
      <Section title="Text" fields={text}>
        {box && hasText && node && (node.kind === "text" || node.children.every((child) => child.kind === "text")) && (
          <p className="line-clamp-4 rounded-lg bg-surface-well px-2 py-1.5 text-xs break-words whitespace-pre-wrap">{box.text.trim()}</p>
        )}
      </Section>
      <Section title="Authored styles" fields={authored} />

      {blank && <Note>This frame is blank.</Note>}
      {node && !box && <Note>Computed values appear once the frame has rendered.</Note>}
    </div>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center">
      <p className="text-ui font-medium">{title}</p>
      <p className="max-w-64 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="px-1 text-xs text-muted-foreground">{children}</p>;
}

function Section({ title, fields, children }: { title: string; fields: Field[]; children?: ReactNode }) {
  if (!fields.length && !children) return null;
  return (
    <section className="flex flex-col gap-0.5">
      <h3 className="mb-1 px-1 text-xs text-muted-foreground">{title}</h3>
      <dl className="flex flex-col gap-0.5">
        {fields.map(([label, value]) => (
          <div key={label} className="flex items-center gap-2 px-1 py-0.5">
            <dt className="w-20 shrink-0 text-xs text-muted-foreground">{label}</dt>
            <dd className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-surface-well px-2 py-1 font-mono text-xs">
              {isColour(value) && <span aria-hidden className="size-3 shrink-0 rounded-sm shadow-[inset_0_0_0_1px_var(--border)]" style={{ background: value }} />}
              <span className="truncate" title={value}>{value}</span>
            </dd>
          </div>
        ))}
      </dl>
      {children && <div className="px-1 pt-1">{children}</div>}
    </section>
  );
}

const compact = (fields: Field[]) => fields.filter(([, value]) => value !== "");

const meaningful = (value: string | undefined, initial: string[]) => (value && !initial.includes(value) ? value : "");

/// Up to two decimals, since computed boxes land on subpixels.
const num = (value: number) => String(Math.round(value * 100) / 100);
const size = (width: number, height: number) => `${num(width)} × ${num(height)}`;

const flexOrGrid = (styles: Record<string, string>) => /flex|grid/.test(styles.display ?? "");

function layoutLabel(styles: Record<string, string>): string {
  const display = styles.display ?? "";
  if (/flex/.test(display)) return `Flex, ${styles["flex-direction"] || "row"}`;
  if (/grid/.test(display)) return "Grid";
  return display;
}

function alignLabel(styles: Record<string, string>): string {
  const items = meaningful(styles["align-items"], ["normal"]);
  const justify = meaningful(styles["justify-content"], ["normal"]);
  return [items && `items ${items}`, justify && `justify ${justify}`].filter(Boolean).join(", ");
}

/// Four computed sides folded into CSS shorthand, or nothing where all are zero.
function sides(styles: Record<string, string>, prop: "padding" | "margin"): string {
  const [t, r, b, l] = ["top", "right", "bottom", "left"].map((side) => styles[`${prop}-${side}`] ?? "");
  if (![t, r, b, l].some(Boolean) || [t, r, b, l].every((v) => v === "0px" || v === "")) return "";
  if (t === r && r === b && b === l) return t;
  if (t === b && r === l) return `${t} ${r}`;
  return `${t} ${r} ${b} ${l}`;
}

function firstFamily(value: string | undefined): string {
  return value?.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
}

function isColour(value: string): boolean {
  return /^(#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/.test(value);
}
