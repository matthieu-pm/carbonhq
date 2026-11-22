"use client";

import { useEffect, useMemo, useState } from "react";
import { cx } from "@/components/app/Window";

const BORDER = "border border-[#FFFFFF26] light:border-black/10";
const HEAD = "border-b border-[#FFFFFF26] bg-[#FFFFFF1A] px-4 py-2.5 font-mono text-[11px] leading-[14px] tracking-[0.06em] text-[#8A8A8A] uppercase light:border-black/10 light:bg-[#F4F4F5] light:text-[#6B6B6B]";
const BODY = "bg-[#0A0A0A] light:bg-white";
const MONO = "font-mono text-xs leading-5 tracking-[-0.02em]";
const MUTED = "text-[#8A8A8A] light:text-[#6B6B6B]";

type Part = { text: string; note?: string };
const ANATOMY: { id: string; label: string; body: string }[] = [
  { id: "version", label: "version", body: "One format version. A file Carbon cannot read is refused with a message, never half-opened." },
  { id: "pages", label: "pages", body: "Each page keeps its background, your pen strokes and your comment pins." },
  { id: "elements", label: "elements", body: "Every layer in one flat list. parent names the frame a layer sits in, and only frames hold children." },
  { id: "style", label: "style", body: "Size, rotation, radius, layout and type, written as CSS values." },
  { id: "effects", label: "effects", body: "Fills, borders, shadows and filters, in the order they stack." },
  { id: "token", label: "@ values", body: "A value starting with @ points at a token. Change the token and every layer pointing at it follows." },
  { id: "tokens", label: "tokens", body: "The theme: named values of eleven kinds, from colour and radius to line height." },
];

const FILE: Part[][] = [
  [{ text: "{" }],
  [{ text: '  "version": 1,', note: "version" }],
  [{ text: '  "pages": [{ "id": "page-1", "name": "Welcome", "background": "#282828",', note: "pages" }],
  [{ text: '    "strokes": [{ "id": "s1", "points": [[14, 734], …] }],', note: "pages" }],
  [{ text: '    "comments": [{ "id": "c1", "x": 338, "y": 752, "text": "…" }] }],', note: "pages" }],
  [{ text: '  "elements": [{', note: "elements" }],
  [{ text: '    "id": "button", "page": "page-1", "parent": "welcome",', note: "elements" }],
  [{ text: '    "kind": "Frame", "name": "Button", "x": 32, "y": 744,', note: "elements" }],
  [{ text: '    "style": { "width": "329px", "borderRadius": ', note: "style" }, { text: '"@radius-lg"', note: "token" }, { text: " },", note: "style" }],
  [{ text: '    "effects": [{ "kind": "Fill", "fields": { "color": ', note: "effects" }, { text: '"@brand"', note: "token" }, { text: " } }]", note: "effects" }],
  [{ text: "  }]," }],
  [{ text: '  "tokens": [', note: "tokens" }],
  [{ text: '    { "id": "brand", "kind": "Color", "name": "colors.brand", "value": "#ef5a3c" },', note: "tokens" }],
  [{ text: '    { "id": "radius-lg", "kind": "Radius", "name": "rounded.lg", "value": "28px" }', note: "tokens" }],
  [{ text: "  ]" }],
  [{ text: "}" }],
];

/// The file with its parts labelled. Picking a label lights its lines.
export function Anatomy() {
  const [on, setOn] = useState("token");
  const current = ANATOMY.find((a) => a.id === on)!;
  return (
    <figure className={BORDER}>
      <div role="tablist" aria-label="Parts of a canvas file" className="flex flex-wrap gap-px border-b border-[#FFFFFF26] bg-[#FFFFFF26] light:border-black/10 light:bg-black/10">
        {ANATOMY.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={on === a.id}
            onClick={() => setOn(a.id)}
            className={cx("h-9 flex-1 px-3 font-mono text-[11px] whitespace-nowrap", on === a.id ? "bg-[#525252] text-white" : "bg-black text-[#8A8A8A] hover:text-white light:bg-white light:hover:text-[#0A0A0A]")}
          >
            {a.label}
          </button>
        ))}
      </div>
      <pre className={cx("grid grid-cols-[minmax(100%,max-content)] overflow-x-auto py-3", BODY, MONO)} aria-label="onboarding.canvas.json, abridged">
        {FILE.map((line, i) => (
          <span key={i} className={cx("block px-4 whitespace-pre transition-colors duration-150", line.some((p) => p.note === on) ? "bg-[#FFFFFF1A] text-[#CFCFCF] light:bg-[#F4F4F5] light:text-[#3F3F46]" : "text-[#5A5A5A] light:text-[#A1A1AA]")}>
            {line.map((p, j) => (
              <span key={j} className={p.note === on ? "text-white light:text-[#0A0A0A]" : undefined}>
                {p.text}
              </span>
            ))}
            {"\n"}
          </span>
        ))}
      </pre>
      <figcaption aria-live="polite" className="border-t border-[#FFFFFF26] p-4 text-[15px] leading-[22px] text-[#8A8A8A] light:border-black/10 light:text-[#6B6B6B]">
        <span className="mr-2 bg-[#FFE14D] px-[3px] font-mono text-[12px] text-[#0B0B0F]">{current.label}</span>
        {current.body}
      </figcaption>
    </figure>
  );
}

const SAMPLE = `---
colors:
  brand: "#4f5bff"
  ink: "#121212"
  accent: "{colors.brand}"
rounded:
  lg: 14
spacing:
  "4": 16
typography:
  lineHeight:
    body: 1.6
opacity:
  muted: 0.6
---

:root {
  --color-paper: #f3efe6;
  --radius-sm: 6px;
  --tracking-tight: -0.02em;
}
`;

const GROUPS: Record<string, string> = {
  colors: "Color", opacity: "Opacity", rounded: "Radius", radius: "Radius", spacing: "Spacing", containers: "Container",
  breakpoints: "Breakpoint", fontFamily: "Font family", fontWeight: "Font weight", fontSize: "Font size", lineHeight: "Line height", letterSpacing: "Letter spacing",
};
const LENGTHS = new Set(["Radius", "Spacing", "Container", "Breakpoint", "Font size", "Letter spacing"]);
const PREFIXES: [RegExp, string][] = [
  [/^radius-/, "Radius"], [/^(spacing|space|gap)-/, "Spacing"], [/^breakpoint-/, "Breakpoint"], [/^container-/, "Container"], [/^font-weight-/, "Font weight"],
  [/^(text|font-size)-/, "Font size"], [/^font-/, "Font family"], [/^leading-/, "Line height"], [/^tracking-/, "Letter spacing"], [/^opacity-/, "Opacity"],
];

function normalize(kind: string, raw: string) {
  const v = raw.trim();
  if (kind === "Opacity" && /^(?:\d+\.?\d*|\.\d+)$/.test(v)) {
    const n = Number(v);
    return (n <= 1 ? n * 100 : n) + "%";
  }
  if (LENGTHS.has(kind) && /^-?\d+(\.\d+)?$/.test(v)) return v + "px";
  return v;
}

/// A trimmed copy of the app's importer: indented front matter and CSS custom
/// properties, with the same group names, prefixes, units and references.
function importTokens(md: string) {
  const entries = new Map<string, { name: string; kind: string; raw: string }>();
  const front = md.replaceAll("\r\n", "\n").match(/^---[ \t]*\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  if (front) {
    const stack: { indent: number; key: string; kind?: string }[] = [];
    for (const line of front.split("\n")) {
      const m = line.match(/^(\s*)("?)([\w.-]+)\2\s*:\s*(.*)$/);
      if (!m) continue;
      const indent = m[1].length, key = m[3];
      const value = m[4].replace(/\s+#.*$/, "").trim().replace(/^"(.*)"$|^'(.*)'$/, "$1$2");
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const kind = GROUPS[key] ?? stack[stack.length - 1]?.kind;
      if (!value) {
        if (stack.length || kind || key === "typography") stack.push({ indent, key, kind });
        continue;
      }
      const path = [...stack.map((p) => p.key), key];
      const name = path.slice(1).join(".");
      if (kind && name) entries.set(path.join("."), { name, kind, raw: value });
    }
  }
  for (const m of md.matchAll(/--([\w-]+)\s*:\s*([^;{}\n]+);/g)) {
    const [, name, raw] = m;
    const kind = PREFIXES.find(([p]) => p.test(name))?.[1] ?? "Color";
    if (kind !== "Color" || /^#|^(rgba?|hsla?|oklch|oklab|color|var)\(/i.test(raw.trim()) || name.startsWith("color-"))
      entries.set("--" + name, { name, kind, raw: raw.trim() });
  }
  const valueOf = (key: string, seen: Set<string>): string | undefined => {
    const e = entries.get(key);
    if (!e || seen.has(key)) return undefined;
    const ref = e.raw.match(/^\{([\w.-]+)\}$|^var\((--[\w-]+)\)$/);
    return ref ? valueOf(ref[1] || ref[2], seen.add(key)) : normalize(e.kind, e.raw);
  };
  const out: { name: string; kind: string; value: string; from: string }[] = [];
  for (const [key, e] of entries) {
    const value = valueOf(key, new Set());
    if (value) out.push({ name: e.name, kind: e.kind, value, from: key.startsWith("--") ? "CSS" : "YAML" });
  }
  return out;
}

export function TokenImport() {
  const [text, setText] = useState(SAMPLE);
  const tokens = useMemo(() => importTokens(text), [text]);
  return (
    <figure className="flex flex-col gap-3">
      <div className={cx("grid lg:grid-cols-2", BORDER)}>
        <label className="flex min-w-0 flex-col border-[#FFFFFF26] max-lg:border-b lg:border-r light:border-black/10">
          <span className={HEAD}>DESIGN.md · edit me</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={18}
            aria-label="DESIGN.md contents"
            className={cx("min-h-[280px] flex-1 resize-y p-4 text-white outline-none focus:bg-[#111] light:text-[#0A0A0A] light:focus:bg-[#FAFAFA]", BODY, MONO)}
          />
        </label>
        <div className={cx("flex min-w-0 flex-col", BODY)}>
          <span className={HEAD}>
            Theme · {tokens.length} token{tokens.length === 1 ? "" : "s"}
          </span>
          {tokens.length ? (
            <table className={cx("w-full", MONO)}>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.from + t.name} className="border-b border-[#FFFFFF14] light:border-black/5">
                    <td className="px-4 py-1.5 break-all text-white light:text-[#0A0A0A]">{t.name}</td>
                    <td className={cx("px-2 py-1.5 whitespace-nowrap", MUTED)}>{t.kind}</td>
                    <td className="px-4 py-1.5 break-all text-[#CFCFCF] light:text-[#3F3F46]">
                      {t.kind === "Color" && <i className="mr-1.5 inline-block size-2.5 align-[-1px] shadow-[0_0_0_1px_#FFFFFF26]" style={{ background: t.value }} />}
                      {t.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className={cx("p-4 text-[15px]", MUTED)}>No tokens found. Try a colors: group in the front matter, or a --color- property.</p>
          )}
          <button type="button" onClick={() => setText(SAMPLE)} disabled={text === SAMPLE} className={cx("m-4 mt-auto self-start font-mono text-[11px] tracking-[0.06em] uppercase hover:text-white disabled:opacity-40 light:hover:text-[#0A0A0A]", MUTED)}>
            Reset sample
          </button>
        </div>
      </div>
      <figcaption className={cx("text-[13px] leading-5", MUTED)}>
        This page runs a trimmed copy of the importer. The app also reads <code className="font-mono">```yaml</code> and <code className="font-mono">```design-tokens</code> fences, and drops
        any value a browser would not accept for that kind.
      </figcaption>
    </figure>
  );
}

const KEYS = [
  ["V", "Select", "Click a layer, on the board or in Layers, to edit it in the inspector."],
  ["H", "Hand", "Drag to pan. Scrolling pans too; pinch or ⌘-scroll zooms."],
  ["F", "Frame", "Place a frame, then pick a preset: iPhone 16, iPad, MacBook, 16:9, A4, story."],
  ["R", "Rectangle", "Place a rectangle. Draw it inside a frame and it nests there."],
  ["T", "Text", "Place a text layer. Family, size, weight and tracking can each bind to a token."],
  ["P", "Pen", "Draw freehand over the page. Strokes save with it and show up in snapshots."],
  ["C", "Comment", "Pin a comment and send it to the canvas's conversation."],
];

/// The shortcut table. Pressing one of its keys anywhere on the page lights
/// its row, so a reader can rehearse them.
export function Keys() {
  const [lit, setLit] = useState<string | null>(null);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.target instanceof Element && e.target.closest("input,textarea,select")) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toUpperCase();
      if (KEYS.some(([k]) => k === key)) setLit(key);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);
  return (
    <figure className="flex flex-col gap-3">
      <div className={cx("divide-y divide-[#FFFFFF26] light:divide-black/10", BORDER)}>
        {KEYS.map(([k, name, body]) => (
          <button
            key={k}
            type="button"
            onClick={() => setLit(k)}
            className={cx("grid w-full grid-cols-[28px_96px_minmax(0,1fr)] items-start gap-3 px-4 py-3 text-left transition-colors duration-150", lit === k ? "bg-[#FFFFFF1A] light:bg-[#F4F4F5]" : "")}
          >
            <kbd className={cx("grid h-6 place-items-center font-mono text-[11px]", lit === k ? "bg-[#FFE14D] text-[#0B0B0F]" : "bg-[#525252] text-white")}>{k}</kbd>
            <span className="text-[15px] leading-6 text-white light:text-[#0A0A0A]">{name}</span>
            <span className={cx("text-[15px] leading-6", MUTED)}>{body}</span>
          </button>
        ))}
      </div>
      <figcaption className={cx("text-[13px] leading-5", MUTED)}>Press a letter to find its row. ⌘Z and ⇧⌘Z walk 80 steps of history; arrows nudge by 1, Shift by 10.</figcaption>
    </figure>
  );
}

type Conflict = "idle" | "saving" | "saved" | "conflict" | "kept" | "reloaded";
const STATUS: Record<Conflict, string> = {
  idle: "You move the button 12px down.",
  saving: "Saving…",
  saved: "Saved. The file on disk matches the board.",
  conflict: "Canvas changed on disk. An agent rewrote the file while your edit was waiting.",
  kept: "Your board is saved over the agent's version of the file.",
  reloaded: "Your unsaved edit is dropped and the board shows the agent's version.",
};

/// A walk through autosave and the conflict notice, without a real file.
export function ConflictDemo() {
  const [state, setState] = useState<Conflict>("idle");
  useEffect(() => {
    if (state !== "saving") return;
    const t = setTimeout(() => setState("saved"), 600);
    return () => clearTimeout(t);
  }, [state]);
  const button = "h-9 px-3.5 text-[13px] font-medium transition-transform active:scale-[0.97]";
  return (
    <figure className={BORDER}>
      <div className={HEAD}>{state === "conflict" ? "Conflict" : "Autosave"}</div>
      <div className={cx("flex flex-col gap-4 p-4", BODY)}>
        <p role="status" className={cx("min-h-12 text-[15px] leading-[22px]", state === "conflict" ? "text-[#F85149] light:text-[#CF222E]" : "text-white light:text-[#0A0A0A]")}>
          {STATUS[state]}
        </p>
        <div className="flex flex-wrap gap-2">
          {state === "conflict" ? (
            <>
              <button type="button" onClick={() => setState("kept")} className={cx(button, "bg-white text-[#0A0A0A] light:bg-[#0A0A0A] light:text-white")}>
                Keep my edits
              </button>
              <button type="button" onClick={() => setState("reloaded")} className={cx(button, "bg-[#222] text-white shadow-[inset_0_0_0_1px_#FFFFFF1F] light:bg-[#F1F1F1] light:text-[#0A0A0A]")}>
                Reload from disk
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setState("saving")} className={cx(button, "bg-white text-[#0A0A0A] light:bg-[#0A0A0A] light:text-white")}>
                Edit, then wait
              </button>
              <button type="button" onClick={() => setState("conflict")} className={cx(button, "bg-[#222] text-white shadow-[inset_0_0_0_1px_#FFFFFF1F] light:bg-[#F1F1F1] light:text-[#0A0A0A]")}>
                Edit while an agent writes
              </button>
              {state !== "idle" && (
                <button type="button" onClick={() => setState("idle")} className={cx(button, MUTED)}>
                  Reset
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </figure>
  );
}
