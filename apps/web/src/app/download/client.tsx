"use client";

import { useEffect, useRef } from "react";

/// Start a confirmed download once, including under React's dev Strict Mode.
export function StartDownload({ url }: { url: string }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    window.location.href = url;
  }, [url]);
  return null;
}
