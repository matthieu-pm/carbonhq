import type { ReactNode } from "react";
import { DownloadButton } from "@/components/DownloadButton";
import { GitHubGlyph } from "@/components/GitHubGlyph";
import { Closing } from "@/components/home/Closing";
import { SiteNav } from "@/components/home/SiteNav";
import { SourceFrame } from "@/components/home/SourceFrame";
import h from "@/components/home/hero.module.css";
import { REPO } from "@/lib/links";
import { Doodle, cx } from "./kit";

export { Title as Heading } from "@/components/home/Section";

/// The page wrapper every variant shares, the homepage's own: `data-home` for
/// the light scheme, the source frame round everything above the footer.
export function Page({ children }: { children: ReactNode }) {
  return (
    <div data-home className="min-h-screen overflow-x-clip bg-black font-inter text-white antialiased light:bg-white light:text-[#0A0A0A]">
      <SourceFrame rulers>{children}</SourceFrame>
      <Closing />
    </div>
  );
}

/// The homepage hero, with the Design workspace mark in its badge and a
/// playing preview under it in the homepage's preview slot.
export function Hero({ badge, lines, description, preview, guideLink = false }: { badge: string; lines: [string, string]; description: ReactNode; preview: ReactNode; guideLink?: boolean }) {
  return (
    <header id="hero" className="relative overflow-clip bg-black px-5 pb-14 sm:px-8 sm:pb-10 light:bg-white">
      <div className="relative mx-auto w-full max-w-[960px]">
        <SiteNav />
        <div data-page-part="intro" className={h.intro}>
          <div className={h.badge}>
            <span className={h.agentMarks} aria-hidden="true">
              <span><Doodle className="size-3" /></span>
            </span>
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
                {guideLink ? (
                  <a href="/docs/using-carbon/canvases" className={`${h.action} ${h.secondaryAction}`}>
                    Read the canvas guide
                  </a>
                ) : (
                  <a href={REPO} target="_blank" rel="noopener noreferrer" className={`${h.action} ${h.secondaryAction}`}>
                    <GitHubGlyph className="size-4" />
                    View on GitHub
                  </a>
                )}
              </div>
              <p className={h.note}>Free and open source {"{Beta}"}</p>
            </div>
          </div>
        </div>
        <div data-page-part="preview" className={`relative mt-20 ${h.preview}`}>{preview}</div>
      </div>
    </header>
  );
}

/// A full-width band with the site's gutters; `wide` lets drawings reach 1120.
export function Band({ id, wide = false, className, children }: { id?: string; wide?: boolean; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx("relative overflow-clip bg-black px-5 sm:px-8 light:bg-white", className)}>
      <div className={cx("relative mx-auto w-full", wide ? "max-w-[1120px]" : "max-w-[960px]")}>{children}</div>
    </section>
  );
}

export const MUTED = "text-[#8A8A8A] light:text-[#6B6B6B]";
export const SOFT = "text-white/74 light:text-[#0A0A0A]/72";
export const LINE = "border-[#FFFFFF26] light:border-black/10";
export const TILE = "bg-[#FFFFFF1A] light:bg-[#F4F4F5]";
export const LABEL = "font-mono text-[11px] leading-[14px] tracking-[0.06em] uppercase";

/// Download and GitHub, the site's two hero buttons.
export function Actions({ className, secondary = "github" }: { className?: string; secondary?: "github" | "none" }) {
  return (
    <div className={cx("flex flex-wrap gap-3", className)}>
      <DownloadButton
        from="hero"
        className="inline-flex min-h-10 items-center justify-center gap-[9px] rounded-[8px] bg-white px-4 py-2.5 text-[14px] leading-5 font-medium text-[#0A0A0A] shadow-[inset_0_-1px_0_rgb(0_0_0/24%),0_2px_4px_rgb(0_0_0/16%)] transition-transform duration-150 ease-out active:scale-[0.96] light:bg-[#0A0A0A] light:text-white"
      />
      {secondary === "github" && (
        <a
          href={REPO}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center justify-center gap-[9px] rounded-[8px] bg-[#222] px-4 py-2.5 text-[14px] leading-5 font-medium text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/12%)] transition-transform duration-150 ease-out active:scale-[0.96] light:bg-[#F1F1F1] light:text-[#0A0A0A] light:shadow-[inset_0_0_0_1px_rgb(0_0_0/10%)]"
        >
          <GitHubGlyph className="size-4" />
          View on GitHub
        </a>
      )}
    </div>
  );
}

/// Questions as native disclosures, one open at a time, as on the homepage.
export function Faq({ items, group, title = "Questions" }: { items: [string, string][]; group: string; title?: string }) {
  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:gap-24">
      <h2 className="shrink-0 font-inter text-[28px] leading-[32px] font-light tracking-[-0.03em] sm:text-[36px] sm:leading-[40px] lg:w-72">{title}</h2>
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        {items.map(([q, a]) => (
          <details
            key={q}
            name={group}
            className="group bg-[#FFFFFF1A] px-6 py-5 [interpolate-size:allow-keywords] not-open:hover:bg-[#FFFFFF24] open:bg-[#303030] details-content:h-0 details-content:overflow-clip open:details-content:h-auto light:bg-[#F4F4F5] light:not-open:hover:bg-[#EBEBEB] light:open:bg-[#303030] motion-safe:transition-colors motion-safe:details-content:transition-[height,content-visibility] motion-safe:details-content:transition-discrete motion-safe:details-content:duration-300 motion-safe:details-content:ease-out"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 [&::-webkit-details-marker]:hidden">
              <span className="text-lg leading-6 tracking-[-0.02em] text-white light:text-[#0A0A0A] light:group-open:text-white">{q}</span>
              <span aria-hidden className="relative size-[11px] shrink-0 text-[#8A8A8A] group-open:text-white">
                <span className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 bg-current" />
                <span className="absolute inset-x-0 top-1/2 h-[1.5px] -translate-y-1/2 rotate-90 bg-current group-open:rotate-0 motion-safe:transition-transform motion-safe:duration-300" />
              </span>
            </summary>
            <p className="pt-2.5 text-[15px] leading-[22px] text-[#FFFFFFCC]">{a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
