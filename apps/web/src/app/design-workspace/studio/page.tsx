import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Archive, Check, FolderOpen, Layers, MessageSquare, Palette, PenLine, SlidersHorizontal, SquareDashed } from "lucide-react";
import { CanvasFile } from "../_components/CanvasFile";
import { Fit } from "../_components/Fit";
import { BoardShot, ChatDock, Checkout, CommentBox, Editor, FrameLabel, INK, LOOP, PRESETS, Pin, Shot } from "../_components/kit";
import m from "../_components/motion.module.css";
import { Band, Faq, Heading, Hero, LINE, MUTED, Page, TILE } from "../_components/shell";
import { Story, TokenScene } from "../_components/stories";
import { TokenSwap } from "./TokenSwap";

const description =
  "Carbon's Design workspace keeps canvases in your project, reads tokens from your own DESIGN.md, and sends comments to the conversation writing the code.";

export const metadata: Metadata = {
  title: "Design workspace: design in the repo, not next to it - Carbon",
  description,
  openGraph: { title: "Carbon Design workspace", description },
};

/// The loop: one cycle, told as four steps, with the repo as the place it all lives.
export default function StudioPage() {
  return (
    <Page>
      <Hero
        badge="The Design workspace"
        lines={["Design in the repo,", "not next to it."]}
        description="Canvases are files in your project, and their tokens come from your own DESIGN.md. Change a token and every layer bound to it updates. When something needs fixing, comment on it and the agent writing the code gets your note."
        preview={
          <Story>
            <TokenScene />
          </Story>
        }
      />
      <Band className="pt-6 pb-10">
        <Loop />
      </Band>

      <main>
        <Chapter id="tokens" n="01" title="Start from the tokens you already wrote." lead="Point the Theme tab at a Markdown file in any attached project.">
          <p className={`max-w-[640px] text-[15px] leading-[22px] lg:ml-[102px] ${MUTED}`}>
            It reads YAML front matter, yaml and design-tokens code blocks, and CSS custom properties, then resolves references
            between them. Eleven kinds come through: colour, opacity, radius, spacing, container, breakpoint, font family,
            weight, size, line height and letter spacing. Pick a project to try it.
          </p>
          <div className="mt-10">
            <TokenSwap />
          </div>
        </Chapter>

        <Chapter id="sketch" n="02" title="Sketch on a real board." lead="Pages, frames, shapes and text in one layer tree.">
          <div className={`grid border ${LINE} lg:grid-cols-[320px_minmax(0,1fr)]`}>
            <div className={`flex flex-col gap-6 border-b p-6 lg:border-r lg:border-b-0 ${LINE}`}>
              <p className={`text-[15px] leading-[22px] ${MUTED}`}>
                <span className="text-white light:text-[#0A0A0A]">Frames start at a true size.</span> Pick a preset for a phone, tablet,
                desktop, slide, sheet of paper or social post, or drag your own.
              </p>
              <ul className="flex flex-col font-mono text-[12px]">
                {PRESETS.map(([g, n, w, h]) => (
                  <li key={n} className={`flex justify-between border-b py-2 last:border-b-0 ${LINE}`}>
                    <span>
                      <span className={MUTED}>{g} · </span>
                      {n}
                    </span>
                    <span className={MUTED}>
                      {w}×{h}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className={`overflow-clip p-6 ${TILE}`}>
              <Fit width={1120} height={700} className="max-sm:hidden">
                <Editor right="none" />
              </Fit>
              <Fit width={400} height={620} className="sm:hidden">
                <BoardShot />
              </Fit>
            </div>
          </div>
        </Chapter>

        <Chapter id="markup" n="03" title="Mark it up where it's wrong." lead="A pen for circling, pins for saying why.">
          <Story dur="9s" className={`grid border ${LINE} lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]`}>
            <div className={`relative flex min-h-[460px] items-center justify-center overflow-clip border-b p-8 lg:border-r lg:border-b-0 ${LINE} ${TILE}`}>
              <div className="relative">
                <FrameLabel>Checkout · iPhone 16</FrameLabel>
                <Checkout width={220} />
                <svg viewBox="0 0 310 64" fill="none" className="absolute bottom-[-4px] left-[-14px] w-[248px] overflow-visible" aria-hidden="true">
                  <path d={LOOP} pathLength={1} stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className={m.draw} />
                </svg>
                <Pin n={1} className={`absolute bottom-[38px] left-[206px] ${m.pop}`} />
                <Pin n={2} className={`absolute top-[92px] left-[206px] ${m.pop}`} />
                <div className={`absolute bottom-[70px] left-[150px] max-sm:hidden ${m.rise}`}>
                  <Shot label="A comment pinned to the Pay button, ready to send to the canvas chat.">
                    <CommentBox text="Pin this above the home indicator." className="w-[240px]" />
                  </Shot>
                </div>
              </div>
            </div>
            <div className="flex flex-col justify-center gap-6 p-8">
              <Point icon={<PenLine className="size-4" />} title="Pen">Draw freehand over the design. Strokes are saved with the page.</Point>
              <Point icon={<MessageSquare className="size-4" />} title="Comment">Drop a numbered pin where the problem is and write what you mean.</Point>
              <Point icon={<SquareDashed className="size-4" />} title="Snapshot">Sending a comment takes a picture of the board around the pin, your ink included, and attaches it.</Point>
            </div>
          </Story>
        </Chapter>

        <Chapter id="send" n="04" title="Send it to the session doing the work." lead="Every canvas has its own conversation, docked beside the board.">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-center">
            <div className="max-sm:hidden">
              <Fit width={1120} height={700}>
                <Editor right="chat" markup tool="Comment" label="The canvas with a circled Pay button and pin, and the canvas chat docked on the right showing the sent comment and the agent's reply." />
              </Fit>
            </div>
            <div className="sm:hidden">
              <Shot label="The canvas chat with the sent comment, its snapshot and the canvas path." className="mx-auto h-[460px] w-full max-w-[340px]">
                <ChatDock className="h-full w-full border-l-0" />
              </Shot>
            </div>
            <ul className={`flex flex-col gap-5 text-[15px] leading-[22px] ${MUTED}`}>
              <li>
                <span className="text-white light:text-[#0A0A0A]">Context comes along.</span> The message carries your note, the snapshot and the
                canvas&apos;s path in the repo.
              </li>
              <li>
                <span className="text-white light:text-[#0A0A0A]">Tabs per canvas.</span> Start a new conversation beside the first, or attach a
                session already running in the same project.
              </li>
              <li>
                <span className="text-white light:text-[#0A0A0A]">A full Carbon chat.</span> Plans, subagents and queued messages work as they do in
                the Coding workspace, on whichever agent you pick.
              </li>
            </ul>
          </div>
        </Chapter>

        <CanvasFile />

        <Band id="inventory" className="py-24">
          <Heading lead="What's in the workspace today." className="max-w-[720px]" />
          <div className={`mt-12 grid border-t border-l ${LINE} sm:grid-cols-2 lg:grid-cols-4`}>
            <Spec icon={<FolderOpen className="size-4" />} title="Library">Canvases from every attached project, in folders, as a grid or a list.</Spec>
            <Spec icon={<Archive className="size-4" />} title="Archive">Set a canvas aside and bring it back later. Nothing is deleted.</Spec>
            <Spec icon={<Layers className="size-4" />} title="Pages and layers">Frames, rectangles and text, nested in a tree you can rename.</Spec>
            <Spec icon={<SlidersHorizontal className="size-4" />} title="Inspector">Size, rotation, per-corner radius, flex layout, typography and blending.</Spec>
            <Spec icon={<Check className="size-4" />} title="Effects">Fill, outline, border, shadow, inner shadow, filter, backdrop filter, text stroke.</Spec>
            <Spec icon={<Palette className="size-4" />} title="Theme">Eleven token kinds, imported from Markdown or added by hand.</Spec>
            <Spec icon={<PenLine className="size-4" />} title="Markup">Freehand pen and numbered comment pins on every page.</Spec>
            <Spec icon={<MessageSquare className="size-4" />} title="Canvas chat">A docked conversation per canvas, on any agent Carbon runs.</Spec>
          </div>
        </Band>

        <Band id="faq" className="py-20">
          <Faq group="studio-faq" items={FAQ} title="Before you open a canvas" />
        </Band>
      </main>
    </Page>
  );
}

const FAQ: [string, string][] = [
  [
    "Do I need a design file format or a plugin?",
    "No. A canvas is a .canvas.json file Carbon writes into your project. There is nothing to install beyond Carbon.",
  ],
  [
    "Which token formats can I import?",
    "Markdown files with YAML front matter, yaml or design-tokens code blocks, or CSS custom properties. References like {colors.ink} or var(--color-ink) resolve to their values.",
  ],
  [
    "Does a token change update my designs?",
    "Yes, wherever a layer is bound to that token. Values you typed by hand stay as they are.",
  ],
  [
    "Can the agent draw on the canvas for me?",
    "Not yet. The canvas is yours to draw on. The agent gets your comment, the snapshot and the file path, and does its work in your code.",
  ],
  [
    "Can several projects share a canvas library?",
    "Each canvas belongs to one project, in that project's canvases folder. The dashboard shows them all together, or one project at a time.",
  ],
  [
    "Is it free?",
    "Yes. The Design workspace ships in Carbon, which is free and open source under Apache 2.0.",
  ],
];

/// The hero's four steps in a row, closed by a line running back to the first.
function Loop() {
  const steps: { n: string; title: string; art: ReactNode }[] = [
    {
      n: "01",
      title: "Import tokens",
      art: (
        <div className="flex w-full flex-col gap-1.5 font-mono text-[11px] leading-4">
          <span className="text-white/40 light:text-black/40">DESIGN.md</span>
          {[
            ["ink", "#16140F"],
            ["paper", "#FBFAF7"],
            ["md", "12px"],
          ].map(([k, v]) => (
            <span key={k} className="flex items-center gap-2 rounded-[5px] bg-white/6 px-2 py-1 light:bg-black/4">
              <i className="size-2.5 rounded-[2px] ring-1 ring-white/20" style={{ background: v.startsWith("#") ? v : "transparent" }} />
              <span className="flex-1">{k}</span>
              <span className="text-white/50 light:text-black/50">{v}</span>
            </span>
          ))}
        </div>
      ),
    },
    {
      n: "02",
      title: "Sketch frames",
      art: (
        <div className="flex items-end gap-2">
          <div className="h-[96px] w-[52px] rounded-[3px] bg-[#FBFAF7] p-1.5">
            <i className="block h-1.5 w-7 rounded-sm bg-[#16140F]" />
            <i className="mt-2 block h-2.5 rounded-[2px] border border-[#ECE8DF] bg-white" />
            <i className="mt-1 block h-2.5 rounded-[2px] border border-[#ECE8DF] bg-white" />
            <i className="mt-5 block h-2.5 rounded-[2px] bg-[#16140F]" />
          </div>
          <div className="h-[72px] w-[44px] rounded-[3px] border border-dashed border-[#4b93ff] bg-[#4b93ff14]" />
        </div>
      ),
    },
    {
      n: "03",
      title: "Mark it up",
      art: (
        <div className="relative h-[96px] w-[64px] rounded-[3px] bg-[#FBFAF7] p-1.5">
          <i className="block h-1.5 w-8 rounded-sm bg-[#16140F]" />
          <i className="mt-2 block h-2.5 rounded-[2px] border border-[#ECE8DF] bg-white" />
          <i className="absolute inset-x-1.5 bottom-2 block h-3 rounded-[2px] bg-[#16140F]" />
          <svg viewBox="0 0 80 30" fill="none" className="absolute -bottom-2 -left-2 w-[80px] overflow-visible">
            <ellipse cx="40" cy="15" rx="38" ry="11" stroke={INK} strokeWidth="2" />
          </svg>
          <span className="absolute -top-2 -right-3 flex size-5 items-center justify-center rounded-full rounded-bl-none text-[10px] font-semibold text-white" style={{ background: INK }}>
            1
          </span>
        </div>
      ),
    },
    {
      n: "04",
      title: "Send to chat",
      art: (
        <div className="flex w-full flex-col items-end gap-1.5">
          <div className="h-9 w-12 rounded-[4px] bg-[#FBFAF7] ring-1 ring-white/10" />
          <div className="rounded-[10px] bg-white/10 px-2.5 py-1.5 text-[11px] leading-4 light:bg-black/6">Pin this above the fold.</div>
          <span className="font-mono text-[9.5px] text-white/45 light:text-black/45">Canvas: canvases/checkout…</span>
        </div>
      ),
    },
  ];
  return (
    <div className="relative">
      <ol className="grid gap-px border border-[#FFFFFF26] bg-[#FFFFFF26] sm:grid-cols-2 lg:grid-cols-4 light:border-black/10 light:bg-black/10">
        {steps.map((s) => (
          <li key={s.n} className="flex flex-col bg-black light:bg-white">
            <div className="flex h-[170px] items-center justify-center bg-[#FFFFFF14] px-6 light:bg-[#F4F4F5]" aria-hidden="true">
              {s.art}
            </div>
            <div className="flex items-baseline gap-3 p-5">
              <span className="font-mono text-[11px] text-[#8A8A8A]">{s.n}</span>
              <span className="text-[17px] leading-6 tracking-[-0.01em]">{s.title}</span>
            </div>
          </li>
        ))}
      </ol>
      <svg viewBox="0 0 1000 60" preserveAspectRatio="none" fill="none" className="mt-0 hidden h-12 w-full lg:block" aria-hidden="true">
        <path d="M875 0V30H125V0" stroke="#FFE14D" strokeWidth="1.5" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
        <path d="M118 10L125 0L132 10" stroke="#FFE14D" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="mt-2 text-center text-[13px] text-[#8A8A8A] max-lg:mt-4 light:text-[#6B6B6B]">Then the agent ships it, and you go round again on the next screen.</p>
    </div>
  );
}

function Chapter({ id, title, lead, children }: { id: string; n: string; title: string; lead: string; children: ReactNode }) {
  return (
    <Band id={id} className="py-20">
      <Heading lead={title}>{lead}</Heading>
      <div className="mt-12 lg:mt-20">{children}</div>
    </Band>
  );
}

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/8 text-white light:bg-black/5 light:text-[#0A0A0A]">{icon}</span>
      <div className="flex flex-col gap-1">
        <h3 className="text-[17px] leading-6 tracking-[-0.01em]">{title}</h3>
        <p className={`text-[15px] leading-[22px] ${MUTED}`}>{children}</p>
      </div>
    </div>
  );
}

function Spec({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className={`flex min-h-[170px] flex-col gap-3 border-r border-b p-6 ${LINE}`}>
      <span className="text-white/70 light:text-black/60">{icon}</span>
      <h3 className="text-[17px] leading-6 tracking-[-0.01em]">{title}</h3>
      <p className={`text-[14px] leading-5 ${MUTED}`}>{children}</p>
    </div>
  );
}
