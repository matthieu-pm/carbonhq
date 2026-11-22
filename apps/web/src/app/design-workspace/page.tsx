import type { Metadata } from "next";
import { AgentMarks } from "@/components/home/AgentMarks";
import { Section, Title } from "@/components/home/Section";
import { BoardTour } from "./_components/BoardTour";
import { SwitchHero } from "./fieldnotes/SwitchHero";
import { Intro, PreviewSlot, Shell } from "./opus-b/_shared/Shell";
import { CanvasPreview } from "./opus-b/canvas/CanvasPreview";
import { FieldnotesPreview } from "./opus-b/fieldnotes/FieldnotesPreview";

export const metadata: Metadata = {
  title: "Design workspace - Carbon",
  description: "Draw on a canvas beside your coding agent, repaint linked layers with design tokens, and send feedback with a snapshot of the exact spot.",
};

export default function DesignWorkspacePage() {
  return (
    <Shell
      hero={
        <>
          <Intro
            badge="Design with any agent"
            marks={<AgentMarks />}
            lines={["Design the screen.", "Build it with your agent."]}
            description="Sketch with your project’s colors and type. Pin a comment where you want a change, and your agent sees your note and a snapshot of that spot in chat."
          />
          <PreviewSlot>
            <CanvasPreview windowOnly />
          </PreviewSlot>
        </>
      }
    >
      <Section id="switch" className="py-20">
        <Title lead="One switch, a new surface.">Flip from Coding to Design and the chat becomes a canvas.</Title>
        <div className="mt-12 lg:mt-20">
          <SwitchHero />
        </div>
      </Section>

      <Section id="tokens" className="py-20">
        <Title lead="Change a token, repaint the screen.">Edit the brand color or corner radius and every linked layer follows.</Title>
        <div className="mt-12 lg:mt-20">
          <FieldnotesPreview />
        </div>
      </Section>

      <Section id="board" className="py-20">
        <Title lead="Every size, one board.">Phone to poster, each frame at its real size. Select one to zoom in.</Title>
        <div className="mt-12 lg:mt-20">
          <BoardTour />
        </div>
      </Section>
    </Shell>
  );
}
