import { useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { ChevronDown, ChevronUp, FileDiff, GitBranch, ListTodo, Monitor, MoreHorizontal, Plus, SlidersHorizontal } from "lucide-react";

import AgentIcon from "@/components/AgentIcon";
import OpenInButton from "@/components/OpenInButton";
import PrStateIcon from "@/components/PrStateIcon";
import McpLogo from "@/components/settings/McpLogo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { SUMMARY_ITEMS, setSummaryItem, summaryItemVisible, type SummaryItems } from "@/lib/pinnedSummary";
import type { SubagentRun } from "@/lib/transcript";
import { cn } from "@/lib/utils";
import type { ChangeSet, Harness, McpServer, PrUnavailable, PullRequest } from "@/types/events";

/// The same toolbar control pins on a roomy canvas and opens a popover otherwise.
export function PinnedSummaryToggle({ open, onToggle, popover, onOpenChange }: {
  open: boolean;
  onToggle: () => void;
  popover?: ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const button = (
    <Button id="pinned-summary-toggle" variant="ghost" size="icon-sm"
      aria-label="Toggle pinned summary" aria-pressed={open} aria-controls="pinned-summary"
      onClick={popover ? undefined : onToggle}
      className={cn("shrink-0 text-muted-foreground", open && "bg-accent text-foreground")}>
      <ListTodo className="size-4.5" />
    </Button>
  );
  return (
    <Popover.Root open={!!popover && open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          {popover ? <Popover.Trigger asChild>{button}</Popover.Trigger> : button}
        </TooltipTrigger>
        <TooltipContent>Toggle pinned summary</TooltipContent>
      </Tooltip>
      {popover && <Popover.Portal>
        <Popover.Content align="end" side="bottom" sideOffset={12} collisionPadding={12}
          aria-label="Conversation details" className="summary-popover z-50 flex flex-col outline-none">
          {popover}
        </Popover.Content>
      </Popover.Portal>}
    </Popover.Root>
  );
}

type Props = {
  project: string;
  cwd: string;
  environment: string;
  branch: string | null;
  worktree: string | null;
  harness: Harness;
  changes: ChangeSet | null;
  changesLoading: boolean;
  changesError: string | null;
  prs: PullRequest[];
  prsLoading: boolean;
  prsError: PrUnavailable | null;
  subagents: SubagentRun[];
  busy: boolean;
  liveTaskIds: ReadonlySet<string>;
  sources: McpServer[] | null;
  context: { used: number; max: number } | null;
  onOpen: (tab: "changes" | "pr" | "more") => void;
  onManageSources?: () => void;
  onHide: () => void;
};

const row = "flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1 text-left text-xs text-foreground/80 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/// Only sections with content own a divider, so hidden details leave no empty rules.
function SummarySection({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title ?? "Workspace and changes"} className="border-t border-border/65 px-2 py-2 first:border-t-0">
      {title && <div className="mb-1 flex min-h-6 items-center justify-between gap-2 px-2.5">
        <h3 className="text-xs text-muted-foreground">{title}</h3>
        {action}
      </div>}
      {children}
    </section>
  );
}

/// Details follow the conversation's real data; empty sections take no space.
export default function PinnedSummary({
  project, cwd, environment, branch, worktree, harness, changes, changesLoading, changesError,
  prs, prsLoading, prsError, subagents, busy, liveTaskIds, sources, context,
  onOpen, onManageSources, onHide,
}: Props) {
  const [allSources, setAllSources] = useState(false);
  const [allPrs, setAllPrs] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [items, setItems] = useLocalStorage<SummaryItems>("ade.pinnedSummaryItems", {});
  const visible = (id: Parameters<typeof summaryItemVisible>[1]) => summaryItemVisible(items, id);
  const done = subagents.filter((run) => run.done).length;
  const running = subagents.filter((run) => !run.done && (busy || (run.taskId !== null && liveTaskIds.has(run.taskId)))).length;
  const unfinished = subagents.length - done - running;
  const showWorkspace = visible("workspace");
  const showGit = (visible("branch") && branch) || visible("changes");
  const showPrs = visible("prs") && (prs.length > 0 || prsLoading || prsError !== null);
  const showSources = visible("sources") && (!!sources?.length || !!onManageSources);
  const empty = !showWorkspace && !showGit && !showPrs && !(visible("subagents") && subagents.length) && !showSources && !(visible("context") && context);
  const hide = () => {
    onHide();
    requestAnimationFrame(() => document.getElementById("pinned-summary-toggle")?.focus());
  };
  return (
    <section id="pinned-summary" aria-label="Pinned summary"
      className="min-h-0 overflow-y-auto rounded-2xl bg-background shadow-(--shadow-card) ring-1 ring-inset ring-border"
      onContextMenu={(event) => {
        if (!event.currentTarget.contains(event.target as Node) || window.getSelection()?.toString()) return;
        event.preventDefault();
        setMenuOpen(true);
      }}>
      <div className="flex min-w-0 items-center justify-between gap-2 px-4 pt-3 pb-1">
        <span className="truncate text-xs text-muted-foreground" title={project}>{project}</span>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" aria-label="Summary options" className="text-muted-foreground">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Show in conversation details</DropdownMenuLabel>
            {SUMMARY_ITEMS.map((item) => <DropdownMenuCheckboxItem key={item.id}
              checked={visible(item.id)} onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) => setItems((prev) => setSummaryItem(prev, item.id, checked))}>
              {item.label}
            </DropdownMenuCheckboxItem>)}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={SUMMARY_ITEMS.every((item) => visible(item.id) === item.defaultVisible)} onSelect={() => setItems({})}>Reset to default</DropdownMenuItem>
            <DropdownMenuItem onSelect={hide}>Hide pinned summary</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div>
        {showWorkspace && <SummarySection>
          <div className="flex min-h-8 min-w-0 items-center gap-2.5 px-2.5 text-xs text-foreground/80">
            <Monitor className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate" title={cwd}>{environment}</span>
            <span className="max-w-32 truncate text-muted-foreground" title={worktree ?? "Current checkout"}>{worktree ?? "Current checkout"}</span>
          </div>
          <OpenInButton path={cwd} variant="details" />
        </SummarySection>}

        {showGit && <SummarySection>
          {visible("branch") && branch && <div className="flex min-h-8 min-w-0 items-center gap-2.5 px-2.5 text-xs text-foreground/80" aria-label={`Branch: ${branch}`}>
            <GitBranch className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate" title={branch}>{branch}</span>
          </div>}
          {visible("changes") && <button type="button" className={row} onClick={() => onOpen("changes")}>
            <FileDiff className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">Changes</span>
            {changesError ? <span className="text-muted-foreground">Unavailable</span>
              : changesLoading && !changes ? <span className="text-muted-foreground">Reading…</span>
              : <span className="flex gap-1.5 font-mono tabular-nums"><span className={changes?.added ? "text-accent-add" : "text-muted-foreground"}>+{changes?.added ?? 0}</span><span className={changes?.removed ? "text-destructive" : "text-muted-foreground"}>-{changes?.removed ?? 0}</span></span>}
          </button>}
        </SummarySection>}

        {showPrs && <SummarySection title="Pull requests">
          {(allPrs ? prs : prs.slice(0, 1)).map((pr) => <button type="button" key={pr.number} className={row} onClick={() => onOpen("pr")}>
            <PrStateIcon pr={pr} className="size-4" />
            <span className="truncate" title={pr.title}>{pr.title}</span>
          </button>)}
          {!prs.length && <button type="button" className={cn(row, "text-muted-foreground")} onClick={() => onOpen("pr")}>
            {prsLoading ? "Looking for pull requests…" : "Pull requests unavailable"}
          </button>}
          {prs.length > 1 && <button type="button" className={cn(row, "text-muted-foreground")} onClick={() => setAllPrs((value) => !value)} aria-expanded={allPrs}>
            {allPrs ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}{allPrs ? "Show less" : `Show ${prs.length - 1} more`}
          </button>}
        </SummarySection>}

        {visible("subagents") && subagents.length > 0 && <SummarySection title="Subagents">
          <button type="button" className={row} onClick={() => onOpen("more")}>
            <AgentIcon harness={harness} className="size-4" />
            <span>{[running > 0 && `${running} running`, done > 0 && `${done} done`, unfinished > 0 && `${unfinished} unfinished`].filter(Boolean).join(" · ")}</span>
          </button>
        </SummarySection>}

        {showSources && <SummarySection title="Sources" action={onManageSources && <Tooltip>
          <TooltipTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Manage sources" onClick={onManageSources} className="-mr-1.5 text-muted-foreground"><Plus className="size-4" /></Button></TooltipTrigger>
          <TooltipContent>Manage sources</TooltipContent>
        </Tooltip>}>
          {(allSources ? sources : sources?.slice(0, 3))?.map((source) => <div key={source.name} className="flex min-h-8 items-center gap-2.5 px-2.5 py-1 text-xs text-muted-foreground">
            <McpLogo server={{ name: source.name, transport: "http", command: null, args: [], env: [], url: null, headers: [], enabled: true, inherited: false }} className="size-4" />
            <span className="min-w-0 flex-1 truncate" title={source.name}>{source.name}</span>
            {source.status !== "connected" && <span className="max-w-24 truncate" title={source.status}>{source.status}</span>}
          </div>)}
          {!sources?.length && onManageSources && <button type="button" className={cn(row, "text-muted-foreground")} onClick={onManageSources}><Plus className="size-4" />Manage sources</button>}
          {!!sources && sources.length > 3 && <button type="button" className={cn(row, "text-muted-foreground")} onClick={() => setAllSources((value) => !value)} aria-expanded={allSources}>
            {allSources ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}{allSources ? "Show less" : `View all (${sources.length})`}
          </button>}
        </SummarySection>}

        {visible("context") && context && <SummarySection title="Context window">
          <div className="flex items-center justify-between px-2.5 py-1 text-xs text-muted-foreground">
            <span>{context.used.toLocaleString()} / {context.max.toLocaleString()} tokens</span>
            <span className="tabular-nums">{Math.round(context.used / Math.max(1, context.max) * 100)}%</span>
          </div>
        </SummarySection>}
        {empty && <div className="p-2"><button type="button" className={row} onClick={() => setMenuOpen(true)}><SlidersHorizontal className="size-4" />Choose what to show</button></div>}
      </div>
    </section>
  );
}
