import { useEffect, useId, useState, type CSSProperties, type RefObject } from "react";
import { ListTree, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import "./document-outline.css";

type Heading = { element: HTMLElement; text: string; level: number };
type Props = {
  containerRef: RefObject<HTMLDivElement | null>;
  contentKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/// Headings come from the displayed document so navigation never changes its Markdown.
export default function DocumentOutline({ containerRef, contentKey, open, onOpenChange }: Props) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const container = containerRef.current;
    if (!open || !container) return;
    let current: Heading[] = [];
    let refreshFrame = 0;
    let scrollFrame = 0;
    const updateActive = () => {
      const edge = container.getBoundingClientRect().top + 64;
      let next = current[0]?.element ?? null;
      for (const heading of current) {
        if (heading.element.getBoundingClientRect().top > edge) break;
        next = heading.element;
      }
      setActive((previous) => previous === next ? previous : next);
    };
    const refresh = () => {
      const content = container.querySelector(".spaces-rich-content, .spaces-preview-markdown");
      const next = Array.from(content?.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6") ?? [])
        .map((element) => ({ element, text: element.textContent?.trim() ?? "", level: Number(element.tagName[1]) }))
        .filter((heading) => heading.text);
      current = next;
      setHeadings((previous) => previous.length === next.length && previous.every((heading, index) => heading.element === next[index].element && heading.text === next[index].text && heading.level === next[index].level) ? previous : next);
      updateActive();
    };
    const queueRefresh = () => {
      cancelAnimationFrame(refreshFrame);
      refreshFrame = requestAnimationFrame(refresh);
    };
    const queueActive = () => {
      cancelAnimationFrame(scrollFrame);
      scrollFrame = requestAnimationFrame(updateActive);
    };
    refresh();
    const observer = new MutationObserver(queueRefresh);
    observer.observe(container, { childList: true, characterData: true, subtree: true });
    const resize = new ResizeObserver(queueActive);
    resize.observe(container);
    container.addEventListener("scroll", queueActive, { passive: true });
    return () => {
      observer.disconnect();
      resize.disconnect();
      container.removeEventListener("scroll", queueActive);
      cancelAnimationFrame(refreshFrame);
      cancelAnimationFrame(scrollFrame);
    };
  }, [containerRef, contentKey, open]);

  if (!open) return null;
  const firstLevel = Math.min(...headings.map((heading) => heading.level), 6);
  return <aside className="spaces-document-outline" aria-labelledby={titleId} onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onOpenChange(false); }
  }}>
    <header><ListTree aria-hidden="true" /><h2 id={titleId}>Outline</h2><Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-xs" aria-label="Close outline" onClick={() => onOpenChange(false)}><X /></Button></TooltipTrigger><TooltipContent>Close outline</TooltipContent></Tooltip></header>
    {headings.length ? <nav aria-label="Document headings"><ol>{headings.map((heading, index) => <li key={index} style={{ "--outline-depth": Math.min(heading.level - firstLevel, 3) } as CSSProperties}>
      <button type="button" aria-current={active === heading.element ? "location" : undefined} onClick={() => {
        const container = containerRef.current;
        if (!container || !heading.element.isConnected) return;
        const top = container.scrollTop + heading.element.getBoundingClientRect().top - container.getBoundingClientRect().top - 32;
        container.scrollTo({ top: Math.max(0, top), behavior: "instant" });
        setActive(heading.element);
      }}>{heading.text}</button>
    </li>)}</ol></nav> : <p>Add headings to navigate this document.</p>}
  </aside>;
}
