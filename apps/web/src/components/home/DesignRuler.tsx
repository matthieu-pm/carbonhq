"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./source-frame.module.css";

const step = 100;
const glyphs = "0123456789abcdef{}[]()<>+=*";

function scramble(source: string, chance = 0.4) {
  return source.replace(/\S/g, char => Math.random() < chance
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
  return (
    <div className={axis === "horizontal" ? styles.top : styles.gutter} data-ruler={axis} data-source-rail={axis}>
      <RulerContents axis={axis} source={source} initialCode={initialCode} links={links} />
    </div>
  );
}

export function RulerContents({ axis, source, initialCode, links = [], onReturn }: Omit<RulerProps, "links"> & {
  links?: RulerProps["links"];
  onReturn?: () => void;
}) {
  const horizontal = axis === "horizontal";
  const scale = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState(1);
  const [code, setCode] = useState<ReactNode>(initialCode);

  useLayoutEffect(() => {
    const el = scale.current!;
    const observer = new ResizeObserver(() => {
      setMarks(Math.ceil((horizontal ? el.clientWidth : el.clientHeight) / step));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [horizontal]);

  useLayoutEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) {
      onReturn?.();
      return;
    }
    const start = performance.now();
    const timer = window.setInterval(() => {
      if (!onReturn) {
        setCode(scramble(source));
        return;
      }
      const remaining = Math.min(1, Math.max(0, (2500 - (performance.now() - start)) / 1400));
      setCode(remaining < 0.12 ? initialCode : scramble(source, 0.4 * remaining));
    }, 120);
    const end = window.setTimeout(() => {
      clearInterval(timer);
      if (onReturn) onReturn();
      else setCode(null);
    }, onReturn ? 2500 : 1400);
    const onMotionChange = () => { if (motion.matches) onReturn?.(); };
    motion.addEventListener("change", onMotionChange);
    return () => {
      clearInterval(timer);
      clearTimeout(end);
      motion.removeEventListener("change", onMotionChange);
    };
  }, [source, initialCode, onReturn]);

  const linkMarks = links.map((_, i) => Math.floor((marks - 1) * (0.4 + i * 0.2)));
  return (
    <>
      {code && (
        <div aria-hidden="true" className={styles.scramble}>
          {horizontal && <span className={styles.file}>sink.rs </span>}
          {Array.from({ length: horizontal ? 1 : Math.ceil(marks / 6) }, (_, i) => <code key={i}>{code}</code>)}
        </div>
      )}
      <div ref={scale} className={styles.scale}>
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
    </>
  );
}
