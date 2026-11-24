"use client";

import { ArrowUpRight, Globe, Gamepad2 } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { LINKEDIN, SITE, X_PROFILE } from "@/lib/links";
import styles from "./showcase.module.css";

const pages = {
  "website-coding": { path: "/", title: "Coding workspace website" },
  "website-design": { path: "/design-workspace", title: "Design workspace website" },
  game: { path: "/game", title: "Tower Shift game" },
} as const;

const socials = [
  { name: "X", handle: "@carbonhq_", href: X_PROFILE, file: "carbon-x.png", width: 1500, height: 500 },
  { name: "LinkedIn", handle: "Carbon", href: LINKEDIN, file: "carbon-linkedin.png", width: 4200, height: 700 },
];

const posters = [
  { file: "one-place", title: "Your agents. One place to build.", series: "Coding agents" },
  { file: "ticket-to-merge", title: "Ticket to merge", series: "Coding agents" },
  { file: "make-room", title: "Make room for ideas.", series: "Film" },
  { file: "sketch-to-code", title: "From sketch to code.", series: "Film" },
  { file: "stay-in-flow", title: "Stay in flow.", series: "Film" },
  { file: "give-ideas-shape", title: "Give ideas shape.", series: "Studio" },
  { file: "beside-your-agents", title: "Design beside your agents.", series: "Studio" },
  { file: "draw-then-build", title: "Draw it. Then build it.", series: "Studio" },
  { file: "see-it-move", title: "See it move.", series: "Motion" },
  { file: "side-by-side", title: "Run side by side.", series: "Motion" },
  { file: "another-pass", title: "Make another pass.", series: "Motion" },
];

type ShowcaseId = keyof typeof pages | "socials" | "posters";
const host = new URL(SITE).host;
const asset = "/presentation/";

function BrowserScene({ page }: { page: keyof typeof pages }) {
  const { path, title } = pages[page];
  const Icon = page === "game" ? Gamepad2 : Globe;

  return (
    <div className={styles.browser}>
      <div className={styles.addressBar}>
        <span><Icon aria-hidden="true" />{host}{path}</span>
        <a href={path} target="_blank" rel="noreferrer">
          Open in new tab <ArrowUpRight aria-hidden="true" />
        </a>
      </div>
      <iframe title={title} src={path} allow="fullscreen" />
    </div>
  );
}

function SocialScene() {
  return (
    <ul className={styles.socials}>
      {socials.map(({ name, handle, href, file, width, height }) => (
        <li key={name}>
          <a className={styles.social} href={href} target="_blank" rel="noreferrer">
            <span className={styles.socialHeader}>
              <strong>{name}</strong>
              <span>{handle}</span>
              <ArrowUpRight aria-hidden="true" />
            </span>
            <Image src={asset + file} alt="" width={width} height={height} unoptimized />
          </a>
        </li>
      ))}
    </ul>
  );
}

function PosterGallery() {
  const [selected, setSelected] = useState(0);
  const poster = posters[selected];

  return (
    <div className={styles.gallery}>
      <figure className={styles.poster}>
        <div className={styles.artwork}>
          <Image key={poster.file} src={asset + poster.file + ".webp"} alt={poster.title} fill unoptimized />
        </div>
        <figcaption aria-live="polite">
          <span>{poster.series}</span><strong>{poster.title}</strong>
        </figcaption>
      </figure>
      <div className={styles.filmstrip} role="group" aria-label="Choose a poster">
        {posters.map(({ file, title, series }, index) => (
          <button type="button" key={file} aria-label={`${series} — ${title}`} aria-pressed={selected === index}
            onClick={() => setSelected(index)}>
            <Image src={asset + file + "-thumb.webp"} alt="" width={64} height={80} unoptimized />
          </button>
        ))}
      </div>
    </div>
  );
}

export function Showcase({ chapter }: { chapter: ShowcaseId }) {
  return (
    <div className={styles.scene} data-scene={chapter}>
      {chapter === "socials" ? <SocialScene /> : chapter === "posters" ? <PosterGallery /> : <BrowserScene page={chapter} />}
    </div>
  );
}
