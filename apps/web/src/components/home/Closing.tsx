import Link from "next/link";
import { ClosingCards } from "@/components/home/ClosingCards";
import { PlayWhenVisible } from "@/components/home/PlayWhenVisible";
import { Title } from "@/components/home/Section";
import { Stripes } from "@/components/home/Stripes";
import { LINKEDIN, REPO, X_PROFILE } from "@/lib/links";
import styles from "./footer-walkers.module.css";

const LABEL = "font-mono text-[11px] leading-[14px] tracking-[0.06em] text-white/70 uppercase";

const LINKS = [
  { label: "Docs", href: "/docs" },
  { label: "Changelog", href: "/changelog" },
  { label: "llms.txt", href: "/llms.txt" },
  { label: "GitHub", href: REPO, out: true },
  { label: "X", href: X_PROFILE, out: true },
  { label: "LinkedIn", href: LINKEDIN, out: true },
];

export function Closing() {
  return (
    <section data-scheme="dark" className="relative flex flex-col overflow-clip bg-[#141414] px-5 pt-[120px] sm:px-8 lg:min-h-[960px]">
      <Stripes />
      <div data-page-part="intro" className="relative mx-auto w-full max-w-[960px]">
        <Title lead="Your subscription, your favourite harness.">
          <span className="text-white sm:block">Mix and switch freely.</span>
        </Title>

        <div className="mt-10"><ClosingCards /></div>
      </div>

      <footer data-page-part="footer" id="footer" className="relative -mx-5 mt-[120px] px-5 sm:-mx-8 sm:px-8 lg:mt-auto">
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
