import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Section, Title } from "@/components/home/Section";
import { Code, Intro, LABEL, PreviewSlot, Shell } from "../_shared/Shell";
import { FieldnotesPreview } from "./FieldnotesPreview";
import { Anatomy, ConflictDemo, Keys, TokenImport } from "./Notes";

export const metadata: Metadata = {
  title: "Design workspace - Carbon",
  description:
    "Seven notes on Carbon's Design workspace: where a canvas lives, what is in the file, how tokens import, and what a comment sends your agent.",
};

const NOTES = ["Where a canvas lives", "What is in the file", "Tokens you already wrote", "Seven tools, seven keys", "A comment carries a picture", "Two writers, one file", "What a canvas refuses"];

function Note({ n, lead, rest, children, aside }: { n: number; lead: string; rest: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Section id={`note-${n}`} className="scroll-mt-6 py-16 sm:py-20">
      <p className={`mb-5 lg:ml-[102px] ${LABEL}`}>
        Note {String(n).padStart(2, "0")} · {NOTES[n - 1]}
      </p>
      <Title lead={lead}>{rest}</Title>
      <div className="mt-10 flex flex-col gap-6 text-[15px] leading-[22px] text-[#8A8A8A] lg:ml-[102px] light:text-[#6B6B6B]">
        {aside && <div className="max-w-[640px] [&_b]:font-normal [&_b]:text-white light:[&_b]:text-[#0A0A0A] [&>p+p]:mt-3">{aside}</div>}
        {children}
      </div>
    </Section>
  );
}

export default function FieldnotesPage() {
  return (
    <Shell
      hero={
        <>
          <Intro
            badge="Design workspace · fieldnotes"
            lines={["Notes on a canvas", "that saves to your repo."]}
            description="The Design workspace puts the screen you are arguing about and the agent building it in one window. Seven short notes on what it does, where it keeps things, and what it will not do."
          />
          <PreviewSlot>
            <FieldnotesPreview />
          </PreviewSlot>
        </>
      }
    >
      <Section id="contents" className="pt-16">
        <ol className="grid border-y border-[#FFFFFF26] sm:grid-cols-2 lg:ml-[102px] lg:grid-cols-4 light:border-black/10">
          {NOTES.map((title, i) => (
            <li key={title}>
              <a href={`#note-${i + 1}`} className="flex gap-3 py-3 pr-4 text-[15px] leading-[22px] text-[#CFCFCF] transition-colors hover:text-white light:text-[#3F3F46] light:hover:text-[#0A0A0A]">
                <span className="font-mono text-[11px] leading-[22px] text-[#8A8A8A]">{String(i + 1).padStart(2, "0")}</span>
                {title}
              </a>
            </li>
          ))}
        </ol>
      </Section>

      <Note
        n={1}
        lead="In your project, as a file."
        rest="No account, no sync service."
        aside={
          <>
            <p>
              Choose <b>Design workspace</b> in the titlebar, then <b>New canvas</b>, and pick an attached project. Carbon writes <Code>canvases/onboarding.canvas.json</Code> into it, so the canvas is
              committed, branched and reviewed with the code it describes.
            </p>
            <p>
              Folders in the library are folders on disk. Archive moves a canvas to <Code>canvases/.archive</Code>; Restore moves it back.
            </p>
          </>
        }
      >
        {null}
      </Note>

      <Note n={2} lead="One JSON document." rest="Indented, with a trailing newline, so a moved button is a two-line diff." aside={<p>Pick a part to see where it sits.</p>}>
        <Anatomy />
      </Note>

      <Note
        n={3}
        lead="Tokens you already wrote."
        rest="Import them from DESIGN.md and bind them to layers."
        aside={
          <p>
            Open <b>Theme</b> and choose <b>Import tokens</b>. Groups like <Code>colors</Code>, <Code>rounded</Code> and <Code>spacing</Code> set the kind, bare numbers become pixels, and references like{" "}
            <Code>{"{colors.brand}"}</Code> resolve to their value. The window above shows what happens next: change a token, and every layer bound to it repaints.
          </p>
        }
      >
        <TokenImport />
      </Note>

      <Note n={4} lead="Seven tools, seven keys." rest="The toolbar sits at the bottom of the board.">
        <Keys />
      </Note>

      <Note
        n={5}
        lead="A comment carries a picture."
        rest="Words alone are a poor way to point at a screen."
        aside={
          <ol className="flex flex-col border-t border-[#FFFFFF26] light:border-black/10">
            {[
              <>
                Press <b>C</b> and click the spot.
              </>,
              <>Type the comment and send it.</>,
              <>Carbon captures up to 800 × 600 of the board around the pin and draws your pen strokes and the pin on it.</>,
              <>The text, the page and the pin&apos;s position go to the canvas&apos;s conversation, with the PNG attached. The pin is saved once the message is delivered.</>,
            ].map((step, i) => (
              <li key={i} className="flex gap-4 border-b border-[#FFFFFF26] py-3 light:border-black/10">
                <span className="font-mono text-[11px] leading-[22px]">{String(i + 1).padStart(2, "0")}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        }
      >
        {null}
      </Note>

      <Note
        n={6}
        lead="Two writers, one file."
        rest="You on the board, an agent in the file."
        aside={
          <p>
            Carbon saves a moment after each edit and remembers what it last wrote. If the file changed underneath an unsaved edit, it stops and asks. With nothing unsaved, coming back to the window
            loads whatever the agent wrote.
          </p>
        }
      >
        <ConflictDemo />
      </Note>

      <Note
        n={7}
        lead="What a canvas refuses."
        rest="A file an agent wrote is checked before it is drawn."
        aside={
          <ul className="flex flex-col border-t border-[#FFFFFF26] light:border-black/10">
            {[
              <>
                A value that reaches outside the file, through <Code>url()</Code>, <Code>image-set()</Code>, <Code>var()</Code> or <Code>attr()</Code>.
              </>,
              <>An image that is anything but an embedded PNG, JPEG, WebP or GIF.</>,
              <>A style property outside the known set.</>,
              <>A layer inside something that is not a frame, or on another page than its parent.</>,
              <>Two layers, pages or tokens with one id.</>,
            ].map((item, i) => (
              <li key={i} className="flex gap-4 border-b border-[#FFFFFF26] py-3 light:border-black/10">
                <span className="font-mono text-[11px] leading-[22px]">×</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        }
      >
        <p className="pb-8">Three layer kinds, frame, rectangle and text, with images as fills. A canvas only draws what it carries.</p>
      </Note>
    </Shell>
  );
}
