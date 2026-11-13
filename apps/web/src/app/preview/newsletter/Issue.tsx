import type { ReactNode } from "react";

import { Wordmark } from "@/components/Wordmark";
import { INSTALL_LINE } from "@/lib/links";

const LABEL = "font-mono text-[11px] leading-[14px] tracking-[0.06em] uppercase";
const MUTED = "text-[#7C7C7C] light:text-[#8A8A8A]";
const BODY = "text-[15px] leading-[24px] text-[#A3A3A3] light:text-[#525252]";
const STRONG = "text-white light:text-[#0A0A0A]";
const HAIRLINE = "border-white/10 light:border-black/10";
const LINK = `${STRONG} underline decoration-white/30 underline-offset-4 light:decoration-black/30`;
const GUTTER = "px-5 @md:px-10";

/// The blocks of one issue, in reading order. Numbers match the pins on the
/// annotated frame and the legend above it.
export const BLOCKS = [
  { name: "Masthead", note: "Preheader, wordmark, issue number. The preheader is what the inbox shows beside the subject." },
  { name: "Lead", note: "One headline in the site's white-lead, grey-tail style, a hero image and one button." },
  { name: "Release notes", note: "Pulled from CHANGELOG.md, grouped New / Improved / Fixed with the changelog's own squares." },
  { name: "Feature deep-dive", note: "One feature, one GIF, two short paragraphs, one link to the docs." },
  { name: "Tips & workflows", note: "Three numbered tips, each ending in a command the reader can paste." },
  { name: "Community / links", note: "A quote from a user, then outside links worth reading." },
  { name: "Closing band", note: "The homepage's blue band: both ways in, then the legal footer." },
] as const;

/// One newsletter issue. Laid out against its own container rather than the
/// viewport, so one component draws both the desktop and the mobile frame the
/// way an email's media queries would.
export function Issue({ annotate = false }: { annotate?: boolean }) {
  const pin = (n: number) => (annotate ? <Pin n={n} /> : null);

  return (
    <article className="rounded-[10px] bg-black font-inter antialiased light:bg-white">
      <header className="relative">
        {pin(1)}
        <div className={`flex items-center justify-between gap-4 border-b py-2.5 ${HAIRLINE} ${GUTTER}`}>
          <p className={`truncate text-[12px] leading-[14px] ${MUTED}`}>
            0.30 is in beta, the pinned summary up close, three ways to fan out.
          </p>
          <a className={`${LABEL} ${MUTED} shrink-0`}>View online</a>
        </div>
        <div className={`flex items-center justify-between pt-8 pb-10 ${GUTTER}`}>
          <Wordmark className={`h-[22px] w-auto ${STRONG}`} />
          <p className={`${LABEL} ${MUTED}`}>No. 07 · Nov 2026</p>
        </div>
      </header>

      <Block n={2} annotate={annotate}>
        <h1 className="font-inter text-[26px] leading-[30px] font-light tracking-[-0.03em] text-balance text-[#7C7C7C] @md:text-[32px] @md:leading-[36px] light:text-[#8A8A8A]">
          <span className={STRONG}>Carbon 0.30 is in beta.</span> A rail for everything that isn&apos;t a
          session, remote MCP servers, and a summary that stays put.
        </h1>
        <p className={`mt-4 ${BODY}`}>
          Four betas in two weeks. Here is what changed, one feature up close, and a few ways people are running
          more than one agent at once.
        </p>
        <Placeholder label="Hero · 0.30 window, rail open" ratio="aspect-[16/10]" className="mt-8" />
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Button>Get the beta</Button>
          <a className={`text-[14px] leading-5 ${LINK}`}>Read the changelog</a>
        </div>
      </Block>

      <Block n={3} annotate={annotate} label="What shipped · 0.30.0-beta.1–4">
        <div className={`border-y ${HAIRLINE}`}>
          <Group kind="new">
            <Item title="Navigation rail.">Home, Issues, usage and Settings get their own rail, with Back and Forward.</Item>
            <Item title="Remote MCP servers.">Add and manage them from Settings.</Item>
          </Group>
          <Group kind="improved">
            <Item title="Context breakdown.">See what fills a Claude Code session&apos;s context window.</Item>
            <Item title="Appearance.">Interface and code font sizes are set separately.</Item>
            <Item title="Issue details.">Linear issues show relations, sub-issues and cycles.</Item>
          </Group>
          <Group kind="fixed">
            <Item title="Mac connection after install.">The background server no longer points at an ejected disk image.</Item>
            <Item title="Tabs.">Keep their state when switching views.</Item>
          </Group>
        </div>
        <a className={`mt-5 inline-block text-[14px] leading-5 ${LINK}`}>Full changelog</a>
      </Block>

      <Block n={4} annotate={annotate} label="Up close">
        <Placeholder label="GIF · summary docks as a rail" ratio="aspect-[3/2]" />
        <h2 className={`mt-6 text-[20px] leading-[26px] tracking-[-0.02em] ${STRONG}`}>The pinned summary, docked.</h2>
        <p className={`mt-3 ${BODY}`}>
          Close the right panel and the summary docks beside the chat as a full-height rail. Open it again and the
          summary floats as a card. Either way the chat stays where it was.
        </p>
        <p className={`mt-3 ${BODY}`}>
          It now carries the agent&apos;s task list and, for Claude Code, what fills the context window: messages,
          tools, system prompt, skills, memory and the room left.
        </p>
        <a className={`mt-5 inline-block text-[14px] leading-5 ${LINK}`}>How the summary works</a>
      </Block>

      <Block n={5} annotate={annotate} label="Workflow">
        <h2 className={`text-[20px] leading-[26px] tracking-[-0.02em] ${STRONG}`}>Three ways to fan out.</h2>
        <ol className="mt-6 flex flex-col gap-6">
          <Tip n="01" title="Hand a review to another agent." command="carbon session new --base <id> --harness codex">
            A second session starts from this one&apos;s branch and sends its findings back.
          </Tip>
          <Tip n="02" title="Let the agent look at the page." command="carbon browser open http://localhost:3000">
            Every session has its own browser. The agent opens, reads and clicks it like you would.
          </Tip>
          <Tip n="03" title="Park a task for later." command='carbon draft new "Move settings to the rail"'>
            Drafts keep the prompt and every pick, and wait in the sidebar until you start them.
          </Tip>
        </ol>
      </Block>

      <Block n={6} annotate={annotate} label="From the crew">
        <figure className={`rounded-[10px] border p-5 @md:p-6 ${HAIRLINE} bg-white/[0.03] light:bg-black/[0.02]`}>
          <blockquote className={`text-[17px] leading-[26px] tracking-[-0.01em] ${STRONG}`}>
            &ldquo;[Quote from a user, two lines at most. What they run in Carbon and what it replaced.]&rdquo;
          </blockquote>
          <figcaption className="mt-5 flex items-center gap-3">
            <span className="size-8 shrink-0 rounded-full bg-white/15 light:bg-black/10" />
            <span className="flex flex-col">
              <span className={`text-[14px] leading-5 ${STRONG}`}>[Name]</span>
              <span className={`${LABEL} ${MUTED}`}>[Role · company]</span>
            </span>
          </figcaption>
        </figure>

        <p className={`mt-10 ${LABEL} ${MUTED}`}>Worth reading</p>
        <ul className={`mt-3 divide-y border-y ${HAIRLINE} divide-white/10 light:divide-black/10`}>
          <Link title="[Article or video title]" source="[domain.com]" />
          <Link title="[A user's write-up of their setup]" source="[blog.example]" />
          <Link title="[Release from a harness Carbon runs]" source="[github.com]" />
        </ul>
      </Block>

      <Closing annotate={annotate} />
    </article>
  );
}

/// A section of the issue: hairline above, an optional mono label, content.
function Block({ n, annotate, label, children }: { n: number; annotate: boolean; label?: string; children: ReactNode }) {
  return (
    <section className={`relative border-t py-10 @md:py-12 ${HAIRLINE} ${GUTTER}`}>
      {annotate && <Pin n={n} />}
      {label && <p className={`mb-6 ${LABEL} ${MUTED}`}>{label}</p>}
      {children}
    </section>
  );
}

/// The changelog page's squares. Yellow and red stay out, as there: in the
/// app they mean "wants you" and "failed".
const KIND = {
  new: { label: "New", square: "bg-[#3DD68C] light:bg-[#0B8A5A]" },
  improved: { label: "Improved", square: "bg-[#1612F8]" },
  fixed: { label: "Fixed", square: "bg-[#C98BFF] light:bg-[#8526D1]" },
} as const;

/// One kind of change. Label beside the list on desktop, above it on mobile,
/// which is a two-cell table row in the real email.
function Group({ kind, children }: { kind: keyof typeof KIND; children: ReactNode }) {
  const k = KIND[kind];
  return (
    <div className={`grid gap-3 border-t py-5 first:border-t-0 @md:grid-cols-[112px_1fr] @md:gap-6 ${HAIRLINE}`}>
      <p className={`flex h-5 items-center gap-2 ${LABEL} ${STRONG}`}>
        <span aria-hidden className={`size-2 shrink-0 ${k.square}`} />
        {k.label}
      </p>
      <ul className="flex flex-col gap-2.5">{children}</ul>
    </div>
  );
}

function Item({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="text-[14px] leading-[22px] text-[#A3A3A3] light:text-[#525252]">
      <span className={`font-medium ${STRONG}`}>{title}</span> {children}
    </li>
  );
}

function Tip({ n, title, command, children }: { n: string; title: string; command: string; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-3 @md:grid-cols-[40px_1fr]">
      <span className={`pt-[3px] ${LABEL} ${MUTED}`}>{n}</span>
      <div className="min-w-0">
        <p className={`text-[15px] leading-[22px] font-medium ${STRONG}`}>{title}</p>
        <p className="mt-1 text-[14px] leading-[22px] text-[#A3A3A3] light:text-[#525252]">{children}</p>
        {/* Scrolls rather than wraps, since a command broken over two lines
            reads as two commands. In the email it is a plain monospace cell. */}
        <code className="mt-3 block overflow-x-auto rounded-[6px] border border-white/10 bg-white/[0.06] px-3 py-2 font-mono text-[12px] leading-[18px] whitespace-nowrap text-[#CFCFCF] light:border-black/10 light:bg-black/[0.04] light:text-[#0A0A0A]">
          {command}
        </code>
      </div>
    </li>
  );
}

function Link({ title, source }: { title: string; source: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-3.5">
      <span className={`min-w-0 text-[14px] leading-5 ${STRONG}`}>{title}</span>
      <span className={`shrink-0 ${LABEL} ${MUTED}`}>{source} ↗</span>
    </li>
  );
}

/// Closing's download button, as an inert anchor.
function Button({ children, inverted = false }: { children: ReactNode; inverted?: boolean }) {
  const fill = inverted
    ? "bg-white text-[#0B0B0F]"
    : "bg-white text-[#0B0B0F] light:bg-[#0A0A0A] light:text-white light:shadow-[0_1px_2px_#00000040]";
  return (
    <a className={`inline-flex h-10 items-center rounded-[6px] px-4 text-[14px] leading-5 font-medium shadow-[inset_0_-1px_0_#4D4C4C,0_1px_2px_#00000040] ${fill}`}>
      {children}
    </a>
  );
}

/// A wireframe image box: hatched, labelled with what goes there.
function Placeholder({ label, ratio, className = "" }: { label: string; ratio: string; className?: string }) {
  return (
    <div
      className={`flex ${ratio} items-center justify-center rounded-[10px] border border-dashed border-white/15 bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.04)_0_1px,transparent_1px_10px)] light:border-black/15 light:bg-[repeating-linear-gradient(135deg,rgb(0_0_0/0.05)_0_1px,transparent_1px_10px)] ${className}`}
    >
      <span className={`px-4 text-center ${LABEL} ${MUTED}`}>{label}</span>
    </div>
  );
}

/// The homepage's blue band, with its canvas stripes drawn as a static
/// gradient, since an email runs no script. Stays dark in either scheme.
function Closing({ annotate }: { annotate: boolean }) {
  const label = `${LABEL} text-white/70`;
  return (
    // The pin sits outside the band, so it takes the page's scheme, not the band's.
    <div className="relative">
      {annotate && <Pin n={7} />}
    <section
      data-scheme="dark"
      className="rounded-b-[10px] bg-[#1612F8] bg-[repeating-linear-gradient(90deg,#0000001F_0_1px,transparent_1px_6px)]"
    >
      <div className={`pt-14 pb-10 ${GUTTER}`}>
        <h2 className="font-inter text-[24px] leading-[28px] font-light tracking-[-0.03em] text-balance text-white @md:text-[28px] @md:leading-[32px]">
          Your subscription, your favourite harness. Mix and switch freely.
        </h2>

        <div className="mt-8 grid divide-y divide-white/30 border border-white/30 bg-white/10 @md:grid-cols-2 @md:divide-x @md:divide-y-0">
          <div className="flex flex-col gap-5 p-5">
            <div className="flex flex-col gap-1.5">
              <p className={label}>On your Mac</p>
              <p className="text-[17px] leading-[22px] tracking-[-0.02em] text-white">Download the app.</p>
            </div>
            <span className="self-start">
              <Button inverted>Download for macOS</Button>
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-5 p-5">
            <div className="flex flex-col gap-1.5">
              <p className={label}>On a server</p>
              <p className="text-[17px] leading-[22px] tracking-[-0.02em] text-white">Install the CLI.</p>
            </div>
            <code className="block overflow-x-auto rounded-[6px] bg-black/25 px-3 py-2.5 font-mono text-[12px] leading-[18px] whitespace-nowrap text-white">
              {INSTALL_LINE}
            </code>
          </div>
        </div>
      </div>

      <footer className={`flex flex-col gap-3 border-t border-white/30 pt-6 pb-10 ${GUTTER}`}>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          {["Docs", "Changelog", "GitHub", "View online"].map((l) => (
            <a key={l} className={label}>
              {l}
            </a>
          ))}
        </nav>
        <p className="text-[12px] leading-[18px] text-white/70">
          You get this because you signed up at carbonhq.sh. One email per release train, never more than two a
          month. <a className="text-white underline decoration-white/40 underline-offset-2">Unsubscribe</a>
        </p>
        <p className={label}>© 2026 Carbon · Free and open source</p>
      </footer>
    </section>
    </div>
  );
}

/// A numbered marker in the frame's left gutter, outside the email itself.
function Pin({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="absolute top-3 -left-10 flex size-6 items-center justify-center rounded-full border border-[oklch(0.82_0.13_230)] font-mono text-[11px] text-[oklch(0.82_0.13_230)] light:border-[oklch(0.55_0.16_245)] light:text-[oklch(0.55_0.16_245)]"
    >
      {n}
    </span>
  );
}
