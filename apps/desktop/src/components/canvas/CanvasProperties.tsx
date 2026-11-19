import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { frameStyles, resolveCanvasToken, sizedStyle, type CanvasEditIntent } from "@/lib/canvasEditing";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { invoke } from "@/lib/transport";
import type { BrowserCaptureDetails, CanvasAssetData, CanvasFrame, CanvasNode, CanvasTokenCatalog, CanvasTokenSource } from "@/types/events";

type Box = { x: number; y: number; width: number; height: number; styles: Record<string, string>; text: string };
type Field = [label: string, value: string];
type CapturedTokenSource = { checkout: CanvasTokenSource | null; theme: string[] };
type CapturedTokenLink = { names: string[]; value: string; unavailableAtCapture?: string[] };

export default function CanvasProperties({
  frame, node, box, parentStyles, count, canvasId, owner, catalog, tokenError, tokens, revision, busy, onEdit,
}: {
  frame: CanvasFrame | null;
  node: CanvasNode | null;
  box: Box | null;
  parentStyles?: Record<string, string>;
  count: number;
  canvasId?: string;
  owner?: string;
  catalog?: CanvasTokenCatalog | null;
  tokenError?: boolean;
  tokens?: Record<string, string>;
  revision?: number;
  busy?: boolean;
  onEdit?(edit: CanvasEditIntent, revision: number): void;
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

  const authored = node?.kind === "element" ? node.styles : node ? {} : frameStyles(frame);
  const computed: Record<string, string> = { ...styles, padding: sides(styles, "padding") };
  const declarations = new Map<string, string>();
  const defaults = new Set<string>();
  for (const { name, value, scope } of catalog?.tokens ?? []) {
    const unscoped = scope.every(part => /^(?::root|html|@(?:theme|layer|property)\b)/.test(part));
    if (!declarations.has(name) || unscoped && !defaults.has(name)) declarations.set(name, value);
    if (unscoped) defaults.add(name);
  }
  for (const [key, value] of Object.entries(tokens ?? {})) declarations.set(key, value);
  const options = new Map([...declarations.keys()].flatMap(name => {
    const fallback = resolveCanvasToken(name, declarations);
    return fallback && !/[;{}]|url\s*\(/i.test(fallback) ? [[name, fallback] as const] : [];
  }));
  const enabled = !busy && revision !== undefined && !!onEdit;
  const scope = `${frame.id}:${node?.id ?? ""}`;
  const field = (property: string, label: string) => <PropertyInput
    key={`${scope}:${property}`} label={label} revision={revision} disabled={!enabled}
    value={authored[property] ?? computed[property] ?? ""}
    options={[...options].filter(([name, value]) => /^--[\w-]+$/.test(name) && CSS.supports(property, value))}
    normalize={(value) => {
      const linked = options.get(value);
      if (linked && /^--[\w-]+$/.test(value) && CSS.supports(property, linked)) return `var(${value}, ${linked})`;
      const css = /^-?(?:\d+|\d*\.\d+)$/.test(value) && ["width", "height", "padding", "gap", "border-radius", "font-size", "letter-spacing"].includes(property) ? `${value}px` : value;
      return css && !/[;{}]|url\s*\(/i.test(css) && CSS.supports(property, css) ? css : null;
    }}
    onCommit={(value, basis) => onEdit?.({
      kind: "style", frameId: frame.id, nodeId: node?.id ?? null, label: `Change ${label.toLowerCase()}`,
      styles: node && (property === "width" || property === "height")
        ? { ...(styles.display === "inline" && { display: "inline-block" }), ...sizedStyle(property, value, parentStyles, node.kind === "text" ? "static" : styles.position) }
        : { [property]: value },
    }, basis)}
  />;
  const geometry = (axis: "x" | "y" | "width" | "height", label: string) => <PropertyInput
    key={`${scope}:${axis}`} label={label} revision={revision} disabled={!enabled} value={num(frame.geometry[axis])}
    normalize={(value) => {
      const number = Number(value);
      if (!value || !Number.isFinite(number)) return null;
      if (axis === "x" || axis === "y") return String(number);
      return Number.isInteger(number) && number >= 1 && number <= 10_000 ? String(number) : null;
    }}
    onCommit={(value, basis) => onEdit?.({ kind: "frames", geometry: { [frame.id]: { [axis]: Number(value) } }, label: `Change frame ${label.toLowerCase()}` }, basis)}
  />;
  const blank = !node && frame.content.nodes.length === 0;
  const capture = (frame as CanvasFrame & { capture?: BrowserCaptureDetails }).capture;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 text-ui select-text">
      <header className="px-1">
        <p className="truncate font-medium" title={name}>{name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {kind}{node && <> in {frame.name || "Untitled frame"}</>}
        </p>
      </header>

      {capture && canvasId && <CaptureProperties key={capture.originalAssetId} capture={capture} canvasId={canvasId} owner={owner} />}
      <Section title="Geometry" fields={node && box ? [["Position", `${num(box.x)}, ${num(box.y)}`]] : []}>
        {node ? <>{field("width", "Width")}{field("height", "Height")}</> : <>{geometry("width", "Width")}{geometry("height", "Height")}{geometry("x", "X")}{geometry("y", "Y")}</>}
      </Section>
      <Section title="Layout" fields={box ? compact([
        ["Display", layoutLabel(styles)], ["Align", flexOrGrid(styles) ? alignLabel(styles) : ""],
      ]) : []}>
        {field("padding", "Padding")}{field("gap", "Gap")}
      </Section>
      <Section title="Appearance" fields={box ? compact([["Image", meaningful(styles["background-image"], ["none"])]]) : []}>
        {field("background-color", "Fill")}{field("border-radius", "Radius")}{field("border", "Border")}
      </Section>
      <TokenProperties frame={frame} node={node} box={box} catalog={catalog} tokenError={tokenError} />
      <Section title="Text" fields={[]}>
        {field("font-family", "Font")}{field("font-size", "Font size")}{field("font-weight", "Weight")}
        {field("line-height", "Line height")}{field("letter-spacing", "Tracking")}{field("text-align", "Alignment")}{field("color", "Colour")}
      </Section>

      {blank && <Note>This frame is blank.</Note>}
      {node && !box && <Note>Computed values appear once the frame has rendered.</Note>}
    </div>
  );
}

function PropertyInput({ label, value, revision, disabled, options = [], normalize, onCommit }: {
  label: string;
  value: string;
  revision?: number;
  disabled: boolean;
  options?: [string, string][];
  normalize(value: string): string | null;
  onCommit(value: string, revision: number): void;
}) {
  const listId = useId();
  const basis = useRef<{ revision: number; value: string } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  return <div className="flex min-w-0 items-center gap-2 py-0.5">
    <label className="flex min-w-0 flex-1 items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Input className="h-7 px-2 font-mono text-xs md:text-xs" type="text" value={draft ?? value} disabled={disabled} aria-invalid={invalid}
        aria-label={label} list={options.length ? listId : undefined} spellCheck={false}
        onFocus={() => { if (revision !== undefined) basis.current = { revision, value }; }}
        onChange={(event) => { setDraft(event.target.value); setInvalid(false); }}
        onBlur={() => {
          const start = basis.current;
          basis.current = null;
          if (!start || draft === null || draft.trim() === start.value) { setDraft(null); return; }
          const next = normalize(draft.trim());
          if (next === null) { setInvalid(true); return; }
          setDraft(null);
          if (next !== start.value) onCommit(next, start.revision);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.stopPropagation(); basis.current = null; setDraft(null); setInvalid(false); event.currentTarget.blur(); }
          if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
        }}
      />
    </label>
    {options.length > 0 && <datalist id={listId}>{options.map(([key, fallback]) => <option key={key} value={key}>{fallback}</option>)}</datalist>}
    {invalid && <span role="status" className="text-xs text-destructive">Invalid value</span>}
  </div>;
}

function TokenProperties({ frame, node, box, catalog, tokenError }: { frame: CanvasFrame; node: CanvasNode | null; box: Box | null; catalog?: CanvasTokenCatalog | null; tokenError?: boolean }) {
  const source = (frame.content as { tokenSource?: CapturedTokenSource }).tokenSource;
  const capture = (frame as { capture?: BrowserCaptureDetails }).capture;
  const authored = node?.kind === "element" ? node.styles : node ? {} : frameStyles(frame);
  const references = (node as { tokenReferences?: Record<string, CapturedTokenLink | string[]> } | null)?.tokenReferences;
  const captured = references && typeof references === "object" && !Array.isArray(references) ? references : null;
  const properties = [...new Set([...Object.keys(authored), ...Object.keys(captured ?? {})])];
  const links = properties.flatMap(property => {
    const value = authored[property] ?? "";
    const stored = captured?.[property];
    const snapshot: CapturedTokenLink | undefined = Array.isArray(stored) ? { names: stored, value } : stored;
    const verified = Array.isArray(snapshot?.names) && typeof snapshot.value === "string" ? snapshot : null;
    const names = verified ? verified.names.filter(name => typeof name === "string") : [...new Set(
      [...value.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|(?<![\w\u0080-\u{10FFFF}-])var\(\s*(--[\w\u0080-\u{10FFFF}-]+)\s*(?=[,)])/giu)].flatMap(match => match[1] ?? []),
    )];
    const unavailable = verified?.unavailableAtCapture;
    const unavailableAtCapture = Array.isArray(unavailable) ? names.filter(name => unavailable.includes(name)) : [];
    return names.length ? [{ property, names, value: verified?.value ?? box?.styles[property] ?? value, unavailableAtCapture }] : [];
  });
  const sourcePath = typeof source?.checkout?.cwd === "string" ? source.checkout.cwd : undefined;
  const theme = Array.isArray(source?.theme) ? source.theme.filter(value => typeof value === "string").join(" · ") : "";
  const sameCheckout = !!catalog && (sourcePath ? catalog.source.cwd === sourcePath : !capture && !captured);
  const known = new Set(sameCheckout ? catalog.tokens.map(token => token.name) : []);
  const canCheck = sameCheckout && !catalog.incomplete;
  const unknown = capture && !capture.imageOnly && node?.kind === "element" && Object.keys(authored).some(key => !links.some(link => link.property === key));
  if (!links.length && !source && !unknown) return null;
  return <Section title="Token links" fields={compact([
    ["Checkout", sourcePath ?? ""],
    ["Theme", theme],
  ])}>
    {links.length > 0 && <ul className="divide-y divide-hairline">
      {links.map(({ property, names, value, unavailableAtCapture }) => {
        const missing = canCheck && names.some(name => !known.has(name));
        return <li key={property} className="py-1.5">
          <p className="text-xs text-muted-foreground">{property}</p>
          <p className="flex flex-wrap items-baseline justify-between gap-x-2 font-mono text-xs break-all">
            <span>{names.join(", ")}</span><span className="text-muted-foreground">{value}</span>
          </p>
          {missing && <p className="text-xs text-muted-foreground">Missing from project CSS</p>}
          {unavailableAtCapture.length > 0 && <p className="text-xs text-muted-foreground">Unavailable at capture · {unavailableAtCapture.join(", ")}</p>}
        </li>;
      })}
    </ul>}
    {links.length > 0 && tokenError && <p className="mt-1 text-xs text-muted-foreground">Couldn’t check links against project CSS.</p>}
    {links.length > 0 && catalog && !sameCheckout && <p className="mt-1 text-xs text-muted-foreground">{sourcePath ? "The token list is showing a different checkout." : "The capture has no recorded checkout."}</p>}
    {unknown && <p className="mt-1 text-xs text-muted-foreground">Token links are unknown for styles captured as computed values alone.</p>}
  </Section>;
}

function CaptureProperties({ capture, canvasId, owner }: { capture: BrowserCaptureDetails; canvasId: string; owner?: string }) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    void invoke<CanvasAssetData>("read_canvas_asset", { id: canvasId, assetId: capture.originalAssetId }, owner)
      .then(({ asset, data }) => { if (!cancelled) setImage(`data:${asset.mimeType};base64,${data}`); })
      .catch(() => { if (!cancelled) setError("Couldn’t open the original screenshot."); });
    return () => { cancelled = true; setImage(null); };
  }, [open, canvasId, capture.originalAssetId, owner]);
  const source = capture.source?.file;
  return <Section title="Capture" fields={compact([
    ["Content", capture.imageOnly ? "Image reference" : "Editable layers"],
    ["Page", capture.pagePath],
    ["Viewport", size(capture.viewport.width, capture.viewport.height)],
    ["Selector", capture.selector ?? ""],
    ["Source", source ? `${source}${capture.source?.line ? `:${capture.source.line}` : ""}` : ""],
  ])}>
    {capture.warnings.length > 0 && <ul className="mb-2 space-y-1 text-xs text-muted-foreground">
      {capture.warnings.map(warning => <li key={warning}>{warning}</li>)}
    </ul>}
    <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>View original screenshot</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Original screenshot</DialogTitle>
          <DialogDescription>{capture.pagePath} · {size(capture.screenshotBounds.width, capture.screenshotBounds.height)}</DialogDescription>
        </DialogHeader>
        {image
          ? <div className="max-h-[65vh] overflow-auto rounded-lg bg-surface-well"><img src={image} alt="Original browser capture" className="mx-auto max-w-full" /></div>
          : <p role="status" className="text-sm text-muted-foreground">{error ?? "Loading screenshot…"}</p>}
      </DialogContent>
    </Dialog>
  </Section>;
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

function isColour(value: string): boolean {
  return /^(#|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\()/.test(value);
}
