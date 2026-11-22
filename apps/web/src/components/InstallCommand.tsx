"use client";

import { useRef, useState } from "react";
import { INSTALL_LINE } from "@/lib/links";

/// The install line with a Copy that says when it worked. Scrolls rather than
/// wraps, since a command broken over two lines reads as two commands.
export function InstallCommand() {
  const [copied, setCopied] = useState(false);
  const line = useRef<HTMLSpanElement>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(INSTALL_LINE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      if (line.current) window.getSelection()?.selectAllChildren(line.current);
    }
  }

  return (
    <div className="flex h-10 items-center gap-3 rounded-[6px] bg-[#242424] px-3.5">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[12px] leading-4 tracking-[-0.02em] whitespace-nowrap text-[#CFCFCF] [scrollbar-width:none]">
        <span className="text-[#FFE14D] select-none">$ </span>
        <span ref={line}>{INSTALL_LINE}</span>
      </code>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy CLI install command"
        className="shrink-0 font-mono text-[11px] leading-[14px] tracking-[0.06em] text-white/70 uppercase transition-colors hover:text-white"
      >
        <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
