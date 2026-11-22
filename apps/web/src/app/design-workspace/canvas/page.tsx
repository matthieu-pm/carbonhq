import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fit } from "../_components/Fit";
import {
  ChatDock,
  Checkout,
  CommentBox,
  EFFECTS,
  EffectsPanel,
  FlexPanel,
  INK,
  Library,
  LOOP,
  Pin,
  RepoTree,
  Shot,
} from "../_components/kit";
import m from "../_components/motion.module.css";
import { Band, Faq, Heading, Hero, LABEL, LINE, MUTED, Page, TILE } from "../_components/shell";
import { InspectScene, Story } from "../_components/stories";
import { ToolPicker } from "./ToolPicker";

const description =
  "Carbon's Design workspace puts a canvas one click from your coding agents. Draw frames, style layers, circle what's wrong and send it to the conversation building it.";

export const metadata: Metadata = {
  title: "Design workspace: sketch the screen, hand it to your agent - Carbon",
  description,
  openGraph: { title: "Carbon Design workspace", description },
};

/// The board: the editor itself is the hero, and each section below zooms into one part of it.
export default function CanvasPage() {
  return (
    <Page>
        <Hero
          badge="The Design workspace"
          lines={["Sketch the screen.", "Hand it to your agent."]}
          description="Switch Carbon from Coding to Design and you get a canvas. Draw frames, style layers with your project's tokens, then pin a comment where something's wrong and send it to the conversation building it."
          preview={
            <Story>
              <InspectScene />
            </Story>
          }
        />

        <main>
          <Band className="pb-24">
            <ol className={`grid border ${LINE} sm:grid-cols-2 lg:grid-cols-4`}>
              <Legend n={1} title="Pages and layers">Split a canvas into pages. Every frame, shape and text layer sits in one tree.</Legend>
              <Legend n={2} title="Seven tools">Select, Hand, Frame, Rectangle, Text, Pen and Comment, one key each.</Legend>
              <Legend n={3} title="Inspector">Size, layout, radius, blending and a stack of effects for whatever is selected.</Legend>
              <Legend n={4} title="Canvas chat">A conversation docked beside the board, on any agent Carbon runs.</Legend>
            </ol>
          </Band>

          <Band id="tools" className="py-20">
            <Heading lead="One key per tool." className="max-w-[720px]">
              Press a letter and draw. The bar floats at the foot of the board, out of the way.
            </Heading>
            <div className="mt-12 lg:mt-16">
              <ToolPicker />
            </div>
          </Band>

          <Band id="inspector" className="py-20">
            <Heading lead="Real layout. Real effects." className="max-w-[720px]">
              Stack frames in rows or columns, then layer fills, borders and shadows on top.
            </Heading>
            <div className={`mt-12 grid border ${LINE} lg:mt-16 lg:grid-cols-2`}>
              <Panel
                art={
                  <Shot label="The Flex section: a frame laid out as a column, its gap and padding bound to spacing tokens." className="mx-auto">
                    <FlexPanel />
                  </Shot>
                }
                title="Flex, as you would write it."
                body="Direction, alignment, justification, wrap, gap and padding. Bind gap and padding to spacing tokens so they change with the theme."
              />
              <Panel
                art={
                  <Shot label="The effect stack: a linear gradient fill, with outline, border, shadow, inner shadow, filter and backdrop filter below it." className="mx-auto">
                    <EffectsPanel />
                  </Shot>
                }
                title="A stack of effects."
                body={
                  <>
                    Gradients with as many stops as you like, solid, radial, conic and image fills, each effect switchable on its own.
                    <span className="mt-4 flex flex-wrap gap-1.5">
                      {EFFECTS.map((e) => (
                        <span key={e} className="rounded-full border border-white/15 px-2.5 py-0.5 text-[12px] text-white/80 light:border-black/12 light:text-[#0A0A0A]/75">
                          {e}
                        </span>
                      ))}
                    </span>
                  </>
                }
              />
            </div>
          </Band>

          <Band id="markup" className="py-20">
            <Heading lead="Circle it. Say it. Send it." className="max-w-[720px]">
              Point at the problem instead of describing where it is.
            </Heading>
            <Story dur="9s" className={`mt-12 grid gap-px border ${LINE} bg-[#FFFFFF26] lg:mt-16 lg:grid-cols-3 light:bg-black/10`}>
              <Step n="01" title="Draw on the board" body="Take the Pen and mark the design up, the way you would on a printout.">
                <div className="relative mx-auto w-[220px]">
                  <Crop>
                    <Checkout width={220} />
                  </Crop>
                  <svg viewBox="0 0 310 64" fill="none" className="absolute bottom-[-4px] left-[-14px] w-[248px] overflow-visible">
                    <path d={LOOP} pathLength={1} stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className={m.draw} />
                  </svg>
                </div>
              </Step>
              <Step n="02" title="Pin a comment" body="Drop a numbered pin on the spot and write what you mean.">
                <div className="relative mx-auto w-[220px]">
                  <Crop>
                    <Checkout width={220} />
                  </Crop>
                  <Pin n={1} className={`absolute bottom-[34px] left-[196px] ${m.pop}`} />
                  <CommentBox text="Keep this visible on small phones." className={`absolute bottom-[64px] left-[-10px] w-[240px] ${m.rise}`} />
                </div>
              </Step>
              <Step n="03" title="It lands in the chat" body="Your note arrives with a snapshot of the board and the canvas's path.">
                <div className={`mx-auto h-[300px] w-[300px] overflow-hidden rounded-[10px] ${m.riseLate}`}>
                  <Shot label="The canvas chat: the comment with its snapshot and canvas path, and the agent's reply." className="h-full w-full rounded-[10px]">
                    <ChatDock className="h-full w-full border-l-0" note="Keep this visible on small phones." />
                  </Shot>
                </div>
              </Step>
            </Story>
          </Band>

          <Band id="repo" className="py-20">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16">
              <div>
                <Heading lead="Your canvases live in your repo." className="lg:ml-0!">Next to the code they describe.</Heading>
                <ul className={`mt-8 flex flex-col gap-4 text-[15px] leading-[22px] ${MUTED}`}>
                  <Fact title="Plain files.">Each canvas is a .canvas.json file in a canvases folder at the project root. Commit it, branch it, review it.</Fact>
                  <Fact title="Folders are folders.">Group canvases however your team thinks. Move one between folders from the library.</Fact>
                  <Fact title="Archive, don&rsquo;t delete.">Archived canvases move aside into canvases/.archive and restore in one click.</Fact>
                  <Fact title="Every project at once.">The dashboard lists canvases from all your attached projects, or one at a time.</Fact>
                </ul>
              </div>
              <div className={`flex items-center border ${LINE} ${TILE} py-6`}>
                <RepoTree className="w-full" />
              </div>
            </div>
            <div className="mt-16 max-sm:hidden">
              <Fit width={980} height={560}>
                <Library />
              </Fit>
            </div>
          </Band>

          <Band id="faq" className="py-20">
            <Faq group="canvas-faq" items={FAQ} />
          </Band>
        </main>
    </Page>
  );
}

const FAQ: [string, string][] = [
  [
    "Is the Design workspace a separate app?",
    "No. It is a switch in Carbon's titlebar, beside your coding sessions. Same app, same projects, same agents.",
  ],
  [
    "Where are canvases saved?",
    "In your project, in a canvases folder at its root. Each canvas is one .canvas.json file, so it travels with the repo like any other file.",
  ],
  [
    "What does the agent see when I send a comment?",
    "Your note, a snapshot of the board as a picture, and the path to the canvas file. The agent can open that file like any other file in the project.",
  ],
  [
    "Can I use my design tokens?",
    "Yes. The Theme tab imports tokens from a Markdown file in any attached project, such as a DESIGN.md. It reads YAML front matter, yaml or design-tokens code blocks, and CSS custom properties.",
  ],
  [
    "Which agents work in the canvas chat?",
    "Any agent Carbon runs, including Claude Code, Codex, Grok Build, pi and fx. The canvas chat is an ordinary Carbon conversation.",
  ],
  [
    "What does it cost?",
    "Nothing. The Design workspace is part of Carbon, which is free and open source. Your agents run on the subscriptions you already have.",
  ],
];

function Legend({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className={`flex flex-col gap-2 border-b p-6 last:border-b-0 sm:nth-[odd]:border-r lg:border-r lg:border-b-0 lg:last:border-r-0 ${LINE}`}>
      <span className="flex size-6 items-center justify-center rounded-full bg-[#FFE14D] text-[12px] font-semibold text-[#0B0B0F]">{n}</span>
      <span className="mt-2 text-[17px] leading-6 tracking-[-0.01em]">{title}</span>
      <span className={`text-[14px] leading-5 ${MUTED}`}>{children}</span>
    </li>
  );
}

function Panel({ art, title, body }: { art: ReactNode; title: string; body: ReactNode }) {
  return (
    <div className={`flex flex-col border-b last:border-b-0 lg:border-r lg:border-b-0 lg:last:border-r-0 ${LINE}`}>
      <div className={`flex h-[480px] items-center justify-center overflow-clip p-8 ${TILE}`}>{art}</div>
      <div className={`flex flex-col gap-2 border-t p-6 ${LINE}`}>
        <h3 className="text-xl leading-[26px] tracking-[-0.02em]">{title}</h3>
        <div className={`text-[15px] leading-[22px] ${MUTED}`}>{body}</div>
      </div>
    </div>
  );
}

function Step({ n, title, body, children }: { n: string; title: string; body: string; children: ReactNode }) {
  return (
    <div className="flex flex-col bg-black light:bg-white">
      <div className={`flex h-[360px] items-center justify-center overflow-clip px-6 ${TILE}`}>{children}</div>
      <div className="flex flex-col gap-2 p-6">
        <span className={`${LABEL} ${MUTED}`}>{n}</span>
        <h3 className="text-xl leading-[26px] tracking-[-0.02em]">{title}</h3>
        <p className={`text-[15px] leading-[22px] ${MUTED}`}>{body}</p>
      </div>
    </div>
  );
}

/// The lower part of a checkout frame, which is where every markup example points.
function Crop({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[260px] flex-col justify-end overflow-hidden rounded-[6px] [mask-image:linear-gradient(to_bottom,transparent,black_30%)]">
      {children}
    </div>
  );
}

function Fact({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <span className="text-white light:text-[#0A0A0A]">{title}</span> {children}
    </li>
  );
}
