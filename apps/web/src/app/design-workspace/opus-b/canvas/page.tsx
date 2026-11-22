import type { Metadata } from "next";
import { Section, Title } from "@/components/home/Section";
import { Code, Intro, LABEL, PreviewSlot, Shell } from "../_shared/Shell";
import { CanvasPreview } from "./CanvasPreview";
import { EffectsDemo, LibraryDemo } from "./Demos";

export const metadata: Metadata = {
  title: "Design workspace - Carbon",
  description:
    "Draw on a frame, pin a comment, and it reaches your coding agent with a snapshot of the spot you meant. Carbon's canvas saves to your repo.",
};

const FILE = `{
  "version": 1,
  "pages": [{
    "id": "page-1",
    "name": "Welcome",
    "background": "#282828",
    "strokes": [{ "id": "s1", "points": [[14, 734], [60, 712], …] }],
    "comments": [{
      "id": "c1", "x": 338, "y": 752,
      "text": "Make it full width, clear of the home bar."
    }]
  }],
  "elements": [{
    "id": "button", "kind": "Frame", "name": "Button",
    "parent": "welcome", "x": 32, "y": 744,
    "style": { "width": "329px", "height": "60px", … },
    "effects": [{ "kind": "Fill", "fields": { "color": "@brand" } }]
  }, …],
  "tokens": [{ "id": "brand", "kind": "Color", "value": "#4f5bff" }]
}`;

export default function CanvasPage() {
  return (
    <Shell
      hero={
        <>
          <Intro
            badge="Design workspace"
            lines={["Point at the pixel.", "The agent gets the picture."]}
            description="Carbon's canvas sits beside your coding agents. Circle a problem with the pen, pin a comment on it, and the agent receives your words with a snapshot of the exact spot."
          />
          <PreviewSlot>
            <CanvasPreview />
          </PreviewSlot>
        </>
      }
    >
      <Section id="file" className="py-20">
        <Title lead="That board is a file.">Strokes, pins and layers are plain JSON in your project.</Title>
        <div className="mt-12 grid gap-10 lg:mt-20 lg:ml-[102px] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-4 text-[15px] leading-[22px] text-[#8A8A8A] light:text-[#6B6B6B]">
            <p>
              Every canvas is indented JSON under the project&apos;s <Code>canvases/</Code> folder. Carbon writes it a moment after each edit, and your pen
              strokes and comment pins save with the page.
            </p>
            <p>Agents read it like any other file in the repo. If one changes it while you still have unsaved edits, Carbon stops and asks: keep your edits, or reload from disk.</p>
            <p>A file that points outside itself, through a remote URL or an unknown style, is refused rather than drawn.</p>
          </div>
          <div className="min-w-0 border border-[#FFFFFF26] light:border-black/10">
            <div className={`border-b border-[#FFFFFF26] bg-[#FFFFFF1A] px-4 py-2.5 light:border-black/10 light:bg-[#F4F4F5] ${LABEL}`}>canvases/onboarding.canvas.json</div>
            <pre className="overflow-x-auto bg-[#0A0A0A] p-4 font-mono text-xs leading-5 tracking-[-0.02em] text-[#CFCFCF] light:bg-white light:text-[#3F3F46]">{FILE}</pre>
          </div>
        </div>
      </Section>

      <Section id="effects" className="pb-20">
        <Title lead="Stack effects, hide one to compare.">Fills, borders, shadows, filters and text strokes, in the order they stack.</Title>
        <div className="mt-12 lg:mt-20">
          <EffectsDemo />
        </div>
      </Section>

      <Section id="library" className="pb-28">
        <Title lead="Find any canvas in any project.">Search, filter, sort into folders, archive what you&apos;re done with.</Title>
        <div className="mt-12 lg:mt-20">
          <LibraryDemo />
        </div>
      </Section>
    </Shell>
  );
}
