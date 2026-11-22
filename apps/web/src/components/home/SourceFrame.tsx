"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { LINKEDIN, REPO, X_PROFILE } from "@/lib/links";
import { DesignRuler } from "./DesignRuler";
import styles from "./source-frame.module.css";

const tokenColors: Record<string, string> = {
  pub: styles.keyword, fn: styles.keyword, let: styles.keyword, static: styles.keyword,
  self: styles.keyword, crate: styles.keyword, "'static": styles.keyword,
  S: styles.type, str: styles.type, Serialize: styles.type, Result: styles.type,
  SessionManager: styles.type, LazyLock: styles.type,
  emit: styles.functionName, manager: styles.functionName, to_value: styles.functionName,
  live_event: styles.functionName, new: styles.functionName, default: styles.functionName,
  MANAGER: styles.constant, Ok: styles.constant, "0": styles.constant,
  use: styles.keyword, struct: styles.keyword, dyn: styles.keyword, impl: styles.keyword,
  for: styles.keyword, mut: styles.keyword,
  Arc: styles.type, Sink: styles.type, Fn: styles.type, Value: styles.type,
  Send: styles.type, Sync: styles.type, Self: styles.type, Debug: styles.type,
  Formatter: styles.type, write_str: styles.functionName,
};

type SourceLink = { token: string; href: string; label: string };

function highlight(source: string, links: SourceLink[] = []) {
  const unused = new Map(links.map(link => [link.token, link]));
  return source.split(/('?[A-Za-z_]\w*|\d+)/).map((part, index) => {
    const link = unused.get(part);
    if (link) {
      unused.delete(part);
      return (
        <a key={index} href={link.href} aria-label={link.label}
          {...(link.href.startsWith("/") ? {} : { target: "_blank", rel: "noopener noreferrer" })}
          className={`${styles.sourceLink} ${tokenColors[part] ?? ""}`}>
          {part}
        </a>
      );
    }
    if (!tokenColors[part] && links.length === 0) return part;
    return <span key={index} className={tokenColors[part]} aria-hidden="true">{part}</span>;
  });
}

const SINK_SOURCE = [
  "use std::sync::Arc; pub struct Sink(Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>);",
  "impl Sink { pub fn new(emit: impl Fn(&str, serde_json::Value) + Send + Sync + 'static) -> Self { Self(Arc::new(emit)) }",
  "pub fn emit<S: serde::Serialize>(&self, event: &str, payload: S) -> anyhow::Result<()> { let value = serde_json::to_value(payload)?; crate::orchestration::tasks::live_event(event, &value); (self.0)(event, value); Ok(()) } }",
  `impl std::fmt::Debug for Sink { fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { f.write_str("Sink") } }`,
].join(" ");
const topTokens = ["Sink", "serde_json", "emit", "'static", "event"];
const topLines = topTokens.map(token => highlight(SINK_SOURCE, [
  { token, href: REPO, label: "Carbon on GitHub" },
]));

const MANAGER_SOURCE = "pub fn manager() -> &'static SessionManager { static MANAGER: std::sync::LazyLock<SessionManager> = std::sync::LazyLock::new(SessionManager::default); &MANAGER }";
const MANAGER = highlight(MANAGER_SOURCE);
const xLink = { token: "'static", href: X_PROFILE, label: "Carbon on X" };
const linkedinLink = { token: "SessionManager", href: LINKEDIN, label: "Carbon on LinkedIn" };
const gameLink = { token: "manager", href: "/game", label: "Play Tower Shift" };

export function SourceFrame({ children, rulers = false }: { children: ReactNode; rulers?: boolean }) {
  return (
    <div className={styles.frame}>
      {rulers ? (
        <>
          <DesignRuler axis="horizontal" source={SINK_SOURCE} initialCode={highlight(SINK_SOURCE)} links={[{ href: REPO, label: "Carbon on GitHub" }]} />
          <DesignRuler axis="vertical" source={MANAGER_SOURCE} initialCode={MANAGER} links={[xLink, gameLink, linkedinLink]} />
        </>
      ) : <CodeRails />}
      {children}
    </div>
  );
}

function CodeRails() {
  const topCode = useRef<HTMLElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const sample = useRef<HTMLElement>(null);
  const [topToken, setTopToken] = useState(0);
  const [visibleCopies, setVisibleCopies] = useState(1);

  useEffect(() => {
    const top = topCode.current;
    const row = top?.parentElement;
    const el = gutter.current;
    const code = sample.current;
    if (!top || !row || !el || !code) return;
    const observer = new ResizeObserver(() => {
      const length = code.getBoundingClientRect().height;
      if (length > 0) setVisibleCopies(el.clientHeight / length);
      const text = top.getBoundingClientRect();
      if (text.width > 0) {
        const visibleChars = (row.getBoundingClientRect().right - text.left) * SINK_SOURCE.length / text.width;
        const index = topTokens.findLastIndex(token => SINK_SOURCE.indexOf(token) + token.length <= visibleChars * 0.8);
        setTopToken(Math.max(0, index));
      }
    });
    observer.observe(row);
    observer.observe(top);
    observer.observe(el);
    observer.observe(code);
    return () => observer.disconnect();
  }, []);

  const fullCopies = Math.max(1, Math.floor(visibleCopies));
  const placements = [
    { copy: Math.floor((fullCopies - 1) * 0.4), link: xLink },
    { copy: Math.round((fullCopies - 1) * 0.6), link: gameLink },
    { copy: Math.round((fullCopies - 1) * 0.8), link: linkedinLink },
  ];

  return (
    <>
      <div className={styles.top}>
        <span aria-hidden="true" className={styles.file}>sink.rs</span>
        <code ref={topCode}>{topLines[topToken]}</code>
      </div>
      <div ref={gutter} className={styles.gutter}>
        {Array.from({ length: Math.max(1, Math.ceil(visibleCopies)) }, (_, index) => {
          const links = placements.filter(({ copy }) => copy === index).map(({ link }) => link);
          return (
            <code key={index} ref={index === 0 ? sample : undefined} aria-hidden={links.length === 0 || undefined}>
              {links.length ? highlight(MANAGER_SOURCE, links) : MANAGER}
            </code>
          );
        })}
      </div>
    </>
  );
}
