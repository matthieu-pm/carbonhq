import { useEffect, useLayoutEffect, useState } from "react";

import { readLocalStorage, useLocalStorage } from "@/hooks/useLocalStorage";
import { summaryPresentation } from "@/lib/pinnedSummary";

/// Pin choices survive per conversation; popovers close on navigation and layout changes.
export function usePinnedSummary(sessionId: string | null, eligible: boolean, canPin: boolean) {
  const [defaultOpen] = useState(() => readLocalStorage("ade.pinnedSummary", true));
  const [choices, setChoices] = useLocalStorage<Record<string, boolean>>("ade.pinnedSummarySessions", {});
  const [popoverSession, setPopoverSession] = useState<string | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => setSize((prev) => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      return prev.width === width && prev.height === height ? prev : { width, height };
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  const mode = summaryPresentation(size.width, size.height, canPin);
  useEffect(() => setPopoverSession(null), [sessionId, eligible, mode]);
  const open = eligible && !!sessionId && (mode === "pinned"
    ? (choices[sessionId] ?? defaultOpen)
    : popoverSession === sessionId);
  const setOpen = (next: boolean) => {
    if (!sessionId) return;
    if (mode === "pinned") setChoices((prev) => ({ ...prev, [sessionId]: next }));
    else setPopoverSession(next ? sessionId : null);
  };
  return { ref: setElement, mode, open, setOpen, toggle: () => setOpen(!open), closePopover: () => setPopoverSession(null) };
}
