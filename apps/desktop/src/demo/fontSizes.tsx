import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import DiffWorkerPool from "@/components/DiffWorkerPool";
import DiffView from "@/components/chat/DiffView";
import { Markdown } from "@/components/chat/Markdown";
import FileViewer from "@/components/files/FileViewer";
import FontSizeRow from "@/components/settings/FontSizeRow";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import { useCodeThemeWithMode } from "@/hooks/useCodeTheme";
import { warmHighlighter } from "@/hooks/useHighlighter";
import type { OpenFile } from "@/hooks/useOpenFiles";
import { applyStoredFontSizes, diffMetrics, FONT_SLOTS, setFontSize, useFontSizes } from "@/lib/fontSize";
import big from "@/App.tsx?raw";
import "streamdown/styles.css";
import "../App.css";

/// The two font size rows from Settings → Appearance above one sample of every
/// surface they move: chrome, chat, a raw `text-sm` button, tool output, an
/// Edit diff and the virtualized Files view opened at line 1200. **Run size
/// check** reads the computed sizes back at a non-default pair, checks the
/// Files view's rows are spaced at the line height its code is drawn with, and
/// that the line at its top stays there across each change.

const PATH = "/Users/me/carbon/apps/desktop/src/App.tsx";
const lines = big.split("\n");
const fragment = lines.slice(100, 120).join("\n");
const OPEN = {
  path: PATH,
  line: 1200,
  reveal: 1,
  state: { status: "ready", body: { kind: "text", text: big } },
} as OpenFile;

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const settle = async () => {
  for (let i = 0; i < 20; i++) await frame();
};
/// The zero-based index of the row under the pane's top edge.
function topLine(pane: Element | null): number | undefined {
  if (!pane) return undefined;
  const edge = pane.getBoundingClientRect().top + 1;
  const rows = pane.querySelector("diffs-container")?.shadowRoot?.querySelectorAll("[data-line]") ?? [];
  for (const row of rows) {
    const { top, bottom } = row.getBoundingClientRect();
    if (top <= edge && edge < bottom) return Number(row.getAttribute("data-line-index"));
  }
  return undefined;
}

const px = (el: Element | null | undefined) => (el ? parseFloat(getComputedStyle(el).fontSize) : NaN);

async function runChecks(): Promise<string> {
  const failures: string[] = [];
  const expect = (what: string, got: number, want: number) => {
    if (Math.abs(got - want) > 0.01) failures.push(`${what}: ${got} ≠ ${want}`);
  };
  // Park line 800 at the Files view's top edge; every size change must keep it there.
  setFontSize("code", 14);
  await settle();
  const pane = document.querySelector('[data-check="files"] .overflow-auto');
  if (pane) pane.scrollTop = 8 + 799 * diffMetrics(14).lineHeight;
  await settle();
  for (const [ui, code] of [[17, 18], [11, 12]]) {
    setFontSize("ui", ui);
    setFontSize("code", code);
    await settle();
    const top = topLine(pane);
    if (top !== 799) failures.push(`files ${code}: top line ${top === undefined ? "none" : top + 1} ≠ 800`);
    const q = (s: string) => document.querySelector(`[data-check="${s}"]`);
    expect(`ui ${ui}`, px(q("ui")), ui);
    expect(`chat ${ui}`, px(q("chat")?.querySelector("p")), ui);
    expect(`text-sm ${ui}`, px(q("sm")), 14 * (ui / 13));
    expect(`tool ${code}`, px(q("tool")), code - 1);
    const { fontSize, lineHeight } = diffMetrics(code);
    const diffLine = q("diff")?.querySelector("diffs-container")?.shadowRoot?.querySelector("[data-line]");
    // `DiffView` puts `text-code` on the library's host, which beats its own
    // `:host` size, so a chat diff sits at the code size itself.
    expect(`diff ${code}`, px(diffLine), code);
    const rows = [...(q("files")?.querySelector("diffs-container")?.shadowRoot?.querySelectorAll("[data-line]") ?? [])];
    if (rows.length < 2) failures.push(`files ${code}: no rows drawn`);
    else {
      expect(`files font ${code}`, px(rows[0]), fontSize);
      const pitch = rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
      expect(`files row pitch ${code}`, pitch, lineHeight);
    }
  }
  setFontSize("ui", 13);
  setFontSize("code", 14);
  return failures.length ? `Failed: ${failures.join("; ")}` : "Passed: every surface follows both sizes";
}

function Page() {
  const { pair } = useCodeThemeWithMode();
  useEffect(() => warmHighlighter(pair), [pair]);
  const sizes = useFontSizes();
  const [result, setResult] = useState("Not run");

  return (
    <DiffWorkerPool pair={pair}>
      <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8 pb-64">
        <h1 className="text-lg font-medium">Font sizes</h1>
        <section className="flex flex-col gap-4">
          {FONT_SLOTS.map((slot) => (
            <FontSizeRow key={slot.id} slot={slot} />
          ))}
        </section>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={() => void runChecks().then(setResult)}>
            Run size check
          </Button>
          <span role="status" className="text-ui">{result}</span>
        </div>
        <p data-check="ui" className="text-ui text-muted-foreground">
          Sidebar row · {sizes.ui}px UI
        </p>
        <div data-check="chat" className="text-chat">
          <Markdown>{"Chat text. The quick brown fox jumps over the lazy dog, with `inline code` beside it."}</Markdown>
        </div>
        <Button data-check="sm" variant="outline" className="self-start">A raw text-sm button</Button>
        <pre data-check="tool" className="font-mono text-tool text-muted-foreground">$ pnpm test{"\n"}✓ 3 passed</pre>
        <div data-check="diff">
          <DiffView sides={{ path: PATH, oldText: fragment, newText: fragment.replace(/\n/, "\n// added\n") }} />
        </div>
        <div data-check="files" className="flex h-96 flex-col rounded-md border border-border/60">
          <FileViewer file={OPEN} />
        </div>
      </main>
      <DemoThemeBar />
    </DiffWorkerPool>
  );
}

applyStoredFontSizes();
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TooltipProvider>
      <Page />
    </TooltipProvider>
  </React.StrictMode>,
);
