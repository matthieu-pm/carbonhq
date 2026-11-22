import type { Metadata } from "next";
import { Archive, FileJson, Folder } from "lucide-react";
import { Section, Title } from "@/components/home/Section";
import { Code, Column, Columns, Intro, Mark, PreviewSlot, Shell } from "../_shared/Shell";
import { InspectorSpecs } from "./InspectorSpecs";
import { StudioPreview } from "./StudioPreview";

export const metadata: Metadata = {
  title: "Design workspace - Carbon",
  description:
    "A canvas inside Carbon, beside your coding agents. Frames, tokens from your DESIGN.md, and comments that reach the agent with a snapshot.",
};

export default function StudioPage() {
  return (
    <Shell
      hero={
        <>
          <Intro
            badge="New: the Design workspace"
            lines={["Design next to", "the agents that build it."]}
            description="A canvas in the same app as your coding agents. Lay out frames, style them with tokens from your DESIGN.md, and pin a comment that reaches the agent with a snapshot attached."
          />
          <PreviewSlot>
            <StudioPreview />
          </PreviewSlot>
        </>
      }
    >
      <Section id="workspace" className="py-20">
        <Title lead="One canvas, three habits.">It lives in your repo, speaks your tokens and talks to your agents.</Title>
        <Columns>
          <Column art={<Files />} title="Every canvas is a file." body={<>New canvas writes <Code>canvases/&lt;name&gt;.canvas.json</Code> into the project. Indented JSON, so a change reads as a diff in review.</>} />
          <Column art={<Tokens />} title="Your DESIGN.md, as tokens." body={<>Import from <Mark>YAML</Mark> front matter, fences or CSS properties. Change a token and every linked layer follows.</>} />
          <Column art={<Comment />} title="Point, and the agent sees it." body="Pin a comment on the canvas. It reaches the canvas's conversation with the page, the spot and a PNG of it." />
        </Columns>
      </Section>

      <Section id="inspector" className="pb-28">
        <Title lead="The details you reach for.">All of it in one inspector, beside the board.</Title>
        <InspectorSpecs />
        <p className="mt-10 text-[15px] leading-[22px] text-[#8A8A8A] light:text-[#6B6B6B] lg:ml-[102px]">
          Choose <span className="text-white light:text-[#0A0A0A]">Design workspace</span> in the titlebar, then <span className="text-white light:text-[#0A0A0A]">New canvas</span>.
        </p>
      </Section>
    </Shell>
  );
}

function Row({ icon, label, depth = 0, on, dim, end }: { icon: React.ReactNode; label: string; depth?: number; on?: boolean; dim?: boolean; end?: string }) {
  return (
    <div
      className={`flex h-[30px] shrink-0 items-center gap-2 pr-2.5 font-mono text-xs leading-4 tracking-[-0.04em] ${on ? "bg-[#525252] text-white" : dim ? "text-[#5A5A5A] light:text-[#A1A1AA]" : "text-[#CFCFCF] light:text-[#3F3F46]"}`}
      style={{ paddingLeft: 10 + depth * 16 }}
    >
      {icon}
      {label}
      {end && <span className="ml-auto text-[11px] text-[#3FB950] light:text-[#1A7F37]">{end}</span>}
    </div>
  );
}

function Files() {
  return (
    <div aria-hidden className="flex flex-col bg-[#0A0A0A] py-1 light:bg-white light:shadow-[0_0_0_1px_#0000000F]">
      <Row icon={<Folder className="size-3" />} label="canvases/" />
      <Row icon={<FileJson className="size-3" />} label="onboarding.canvas.json" depth={1} on end="+12 −3" />
      <Row icon={<Folder className="size-3" />} label="marketing/" depth={1} />
      <Row icon={<Archive className="size-3" />} label=".archive/" depth={1} dim />
    </div>
  );
}

function Tokens() {
  const rows: [string, string, string][] = [
    ["colors.brand", "#4f5bff", "Color"],
    ["rounded.lg", "14px", "Radius"],
    ["spacing.4", "16px", "Spacing"],
  ];
  return (
    <div aria-hidden className="flex flex-col bg-[#0A0A0A] light:bg-white light:shadow-[0_0_0_1px_#0000000F]">
      {rows.map(([name, value, kind], i) => (
        <div key={name} className={`flex h-[34px] items-center gap-2.5 px-2.5 font-mono text-xs tracking-[-0.04em] ${i === 0 ? "bg-[#525252] text-white" : "text-[#CFCFCF] light:text-[#3F3F46]"}`}>
          {kind === "Color" ? <span className="size-3 shrink-0 bg-[#4f5bff]" /> : <span className="size-3 shrink-0 border border-current opacity-60" />}
          {name}
          <span className="ml-auto text-[10px] text-[#8A8A8A]">{value}</span>
        </div>
      ))}
    </div>
  );
}

function Comment() {
  return (
    <div aria-hidden className="flex flex-col gap-2 bg-[#0A0A0A] p-2.5 light:bg-white light:shadow-[0_0_0_1px_#0000000F]">
      <div className="relative h-[86px] overflow-hidden bg-[#282828]">
        <span className="absolute top-3 left-1/2 h-24 w-28 -translate-x-1/2 bg-white" />
        <span className="absolute top-[52px] left-1/2 h-4 w-20 -translate-x-1/2 bg-[#4f5bff]" />
        <svg viewBox="0 0 120 40" className="absolute top-[40px] left-1/2 w-32 -translate-x-1/2" fill="none" stroke="#168bf0" strokeWidth="2" strokeLinecap="round">
          <path d="M8 22 C 30 6, 90 6, 112 20 C 116 34, 20 38, 8 26" />
        </svg>
        <span className="absolute top-[36px] left-[calc(50%+34px)] size-3 rounded-full bg-[#168bf0] shadow-[0_0_0_2px_#fff]" />
      </div>
      <span className="font-mono text-xs leading-4 tracking-[-0.04em] text-white light:text-[#0A0A0A]">Make this full width.</span>
      <span className="font-mono text-[10px] leading-3 tracking-[-0.04em] text-[#8A8A8A]">Page: Welcome (196, 776)</span>
    </div>
  );
}
