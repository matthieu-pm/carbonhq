import { useEffect, useRef, useState } from "react";
import { Presentation } from "lucide-react";
import type { PageTarget } from "@/lib/pages";
import { cn } from "@/lib/utils";

/// A deck's cover slide, drawn once it scrolls into view. The renderer loads
/// on first use, so a library of Pages alone never pays for it. Until then, and
/// when the deck cannot be drawn, the slot keeps its 16:9 shape with the deck
/// glyph, so rows and cards never jump.
export default function DeckCover({ page, className }: { page: PageTarget & { revision: number }; className?: string }) {
  const slot = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string | null>(null);
  const key = `${page.server}:${page.id}:${page.revision}`;

  useEffect(() => {
    const element = slot.current;
    if (!element) return;
    let stopped = false;
    setSvg(null);
    const draw = () => import("@/lib/deckPreview")
      .then(({ deckCover }) => deckCover(page))
      .then((markup) => { if (!stopped) setSvg(markup); }, () => { if (!stopped) setSvg(null); });
    const bounds = element.getBoundingClientRect();
    if (bounds.width && bounds.height && bounds.bottom >= 0 && bounds.top < window.innerHeight) {
      void draw();
      return () => { stopped = true; };
    }
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      seen.disconnect();
      void draw();
    }, { rootMargin: "200px" });
    seen.observe(element);
    return () => { stopped = true; seen.disconnect(); };
  }, [key]);

  return <div ref={slot} className={cn("deck-cover", className)} data-ready={svg !== null} aria-hidden="true">
    {svg ? <img className="deck-cover-svg" src={svg} alt="" /> : <Presentation />}
  </div>;
}
