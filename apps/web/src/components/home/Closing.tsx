"use client";

import Link from "next/link";
import { ClosingCards } from "@/components/home/ClosingCards";
import { PlayWhenVisible } from "@/components/home/PlayWhenVisible";
import { Title } from "@/components/home/Section";
import { Stripes } from "@/components/home/Stripes";
import { REPO } from "@/lib/links";
import styles from "./footer-walkers.module.css";

const LABEL = "font-mono text-[11px] leading-[14px] tracking-[0.06em] text-white/70 uppercase";

const LINKS = [
  { label: "Docs", href: "/docs" },
  { label: "Changelog", href: "/changelog" },
  { label: "llms.txt", href: "/llms.txt" },
  { label: "GitHub", href: REPO, out: true },
  { label: "X", href: "https://x.com/carbonhq_", out: true },
  { label: "LinkedIn", href: "https://www.linkedin.com/company/carbonhq-global/", out: true },
];

/// The last blue band: the closing line, both ways in, and the footer.
export function Closing() {
  return (
    <section data-scheme="dark" className="relative flex flex-col overflow-clip bg-[#1612F8] px-5 pt-[120px] sm:px-8 lg:min-h-[960px]">
      <Stripes />
      <Tiles />

      <div className="relative mx-auto w-full max-w-[960px]">
        <Title lead="Your subscription, your favourite harness.">
          <span className="text-white sm:block">Mix and switch freely.</span>
        </Title>

        <div className="mt-10"><ClosingCards /></div>
      </div>

      <footer id="footer" className="relative -mx-5 mt-[120px] px-5 sm:-mx-8 sm:px-8 lg:mt-auto">
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 pb-[220px] sm:flex-row sm:items-center sm:justify-between lg:pb-[276px]">
          <p className={LABEL}>© {new Date().getFullYear()} Carbon</p>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                {...(l.out ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className={`${LABEL} transition-colors hover:text-white`}
              >
                {l.label}
              </a>
            ))}
          </nav>
          <p className={LABEL}>Free and open source</p>
        </div>
        <PlayWhenVisible className={styles.runway}>
          <Link href="/game" prefetch={false} aria-label="Play Tower Shift" className={`${styles.walker} ${styles.operator}`} />
          <Link href="/game" prefetch={false} aria-label="Play Tower Shift" className={`${styles.walker} ${styles.pi}`} />
        </PlayWhenVisible>
      </footer>
    </section>
  );
}

/// The darker tile band along the foot and a few loose lit tiles, anchored to
/// the bottom so the band stays at the foot however tall the stack gets. The
/// drawn 1440 sits in the middle of 3840, so wide screens get more of the band.
function Tiles() {
  return (
    <svg
      aria-hidden
      viewBox="-1200 0 3840 960"
      width="3840"
      height="960"
      shapeRendering="crispEdges"
      className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2"
    >
      <path d="M-1200 900h3840v60h-3840z" fill="#00000033" />
      <path
        d="M0 840h180v60h-180zM1020 840h300v60h-300zM-1080 840h120v60h-120zM-540 840h240v60h-240zM1560 840h180v60h-180zM2100 840h240v60h-240z"
        fill="#0000001A"
      />
      <path
        d="M0 780h180v60h-180zM180 840h120v60h-120zM480 840h240v60h-240zM960 840h60v60h-60zM1020 780h300v60h-300zM1320 840h60v60h-60zM120 600h60v60h-60zM660 540h60v60h-60zM1260 600h60v60h-60zM-900 840h180v60h-180zM-660 780h120v60h-120zM-240 840h180v60h-180zM-300 600h60v60h-60zM-840 480h60v60h-60zM1500 780h120v60h-120zM1680 840h120v60h-120zM1920 840h60v60h-60zM2160 780h120v60h-120zM1620 540h60v60h-60zM2040 600h60v60h-60z"
        fill="#FFFFFF14"
      />
    </svg>
  );
}
