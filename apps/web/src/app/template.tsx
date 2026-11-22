"use client";

import { useLayoutEffect, useRef, ViewTransition, type ReactNode } from "react";

export default function PageTemplate({ children }: { children: ReactNode }) {
  const page = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const sections = Array.from(page.current!.querySelectorAll<HTMLElement>("[data-page-part], main > section"));
    if (!sections.length || !CSS.supports("view-transition-class", "page-section")) return;
    const route = CSS.escape(location.pathname);

    const rankVisibleSections = () => {
      const visible = sections
        .map((section, index) => ({ section, index, bounds: section.getBoundingClientRect() }))
        .filter(({ bounds }) => bounds.height && bounds.bottom > 0 && bounds.top < window.innerHeight)
        .sort((a, b) => a.bounds.top - b.bounds.top);
      sections.forEach(section => { section.style.viewTransitionName = "none"; });
      visible.forEach(({ section, index }, order) => {
        // Each route gets its own snapshots so the browser never morphs two differently sized sections.
        section.style.viewTransitionName = `part-${route}-${index}`;
        const position = Math.round(4 * order / Math.max(1, visible.length - 1));
        section.style.viewTransitionClass = `page-section position-${position}`;
      });
    };

    rankVisibleSections();
    const observer = new IntersectionObserver(rankVisibleSections);
    sections.forEach(section => observer.observe(section));
    window.addEventListener("pagereveal", rankVisibleSections);
    return () => {
      observer.disconnect();
      window.removeEventListener("pagereveal", rankVisibleSections);
    };
  }, []);

  return (
    <ViewTransition enter="page-fade" exit="page-fade" default="none">
      <div ref={page} className="page-content">{children}</div>
    </ViewTransition>
  );
}
