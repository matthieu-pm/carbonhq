import React, { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import AppShell from "@/components/layout/AppShell";
import Rail from "@/components/layout/Rail";
import WindowToolbar from "@/components/layout/WindowToolbar";
import { SidebarToggle } from "@/components/Sidebar";
import { useResizable } from "@/components/ResizeHandle";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import "../App.css";

type Mode = "docked" | "peek" | "hidden";
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function sample(read: () => number, duration = 250) {
  const values: number[] = [];
  const end = performance.now() + duration;
  do { values.push(read()); await nextFrame(); } while (performance.now() < end);
  return values;
}

function DemoSidebar({ mode }: { mode: Mode }) {
  const { style, handle } = useResizable({ storageKey: "demo.sidebarMotion.width", initial: 280,
    min: 240, edge: "right", label: "Resize the demo sidebar", pane: mode === "docked" ? "sidebar" : undefined });
  return (
    <aside className="relative flex shrink-0 flex-col gap-3 p-3" style={style}>
      {mode === "docked" && handle}
      <strong className="text-ui">Tasks</strong>
      <input aria-label="Find a task" placeholder="Find a task…" className="min-w-0 rounded-md border border-border p-2 text-ui" />
      {["Polish the sidebar", "Review the toolbar", "Ship the update"].map((name) =>
        <Button key={name} variant="ghost" size="sm" className="justify-start">{name}</Button>)}
    </aside>
  );
}

function Demo() {
  const [mode, setMode] = useState<Mode>("docked");
  const [result, setResult] = useState("Ready");
  const [running, setRunning] = useState(false);
  const initial = useRef<boolean | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const toggle = () => setMode((previous) => previous === "docked" ? "hidden" : "docked");
  const dock = () => host.current!.querySelector<HTMLElement>(".sidebar-docked")!;
  const width = () => dock().getBoundingClientRect().width;
  const change = (next: Mode) => flushSync(() => setMode(next));

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = host.current!.querySelector<HTMLElement>(".sidebar-docked")!;
      initial.current = element.getBoundingClientRect().width > 0 && element.getAnimations({ subtree: true }).length === 0;
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const check = async () => {
    setRunning(true);
    setResult("Checking…");
    const passed: string[] = [];
    const expect = (condition: boolean, name: string) => {
      if (!condition) throw new Error(name);
      passed.push(name);
    };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      expect(initial.current === true, "No opening animation on first paint");
      change("docked");
      await sample(width);
      const full = width();
      const body = dock().firstElementChild;
      change("hidden");
      const closing = await sample(width);
      expect(width() === 0, "Collapse reclaims the entire column");
      expect(dock().firstElementChild === body, "Closing preserves the sidebar body");
      expect(reduced || closing.some((value) => value > 0 && value < full), "Closing has intermediate frames");
      const field = dock().querySelector<HTMLInputElement>("input")!;
      field.focus();
      expect(dock().inert && document.activeElement !== field, "Closed controls cannot take focus");
      change("docked");
      const opening = await sample(width);
      expect(reduced || opening.some((value) => value > 0 && value < full), "Opening has intermediate frames");
      expect(Math.abs(width() - full) < 1, "Opening restores the full width");
      change("hidden");
      await nextFrame(); await nextFrame();
      const interrupted = width();
      change("docked");
      expect(reduced || Math.abs(width() - interrupted) < 2, "Reversal continues without a snap");
      await sample(width);
      const beforeResize = width();
      const handle = dock().querySelector<HTMLElement>("[role=separator]")!;
      flushSync(() => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
      await nextFrame(); await nextFrame();
      expect(Math.abs(width() - beforeResize - 16) < 1, "Resizing does not ease behind the handle");
      change("peek");
      const floating = host.current!.querySelector<HTMLElement>(".sidebar-floating")!;
      const opacity = () => Number(getComputedStyle(floating).opacity);
      const floatingIn = await sample(opacity);
      expect(floatingIn.some((value) => value > 0 && value < 1), "Floating entrance animates");
      change("hidden");
      const floatingOut = await sample(opacity);
      expect(floatingOut.some((value) => value > 0 && value < 1), "Floating exit animates");
      expect(floating.inert && getComputedStyle(floating).visibility === "hidden", "Floating exit ends hidden and inert");
      change("docked");
      setResult(`Passed ${passed.length} checks${reduced ? " (reduced motion)" : ""}`);
    } catch (error) {
      setResult(`Failed: ${String(error)}. Passed: ${passed.join(", ")}`);
    } finally { setRunning(false); }
  };

  return (
    <TooltipProvider>
      <DemoThemeBar />
      <div className="flex flex-wrap items-center gap-2 p-3">
        <Button size="sm" onClick={toggle}>Toggle sidebar</Button>
        <Button size="sm" variant="outline" onClick={() => setMode("peek")}>Float sidebar</Button>
        <Button size="sm" variant="outline" onClick={() => setMode("hidden")}>Hide sidebar</Button>
        <Button size="sm" variant="secondary" disabled={running} onClick={() => void check()}>Run motion checks</Button>
        <output className="text-ui" aria-live="polite">{result}</output>
      </div>
      <div ref={host} className="h-[600px] min-h-0 border-y border-border">
        <AppShell sidebarMode={mode} sidebar={<DemoSidebar mode={mode} />} footer={null}
          rail={<Rail place="home" spaces={false} onHome={() => {}} onSpaces={() => {}} onIssues={() => {}}
            onHomeHover={(over) => mode !== "docked" && setMode(over ? "peek" : "hidden")} peeks={mode !== "docked"} footer={null} />}
          header={<WindowToolbar fullscreen><SidebarToggle onToggle={toggle} /><span className="text-ui">Sidebar motion</span></WindowToolbar>}
        >
          <div className="flex min-h-0 flex-1 items-center justify-center text-ui text-muted-foreground">The content follows the sidebar’s width.</div>
        </AppShell>
      </div>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><Demo /></React.StrictMode>);
