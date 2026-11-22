"use client";

import { useState, type ReactNode } from "react";
import { Hand } from "lucide-react";
import { Checkout, CommentBox, FrameLabel, Ink, Key, LOOK, LOOP, OrderPlaced, PRESETS, Pin, Selected, Shot, TOOLS, Toolbar, cx, type ToolName } from "../_components/kit";

const ABOUT: Record<ToolName, { line: string; detail: string }> = {
  Select: { line: "Pick, move and resize.", detail: "Click a layer on the board or in the layer tree. Drag to move it, pull a handle to resize, and the inspector follows the selection." },
  Hand: { line: "Pan the board.", detail: "Grab the board and move around it. Zoom from the inspector's header, or jump back with Zoom to fit." },
  Frame: { line: "Start from a real screen size.", detail: "Draw a frame, then pick a preset: phones, tablets, desktops, slides, paper and social sizes, each at its true size." },
  Rectangle: { line: "Block in the shapes.", detail: "Draw a rectangle on the board or inside a frame. Give it a radius per corner, fills, borders and shadows from the inspector." },
  Text: { line: "Type where it goes.", detail: "Click to place a text layer. Set its size, weight, line height and letter spacing, or bind them to your tokens." },
  Pen: { line: "Draw over anything.", detail: "Sketch freehand on top of the design: circle a problem, cross something out, draw the arrow you would draw on paper." },
  Comment: { line: "Pin a note and send it.", detail: "Drop a numbered pin, write what you mean, and send it. It lands in the canvas's conversation with a snapshot of the board." },
};

function Stage({ tool }: { tool: ToolName }) {
  const frame = (child: ReactNode) => <div className="absolute top-6 left-1/2 -translate-x-1/2">{child}</div>;
  switch (tool) {
    case "Select":
      return frame(<><FrameLabel>Checkout · iPhone 16</FrameLabel><Checkout select width={186} /></>);
    case "Hand":
      return (
        <div className="absolute inset-0 cursor-grab">
          <div className="absolute top-6 -left-10"><FrameLabel>Checkout</FrameLabel><Checkout width={200} /></div>
          <div className="absolute top-6 left-[190px]"><FrameLabel>Order placed</FrameLabel><OrderPlaced width={200} /></div>
          <span className="absolute top-[46%] left-[46%] flex size-11 items-center justify-center rounded-full bg-foreground/10 backdrop-blur">
            <Hand className="size-5" />
          </span>
        </div>
      );
    case "Frame":
      return (
        <div className="absolute inset-0 flex items-start justify-center gap-5 p-6">
          <div className="w-[200px] rounded-lg border border-hairline bg-popover p-1 shadow-[0_12px_32px_-12px_#00000080]">
            {PRESETS.map(([g, n, w, h], i) => (
              <div key={n}>
                {(i === 0 || PRESETS[i - 1][0] !== g) && <div className="px-2 pt-1.5 pb-0.5 text-[10.5px] text-muted-foreground">{g}</div>}
                <div className={cx("flex h-6 items-center justify-between rounded-[5px] px-2 text-[12px]", n === "iPhone 16" && "bg-foreground/10")}>
                  <span>{n}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{w}×{h}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6">
            <FrameLabel>iPhone 16</FrameLabel>
            <div className="h-[260px] w-[134px] border border-dashed border-[#4b93ff] bg-white/90" />
          </div>
        </div>
      );
    case "Rectangle":
      return frame(
        <div className="mt-4">
          <FrameLabel>Promo card</FrameLabel>
          <div className="relative h-[300px] w-[232px] bg-[#FBFAF7] p-5">
            <Selected size="192 × 120">
              <div className="h-[120px] rounded-[16px] bg-[#E9D8B8]" />
            </Selected>
            <div className="mt-9 h-3 w-32 rounded-sm bg-[#16140F]/80" />
            <div className="mt-2 h-2 w-40 rounded-sm bg-[#16140F]/25" />
          </div>
        </div>,
      );
    case "Text":
      return frame(
        <div className="mt-4">
          <FrameLabel>Header</FrameLabel>
          <div className="w-[260px] bg-[#FBFAF7] p-5 text-[#16140F]">
            <Selected size="Inter · 28 / 1.2">
              <div className="text-[28px] leading-[1.2] font-semibold tracking-[-0.03em]">
                Free returns
                <span className="ml-0.5 inline-block h-7 w-px translate-y-1 animate-pulse bg-[#168bf0]" />
              </div>
            </Selected>
            <div className="mt-8 text-[12px] text-[#7A756B]">Within 30 days, from any store.</div>
          </div>
        </div>,
      );
    case "Pen":
      return frame(
        <div className="relative">
          <FrameLabel>Checkout · iPhone 16</FrameLabel>
          <Checkout width={232} />
          <Ink d={LOOP} viewBox="0 0 310 64" className="absolute bottom-[-6px] left-[-16px] w-[262px]" />
        </div>,
      );
    case "Comment":
      return (
        <div className="absolute top-6 left-1/2 -translate-x-[70%]">
          <FrameLabel>Checkout · iPhone 16</FrameLabel>
          <Checkout look={LOOK} width={232} />
          <Pin n={1} className="absolute bottom-[38px] left-[214px]" />
          <CommentBox text="Make this sticky above the home indicator." className="absolute bottom-[56px] left-[250px] w-[230px]" />
        </div>
      );
  }
}

/// Seven tools, each a real button: picking one swaps the stage beside it.
export function ToolPicker() {
  const [tool, setTool] = useState<ToolName>("Select");
  const about = ABOUT[tool];

  return (
    <div className="grid border border-[#FFFFFF26] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] light:border-black/10">
      <div className="flex flex-col border-b border-[#FFFFFF26] lg:border-r lg:border-b-0 light:border-black/10">
        {TOOLS.map(({ name, key, icon: Icon }) => {
          const on = name === tool;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={on}
              onClick={() => setTool(name)}
              className={cx(
                "group flex cursor-pointer items-start gap-4 border-b border-[#FFFFFF14] px-5 py-4 text-left transition-colors last:border-b-0 light:border-black/6",
                on ? "bg-[#FFFFFF14] light:bg-[#F4F4F5]" : "hover:bg-[#FFFFFF0A] light:hover:bg-black/3",
              )}
            >
              <Icon className={cx("mt-0.5 size-[18px] shrink-0", on ? "text-white light:text-[#0A0A0A]" : "text-white/50 light:text-black/45")} />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-center justify-between gap-3">
                  <span className={cx("text-[17px] leading-6 tracking-[-0.01em]", on ? "text-white light:text-[#0A0A0A]" : "text-white/70 light:text-[#0A0A0A]/70")}>{name}</span>
                  <Key>{key}</Key>
                </span>
                <span className={cx("text-[14px] leading-5", on ? "text-white/74 light:text-[#0A0A0A]/72" : "text-[#8A8A8A] light:text-[#6B6B6B]")}>{ABOUT[name].line}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="relative h-[460px] overflow-hidden">
          <Shot label={`${tool} tool: ${about.line}`} className="h-full rounded-none shadow-none">
            <div className="app-sheet relative flex-1 overflow-hidden">
              <Stage tool={tool} />
              <Toolbar active={tool} className="absolute bottom-3.5 left-1/2 -translate-x-1/2" />
            </div>
          </Shot>
        </div>
        <p aria-live="polite" className="border-t border-[#FFFFFF26] p-6 text-[15px] leading-[22px] text-[#8A8A8A] light:border-black/10 light:text-[#6B6B6B]">
          <span className="text-white light:text-[#0A0A0A]">{tool}. </span>
          {about.detail}
        </p>
      </div>
    </div>
  );
}
