"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/// A drawing laid out at one size, scaled down to its column and never up.
/// Unlike the homepage's `ScaledWindow` it never scrolls: the variant pages
/// swap in a smaller drawing on phones instead.
export function Fit({ width, height, children, className }: { width: number; height: number; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScale(Math.min(1, el.clientWidth / width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div ref={ref} className={`w-full ${className ?? ""}`}>
      <div style={{ width: width * scale, height: height * scale }} className="mx-auto">
        <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div>
      </div>
    </div>
  );
}
