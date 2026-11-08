import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/// Keeps every page's controls clear of the traffic lights on the same frame.
export default function WindowToolbar({
  fullscreen,
  className,
  ...props
}: ComponentProps<"header"> & { fullscreen: boolean }) {
  return (
    <header
      // Tauri stops at buttons itself; deep keeps labels from becoming dead drag strips.
      data-tauri-drag-region="deep"
      className={cn(
        "relative flex h-(--titlebar-h) shrink-0 items-center gap-2 overflow-hidden px-3",
        !fullscreen && "pl-(--traffic-lights-w)",
        // Back, Forward and the sidebar toggle each take 28px, plus their gaps.
        fullscreen ? "[--tabs-lead:7.5rem]" : "[--tabs-lead:calc(var(--traffic-lights-w)+6.75rem)]",
        className,
      )}
      {...props}
    />
  );
}
