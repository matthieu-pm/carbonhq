import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { BookOpen, FileDiff, GitPullRequest, Globe, ListChecks, ListTodo, Ticket } from "lucide-react";
import type { PanelTab } from "@/components/RightPanel";

const icons = { changes: FileDiff, browser: Globe, docs: BookOpen, pr: GitPullRequest, more: ListTodo, plan: ListChecks, issue: Ticket };

export function SessionToolIcon({ tab, className = "size-3.5 shrink-0" }: { tab: PanelTab; className?: string }) {
  const Icon = icons[tab];
  return <Icon className={className} />;
}

// Moving the same host between outlets preserves editor drafts, focusable controls and scroll.
export function SessionToolBody({ side, full, children }: {
  side: HTMLElement | null;
  full: boolean;
  children: ReactNode;
}) {
  const main = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const node = document.createElement("div");
    node.className = "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden";
    return node;
  });
  useLayoutEffect(() => {
    (side ?? main.current)?.appendChild(host);
    return () => host.remove();
  }, [host, side]);
  return <>
    <div ref={main} className={full ? "flex min-w-0 min-h-0 flex-1 flex-col" : "hidden"} />
    {createPortal(children, host)}
  </>;
}
