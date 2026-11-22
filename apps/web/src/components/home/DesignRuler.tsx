"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./source-frame.module.css";

const step = 100;
const glyphs = "0123456789abcdef{}[]()<>+=*";

function scramble(source: string) {
  return source.replace(/\S/g, char => Math.random() < 0.4
    ? glyphs[Math.floor(Math.random() * glyphs.length)]
    : char);
}

type RulerProps = {
  axis: "horizontal" | "vertical";
  source: string;
  initialCode: ReactNode;
  links: { href: string; label: string }[];
};

export function DesignRuler({ axis, source, initialCode, links }: RulerProps) {
  const horizontal = axis === "horizontal";
  const rail = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState(1);
  const [code, setCode] = useState<ReactNode>(initialCode);

  useEffect(() => {
    const el = rail.current!;
    const observer = new ResizeObserver(() => {
      setMarks(Math.ceil((horizontal ? el.clientWidth : el.clientHeight) / step));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [horizontal]);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setCode(scramble(source)), 120);
    const end = window.setTimeout(() => {
      clearInterval(timer);
      setCode(null);
    }, 1400);
    return () => { clearInterval(timer); clearTimeout(end); };
  }, [source]);

  const linkMarks = links.map((_, i) => Math.floor((marks - 1) * (0.4 + i * 0.2)));
  return (
    <div ref={rail} className={horizontal ? styles.top : styles.gutter} data-ruler={axis}>
      {code && (
        <div aria-hidden="true" className={styles.scramble}>
          {horizontal && <span className={styles.file}>sink.rs </span>}
          {Array.from({ length: horizontal ? 1 : Math.ceil(marks / 6) }, (_, i) => <code key={i}>{code}</code>)}
        </div>
      )}
      <div className={styles.scale}>
        {Array.from({ length: marks }, (_, i) => {
          const link = links[linkMarks.indexOf(i)];
          const label = i * step;
          return (
            <span key={i} className={styles.mark}>
              {link ? <a className={styles.sourceLink} href={link.href} aria-label={link.label}
                {...(link.href.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>{label}</a>
                : <span aria-hidden="true">{label}</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
