"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Checkout, FrameLabel, LOOK, NavPanel, Shot, TokenList, cx, type Look, type TokenRow } from "../_components/kit";

type Source = {
  project: string;
  form: string;
  file: string;
  lines: string[];
  tokens: TokenRow[];
  look: Look;
};

/// Three projects, each describing its tokens one of the ways the Theme tab
/// reads: YAML front matter, CSS custom properties, a design-tokens block.
/// Names are what the import produces from each.
const SOURCES: Source[] = [
  {
    project: "storefront",
    form: "YAML front matter",
    file: "storefront/DESIGN.md",
    lines: ["---", "colors:", '  paper: "#FBFAF7"', '  ink: "#16140F"', '  line: "#ECE8DF"', "rounded:", "  md: 12", "fontFamily:", "  body: Inter, sans-serif", "---", "", "# Storefront design"],
    tokens: [
      { kind: "Color", name: "paper", value: "#FBFAF7" },
      { kind: "Color", name: "ink", value: "#16140F" },
      { kind: "Color", name: "line", value: "#ECE8DF" },
      { kind: "Radius", name: "md", value: "12px" },
      { kind: "Font family", name: "body", value: "Inter, sans-serif" },
    ],
    look: LOOK,
  },
  {
    project: "atlas",
    form: "CSS custom properties",
    file: "atlas/DESIGN.md",
    lines: ["# Atlas tokens", "", "```css", ":root {", "  --color-surface: #F3F6FB;", "  --color-ink: #0E2A47;", "  --color-accent: #2563EB;", "  --radius-card: 6px;", "  --font-sans: Geist, sans-serif;", "}", "```"],
    tokens: [
      { kind: "Color", name: "color-surface", value: "#F3F6FB" },
      { kind: "Color", name: "color-ink", value: "#0E2A47" },
      { kind: "Color", name: "color-accent", value: "#2563EB" },
      { kind: "Radius", name: "radius-card", value: "6px" },
      { kind: "Font family", name: "font-sans", value: "Geist, sans-serif" },
    ],
    look: {
      bg: "#F3F6FB",
      surface: "#FFFFFF",
      ink: "#0E2A47",
      muted: "#5B6B80",
      line: "#DCE3EE",
      accent: "#2563EB",
      accentInk: "#FFFFFF",
      radius: 6,
      font: "var(--font-geist-sans), sans-serif",
      thumbs: ["#C7D7F5", "#D6E6E1", "#E7DDF5"],
    },
  },
  {
    project: "ledger",
    form: "design-tokens block",
    file: "ledger/DESIGN.md",
    lines: ["# Ledger", "", "```design-tokens", "colors:", '  canvas: "#101113"', '  text: "#F2F0EA"', '  lime: "#C8F169"', "rounded:", "  pill: 22", "fontFamily:", "  mono: Geist Mono, monospace", "```"],
    tokens: [
      { kind: "Color", name: "canvas", value: "#101113" },
      { kind: "Color", name: "text", value: "#F2F0EA" },
      { kind: "Color", name: "lime", value: "#C8F169" },
      { kind: "Radius", name: "pill", value: "22px" },
      { kind: "Font family", name: "mono", value: "Geist Mono, monospace" },
    ],
    look: {
      bg: "#101113",
      surface: "#1A1B1E",
      ink: "#F2F0EA",
      muted: "#8D8F94",
      line: "#2A2C30",
      accent: "#C8F169",
      accentInk: "#101113",
      radius: 22,
      font: "var(--font-geist-mono), monospace",
      thumbs: ["#3A3F2A", "#2E3A3A", "#3A2E3A"],
    },
  },
];

const LINE = "border-[#FFFFFF26] light:border-black/10";

/// Pick a project and its tokens repaint the same checkout frame.
export function TokenSwap() {
  const [i, setI] = useState(0);
  const src = SOURCES[i];

  return (
    <div className={cx("border", LINE)}>
      <div role="radiogroup" aria-label="Project to import tokens from" className={cx("grid border-b sm:grid-cols-3", LINE)}>
        {SOURCES.map((s, n) => (
          <button
            key={s.project}
            type="button"
            role="radio"
            aria-checked={n === i}
            onClick={() => setI(n)}
            className={cx(
              "flex cursor-pointer flex-col gap-1 border-b px-5 py-4 text-left transition-colors last:border-b-0 sm:border-r sm:border-b-0 sm:last:border-r-0",
              LINE,
              n === i ? "bg-[#FFFFFF14] light:bg-[#F4F4F5]" : "hover:bg-[#FFFFFF0A] light:hover:bg-black/3",
            )}
          >
            <span className={cx("flex items-center gap-2 text-[17px] leading-6 tracking-[-0.01em]", n === i ? "text-white light:text-[#0A0A0A]" : "text-white/65 light:text-[#0A0A0A]/65")}>
              <span className={cx("size-2 rounded-full", n === i ? "bg-[#FFE14D]" : "bg-white/20 light:bg-black/20")} />
              {s.project}
            </span>
            <span className="pl-4 font-mono text-[11px] tracking-[0.02em] text-[#8A8A8A] light:text-[#6B6B6B]">{s.form}</span>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,0.9fr)_auto_minmax(0,1fr)]">
        <figure className="flex min-w-0 flex-col p-6">
          <figcaption className="mb-3 font-mono text-[11px] tracking-[0.06em] text-[#8A8A8A] uppercase light:text-[#6B6B6B]">{src.file}</figcaption>
          <pre className="min-h-[300px] overflow-x-auto rounded-[8px] bg-[#0E0E0E] p-4 font-mono text-[12px] leading-[20px] text-white/80 light:bg-[#F4F4F5] light:text-[#0A0A0A]/80">
            {src.lines.map((l, n) => (
              <div key={n} className={cx(/^(---|```|#)/.test(l) ? "text-white/40 light:text-black/40" : /^\s/.test(l) ? "" : "text-[#b59b73]")}>
                {l || " "}
              </div>
            ))}
          </pre>
        </figure>
        <Arrow />
        <div className="flex min-w-0 justify-center p-6">
          <Shot label={`The Theme tab listing ${src.tokens.length} tokens imported from ${src.file}.`} className="h-[396px] w-[236px]">
            <NavPanel mode="Theme" name="checkout" className="h-full">
              <TokenList tokens={src.tokens} source={src.file} />
            </NavPanel>
          </Shot>
        </div>
        <Arrow />
        <div className="flex min-w-0 flex-col items-center p-6">
          <div role="img" aria-label={`The checkout frame painted with ${src.project}'s tokens.`}>
            <div aria-hidden="true">
              <FrameLabel>Checkout · iPhone 16</FrameLabel>
              <Checkout look={src.look} width={196} />
            </div>
          </div>
        </div>
      </div>
      <p aria-live="polite" className={cx("border-t px-6 py-4 text-[14px] leading-5 text-[#8A8A8A] light:text-[#6B6B6B]", LINE)}>
        <span className="text-white light:text-[#0A0A0A]">{src.tokens.length} tokens from {src.project}.</span> Layers bound to a token change with it; values you typed by hand stay put.
      </p>
    </div>
  );
}

function Arrow() {
  return (
    <div aria-hidden="true" className="flex items-center justify-center text-white/30 max-lg:h-6 max-lg:rotate-90 light:text-black/30">
      <ArrowRight className="size-5" />
    </div>
  );
}
