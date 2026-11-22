import { workspaceQuestions } from "../_components/workspaceQuestions";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Checkout, EFFECTS, EffectsPanel, FlexPanel, INK, Library, LOOP, NavPanel, Pin, TokenList } from "../_components/kit";
import { WorkspaceSpecs } from "../_components/WorkspaceSpecs";
import { Fit } from "../_components/Fit";
import m from "../_components/motion.module.css";
import { Band, Faq, Heading, Hero, LINE, MUTED, Page, TILE } from "../_components/shell";
import { HandoffScene, Story } from "../_components/stories";
import { SwitchHero } from "./SwitchHero";

const description =
  "Carbon's Design workspace sits beside the Coding workspace: the same agents and projects, with a canvas for frames, layers, tokens and comments that reach the agent.";

export const metadata: Metadata = {
  title: "Design workspace: same agents, a new surface - Carbon",
  description,
  openGraph: { title: "Carbon Design workspace", description },
};

/// Two workspaces: the switch is the story, and the canvas is shown as the
/// homepage shows the app, part by part in hairline columns.
export default function FieldNotes() {
  return (
    <Page>
      <Hero
        badge="The Design workspace"
        lines={["Same agents.", "A new surface."]}
        description="One switch in Carbon's titlebar turns the chat into a canvas. Your projects, subscriptions and running sessions stay put. Pin a comment on a frame and the agent gets your note with a snapshot of what you mean."
        preview={
          <Story>
            <HandoffScene />
          </Story>
        }
      />

      <main>
        <Band id="switch" className="py-20">
          <Heading lead="Two workspaces, one switch.">Coding for the conversation, Design for the screen. Flip between them any time.</Heading>
          <div className="mt-12 lg:mt-20">
            <SwitchHero />
          </div>
        </Band>

        <Band id="canvas" className="py-20">
          <Heading lead="Everything a screen needs.">Frames, layout, effects and tokens, in the same window as your agents.</Heading>
          <div className={`mt-12 grid border ${LINE} lg:mt-20 lg:grid-cols-3`}>
            <Column
              title="A library in your repo."
              body="Canvases are .canvas.json files under canvases/ in each project. Folders, an archive, and every project in one dashboard."
              art={
                <Fit width={980} height={560}>
                  <Library />
                </Fit>
              }
            />
            <Column
              title="Pages and layers."
              body="Frames hold rectangles, text and more frames. The tree on the left mirrors the board."
              art={
                <Crop scale={0.62} width={236} height={300}>
                  <NavPanel />
                </Crop>
              }
            />
            <Column
              title="Layout you already write."
              body="Flex rows and columns with gap and padding, per-corner radius, typography and blending."
              art={
                <Crop scale={0.56} width={252} height={330}>
                  <FlexPanel />
                </Crop>
              }
            />
            <Column
              title="Stacked effects."
              body={`${EFFECTS.length} kinds, each switchable: gradient fills with any number of stops, shadows, filters and more.`}
              art={
                <Crop scale={0.5} width={252} height={380}>
                  <EffectsPanel />
                </Crop>
              }
            />
            <Column
              title="Tokens from your DESIGN.md."
              body="Import from YAML front matter, yaml or design-tokens blocks, or CSS custom properties. Bound layers follow every change."
              art={
                <Crop scale={0.6} width={236} height={300}>
                  <NavPanel mode="Theme" className="h-full">
                    <TokenList
                      source="storefront/DESIGN.md"
                      tokens={[
                        { kind: "Color", name: "paper", value: "#FBFAF7" },
                        { kind: "Color", name: "ink", value: "#16140F" },
                        { kind: "Radius", name: "md", value: "12px" },
                      ]}
                    />
                  </NavPanel>
                </Crop>
              }
            />
            <Column
              title="Markup that travels."
              body="Circle with the Pen, pin a comment, send it. The snapshot goes with your note."
              art={
                <Story dur="9s" className="relative mx-auto w-[150px]">
                  <div className="flex h-[160px] flex-col justify-end overflow-hidden rounded-[4px]">
                    <Checkout width={150} />
                  </div>
                  <svg viewBox="0 0 310 64" fill="none" className="absolute bottom-[-4px] left-[-10px] w-[170px] overflow-visible" aria-hidden="true">
                    <path d={LOOP} pathLength={1} stroke={INK} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className={m.draw} />
                  </svg>
                  <Pin n={1} className={`absolute bottom-[24px] left-[136px] ${m.pop}`} />
                </Story>
              }
            />
          </div>
        </Band>

        <WorkspaceSpecs showTools />

        <Band id="faq" className="py-20">
          <Faq group="fieldnotes-faq" items={workspaceQuestions} title="Frequently Asked Questions" />
        </Band>
      </main>
    </Page>
  );
}

/// One hairline column, as the homepage's Features draws them.
function Column({ art, title, body }: { art: ReactNode; title: string; body: string }) {
  return (
    <div className={`flex flex-col border-b max-lg:last:border-b-0 lg:border-r lg:nth-[3n]:border-r-0 lg:nth-[n+4]:border-b-0 ${LINE}`}>
      <div className={`flex h-[220px] shrink-0 items-center justify-center overflow-clip p-6 ${TILE}`} aria-hidden="true">
        {art}
      </div>
      <div className={`flex flex-col gap-2 border-t p-6 ${LINE}`}>
        <h3 className="text-xl leading-[26px] tracking-[-0.02em] text-white light:text-[#0A0A0A]">{title}</h3>
        <p className={`text-[15px] leading-[22px] ${MUTED}`}>{body}</p>
      </div>
    </div>
  );
}

/// A drawn panel shrunk to fit a column's art cell, cut off at `height`.
function Crop({ scale, width, height, children }: { scale: number; width: number; height: number; children: ReactNode }) {
  return (
    <div data-app-window className="overflow-hidden rounded-[8px] font-sans text-ui text-foreground shadow-window" style={{ width: width * scale, height: height * scale }}>
      <div className="app-frame" style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}
