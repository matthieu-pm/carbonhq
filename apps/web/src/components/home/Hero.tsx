import { preload } from "react-dom";
import { ClaudeGlyph } from "@/components/ClaudeGlyph";
import { OpenAIGlyph } from "@/components/OpenAIGlyph";
import { PiGlyph } from "@/components/PiGlyph";
import { GitHubGlyph } from "@/components/GitHubGlyph";
import { REPO } from "@/lib/links";
import { DownloadButton } from "@/components/DownloadButton";
import { Hero as AppWindow } from "@/components/illustrations/Hero";
import h from "./hero.module.css";
import { HeroBackdrop } from "./HeroBackdrop";
import { SiteNav } from "./SiteNav";

/// Nav, headline and the live app window over the pixel-blue backdrop.
export function Hero() {
  // The phone still is the page's LCP, and lazy loading started it only after
  // layout. A preload in <head> starts it at once for the system's scheme; a
  // saved pick that disagrees falls back to the lazy <img> below.
  preload("/hero-mobile.webp", { as: "image", fetchPriority: "high", media: "(max-width: 639px) and (prefers-color-scheme: dark)" });
  preload("/hero-mobile-light.webp", { as: "image", fetchPriority: "high", media: "(max-width: 639px) and (prefers-color-scheme: light)" });

  return (
    <header id="hero" className="relative overflow-clip bg-black px-5 pb-14 sm:px-8 sm:pb-10 light:bg-[linear-gradient(#FFFFFF_900px,#F4F4F2_900px)]">
      <HeroBackdrop introLayout />

      <div className="relative mx-auto w-full max-w-[960px]">
        <SiteNav />

        <div className={h.intro}>
          <div className={h.badge}>
            <span className={h.agentMarks} aria-hidden="true">
              <span><OpenAIGlyph className="size-3" /></span>
              <span><PiGlyph className="size-3" /></span>
              <span><ClaudeGlyph className="size-3" /></span>
            </span>
            Connect any agent harness
          </div>
          <div className={h.introGrid}>
            <h1 className={h.headline}>
              <span>Your agents.</span>
              <span>One place to build.</span>
            </h1>
            <div className={h.supporting}>
              <p className={h.description}>
                Run Claude Code, Codex, and your other coding agents side by side.
                Bring your subscriptions and keep tasks, conversations, and pull requests in one place.
              </p>
              <div className={h.actions}>
                <DownloadButton from="hero" className={`${h.action} ${h.primaryAction}`} />
                <a href={REPO} target="_blank" rel="noopener noreferrer" className={`${h.action} ${h.secondaryAction}`}>
                  <GitHubGlyph className="size-4" />
                  View on GitHub
                </a>
              </div>
              <p className={h.note}>Free and open source {"{Beta}"}</p>
            </div>
          </div>
        </div>

        <div className={`relative mt-20 lg:rounded-[12px] lg:shadow-[0_2px_50px_12px_#0000004D] light:lg:shadow-[0_20px_60px_-20px_#00000040] ${h.preview}`}>
          {/* The live window wants a desktop's width; a phone gets a still of
              it instead of a sideways-scrolling miniature. */}
          <div className={`relative max-sm:hidden ${h.liveCursor}`}>
            <AppWindow />
          </div>
          {/* One per scheme, since the toggle can disagree with the system a
              <picture> media query would follow. Lazy, so the hidden one costs
              nothing. */}
          <img
            src="/hero-mobile.webp"
            alt="Carbon's desktop: navigation rail, task sidebar, agent conversation and pull request checks."
            width={960}
            height={608}
            loading="lazy"
            className="h-auto w-full rounded-[6px] sm:hidden light:hidden"
          />
          <img
            src="/hero-mobile-light.webp"
            alt="Carbon's desktop: navigation rail, task sidebar, agent conversation and pull request checks."
            width={960}
            height={608}
            loading="lazy"
            className="hidden h-auto w-full rounded-[6px] shadow-[0_0_0_1px_#00000014] light:block light:sm:hidden"
          />
        </div>
      </div>
    </header>
  );
}
