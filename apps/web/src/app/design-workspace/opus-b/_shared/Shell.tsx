import type { ReactNode } from "react";
import { Layers, MessageSquare, Pencil } from "lucide-react";
import { DownloadButton } from "@/components/DownloadButton";
import { Closing } from "@/components/home/Closing";
import { SiteNav } from "@/components/home/SiteNav";
import { SourceFrame } from "@/components/home/SourceFrame";
import h from "@/components/home/hero.module.css";

/// The homepage's frame around a Design workspace page: the code gutter,
/// the nav, a black (white in light) hero and the dark closing band.
export function Shell({ hero, children }: { hero: ReactNode; children: ReactNode }) {
  return (
    <div data-home className="min-h-screen overflow-x-clip bg-black font-inter text-white antialiased light:bg-white light:text-[#0A0A0A]">
      <SourceFrame rulers>
        <header id="hero" className="relative overflow-clip bg-black px-5 pb-14 sm:px-8 sm:pb-10 light:bg-white">
          <div className="relative mx-auto w-full max-w-[960px]">
            <SiteNav />
            {hero}
          </div>
        </header>
        <main>{children}</main>
      </SourceFrame>
      <Closing />
    </div>
  );
}

/// The homepage hero's intro block, with the Design workspace's own badge.
export function Intro({ badge, marks, lines, description, note }: { badge: string; marks?: ReactNode; lines: [string, string]; description: ReactNode; note?: string }) {
  return (
    <div data-page-part="intro" className={h.intro}>
      <div className={h.badge}>
        {marks ?? (
          <span className={h.agentMarks} aria-hidden="true">
            <span>
              <Layers className="size-3" />
            </span>
            <span>
              <Pencil className="size-3" />
            </span>
            <span>
              <MessageSquare className="size-3" />
            </span>
          </span>
        )}
        {badge}
      </div>
      <div className={h.introGrid}>
        <h1 className={h.headline}>
          <span>{lines[0]}</span>
          <span>{lines[1]}</span>
        </h1>
        <div className={h.supporting}>
          <p className={h.description}>{description}</p>
          <div className={h.actions}>
            <DownloadButton from="hero" className={`${h.action} ${h.primaryAction}`} />
            <a href="/docs/using-carbon/canvases" className={`${h.action} ${h.secondaryAction}`}>
              Read the canvas guide
            </a>
          </div>
          <p className={h.note}>{note ?? "Free and open source {Beta}"}</p>
        </div>
      </div>
    </div>
  );
}

/// The hero preview's slot, widened past the column on large screens the way
/// the homepage's window is.
export function PreviewSlot({ children, className = "mt-20" }: { children: ReactNode; className?: string }) {
  return <div data-page-part="preview" className={`relative ${className} ${h.preview}`}>{children}</div>;
}

/// The homepage's small mono label.
export const LABEL = "font-mono text-[11px] leading-[14px] tracking-[0.06em] text-[#8A8A8A] uppercase light:text-[#6B6B6B]";

/// The homepage's hairline grid of columns, a drawn panel over a caption.
export function Columns({ children }: { children: ReactNode }) {
  return (
    <div className="mt-12 grid divide-y divide-[#FFFFFF26] border border-[#FFFFFF26] light:divide-black/10 light:border-black/10 lg:mt-20 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
      {children}
    </div>
  );
}

export function Column({ art, title, body }: { art: ReactNode; title: string; body: ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="flex h-[220px] shrink-0 flex-col justify-center overflow-clip bg-[#FFFFFF1A] p-6 light:bg-[#F4F4F5]">{art}</div>
      <div className="flex flex-col gap-2 border-t border-[#FFFFFF26] p-6 light:border-black/10">
        <h3 className="text-xl leading-[26px] tracking-[-0.02em] text-white light:text-[#0A0A0A]">{title}</h3>
        <p className="text-[15px] leading-[22px] text-[#8A8A8A] light:text-[#6B6B6B]">{body}</p>
      </div>
    </div>
  );
}

/// Inline code in body copy.
export function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[0.88em] text-white light:text-[#0A0A0A]">{children}</code>;
}

/// The homepage's yellow highlight.
export function Mark({ children }: { children: ReactNode }) {
  return <mark className="bg-[#FFE14D] px-[3px] text-[#0B0B0F]">{children}</mark>;
}
