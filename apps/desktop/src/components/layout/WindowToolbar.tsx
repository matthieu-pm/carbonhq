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
        // Three adjacent 28px controls, then the header's 8px gap before the tabs.
        fullscreen ? "[--tabs-lead:6.5rem]" : "[--tabs-lead:calc(var(--traffic-lights-w)+5.75rem)]",
        className,
      )}
      {...props}
    />
  );
}
