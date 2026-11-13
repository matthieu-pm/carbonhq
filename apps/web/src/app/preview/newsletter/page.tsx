import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteNav } from "@/components/home/SiteNav";

import { BLOCKS, Issue } from "./Issue";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const LABEL = "font-mono text-[11px] leading-[14px] tracking-[0.06em] uppercase";

/// The newsletter email, wireframed in the site's design system. One issue
/// drawn at desktop email width with numbered blocks, and again at phone
/// width. The nav's toggle switches light and dark.
export default function NewsletterPreview() {
  return (
    <div
      data-home
      className="min-h-screen bg-[#141414] px-5 pb-24 font-inter text-white antialiased sm:px-8 light:bg-[#F4F4F2] light:text-[#0A0A0A]"
    >
      <div className="mx-auto w-full max-w-[1120px]">
        <SiteNav bare />
        <h1 className="pt-16 text-[36px] leading-[40px] tracking-[-0.03em]">Newsletter</h1>
        <p className="mt-3 max-w-[640px] text-[16px] leading-[24px] text-[#7C7C7C] light:text-[#8A8A8A]">
          One issue of the email, wireframed. Bracketed copy is a placeholder; everything else is real, taken
          from the 0.30 changelog and the CLI.
        </p>

        <ol className="mt-10 grid max-w-[960px] gap-x-10 gap-y-4 sm:grid-cols-2">
          {BLOCKS.map((b, i) => (
            <li key={b.name} className="grid grid-cols-[32px_1fr] gap-2">
              <span className="font-mono text-[11px] leading-5 text-[oklch(0.82_0.13_230)] light:text-[oklch(0.55_0.16_245)]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[14px] leading-5">
                <span className="font-medium">{b.name}.</span>{" "}
                <span className="text-[#7C7C7C] light:text-[#8A8A8A]">{b.note}</span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-16 flex flex-wrap items-start gap-x-16 gap-y-16 pl-10">
          <Frame label="Desktop · 600px" width="w-[600px]">
            <Issue annotate />
          </Frame>
          <Frame label="Mobile · 375px" width="w-[375px]">
            <Issue />
          </Frame>
        </div>
      </div>
    </div>
  );
}

/// One fixed-width rendering of the email. `@container` is what the issue's
/// `@md:` classes answer to, standing in for an email's media queries. Nothing
/// here clips, or the pins in the left gutter go with it; the issue rounds itself.
function Frame({ label, width, children }: { label: string; width: string; children: ReactNode }) {
  return (
    <figure className={`${width} shrink-0`}>
      <figcaption className={`mb-3 ${LABEL} text-[#7C7C7C] light:text-[#8A8A8A]`}>{label}</figcaption>
      <div className="@container rounded-[10px] shadow-window ring-1 ring-white/10 light:ring-black/10">
        {children}
      </div>
    </figure>
  );
}
