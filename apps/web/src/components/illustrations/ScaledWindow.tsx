"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

export function ScaledWindow({
  width,
  height,
  minScale = 0,
  startX = 0,
  children,
  className,
}: {
  width: number;
  height: number;
  minScale?: number;
  startX?: number;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = ref.current;
    if (!viewport || !minScale) return;
    let scrollable = false;
    const updateScroll = () => {
      const overflows = viewport.clientWidth < width * minScale;
      if (overflows === scrollable) return;
      scrollable = overflows;
      viewport.toggleAttribute("data-scrollable", overflows);
      if (overflows) viewport.scrollLeft = startX * minScale;
    };
    updateScroll();
    const observer = new ResizeObserver(updateScroll);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
      viewport.removeAttribute("data-scrollable");
    };
  }, [width, minScale, startX]);

  return (
    <div className={`flow-root ${className ?? ""}`}>
      <div ref={ref} className="data-scrollable:-mb-16 data-scrollable:overflow-x-auto data-scrollable:pb-16">
        <div
          className="relative @container"
          style={{
            width: `clamp(${width * minScale}px, 100%, ${width}px)`,
            aspectRatio: `${width} / ${height}`,
          }}
        >
          {/* The ratio of the container width to the drawing width is available before hydration. */}
          <div
            className="absolute origin-top-left"
            style={{ width, height, transform: `scale(tan(atan2(100cqw, ${width}px)))` }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
