import { Fragment, useRef, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { ChevronDown, ChevronUp, FileDiff, FileText, GitBranch, GripVertical, Globe, Image, Link, Monitor, MoreHorizontal, Plus, Search, SlidersHorizontal } from "lucide-react";

import BotAvatar from "@/components/BotAvatar";
import ContextDetails from "@/components/ContextDetails";
import ImageLightbox, { Thumb, type LightboxImage } from "@/components/chat/ImageLightbox";
import TodoList from "@/components/chat/TodoList";
import OpenInButton from "@/components/OpenInButton";
import PrStateIcon from "@/components/PrStateIcon";
import McpLogo from "@/components/settings/McpLogo";
import { UnorderedList3Outline18 } from "@/components/icons/nucleo/UnorderedList3Outline18";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useContextBreakdown } from "@/hooks/useContextBreakdown";
import { useDragReorder } from "@/hooks/useDragReorder";
import { openPath } from "@/hooks/useDocs";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { openLink } from "@/lib/openLink";
import {
  SUMMARY_ITEMS, SUMMARY_SECTIONS, moveSummarySection, setSummaryItem, summaryItemVisible, summaryOrder,
  type SummaryItems, type SummarySectionId, type SummarySource,
} from "@/lib/pinnedSummary";
import type { Todo } from "@/lib/todos";
import type { SubagentRun } from "@/lib/transcript";
import { fileSrc, qualify, serverOfPath } from "@/lib/transport";
import { cn } from "@/lib/utils";
import type { ChangeSet, Harness, PrUnavailable, PullRequest } from "@/types/events";

/// The same toolbar control pins on a roomy canvas and opens a popover otherwise.
export function PinnedSummaryToggle({ open, onToggle, popover, onOpenChange, boundary }: {
  open: boolean;
  onToggle: () => void;
  popover?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  /// The chat canvas: the button sits at the window's edge, over the right panel when one is open.
  /// `sticky="always"` goes with it, since Radix otherwise keeps the content touching its trigger.
  boundary?: Element | null;
}) {
  const button = (
    <Button id="pinned-summary-toggle" variant="ghost" size="icon-sm"
      aria-label="Toggle pinned summary" aria-pressed={open} aria-controls="pinned-summary"
      onClick={popover ? undefined : onToggle}
      className={cn("shrink-0 text-muted-foreground", open && "bg-accent text-foreground")}>
      <UnorderedList3Outline18 className="size-4.5" aria-hidden />
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
        <Popover.Content align="end" side="bottom" sideOffset={12} collisionPadding={12} collisionBoundary={boundary ?? undefined} sticky="always"
          aria-label="Conversation details" className="summary-popover z-50 flex flex-col outline-none">
          {popover}
        </Popover.Content>
      </Popover.Portal>}
    </Popover.Root>
  );
}

type Props = {
  sessionId: string;
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
  crew?: ReactNode;
  crewVisible?: boolean;
  onCrewVisibleChange?: (visible: boolean) => void;
  /// The agent's current task list, `null` where it keeps none.
  todos?: Todo[] | null;
  busy: boolean;
  liveTaskIds: ReadonlySet<string>;
  sources: readonly SummarySource[];
  context: { used: number; max: number } | null;
  /// A closed card stays mounted for its exit and must not keep asking the child.
  open: boolean;
  /// The rail supplies the surface, so the card's own fill and corners go.
  docked?: boolean;
  onOpen: (tab: "changes" | "pr" | "more") => void;
  onManageSources?: () => void;
  onHide: () => void;
};

const row = "flex min-h-8 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1 text-left text-xs text-foreground/80 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const SOURCE_ROWS = {
  attachment: { icon: FileText, label: "Attachment" },
  image: { icon: Image, label: "Image" },
  link: { icon: Link, label: "Link" },
  mcp: { icon: Globe, label: "MCP" },
  search: { icon: Search, label: "Web search" },
  web: { icon: Globe, label: "Web page" },
};

type Reorder = ReturnType<typeof useDragReorder<SummarySectionId>>;

/// Whatever ends a section's first line gives its place to the grip while the grip shows.
const TRAILING = "group-hover/section:invisible group-has-[[data-grip]:focus-visible]/section:invisible group-data-held/section:invisible";

/// Only sections with content own a divider, so hidden details leave no empty rules.
/// The grip alone drags, since a section is mostly rows that answer their own clicks.
function SummarySection({ label, title, action, index, reorder, children }: {
  label: string;
  title?: string;
  action?: ReactNode;
  index: number;
  reorder: Reorder;
  children: ReactNode;
}) {
  const { drag, shown, start, commit, offset } = reorder;
  const held = drag?.from === index;
  const grip = shown.length > 1;
  return (
    <section aria-label={label} data-held={held || undefined} style={{ transform: offset(index) }}
      onPointerDown={(event) => {
        if ((event.target as Element).closest("[data-grip]")) start(event, index);
      }}
      className={cn("group/section relative border-t border-border/65 px-2 py-2 first:border-t-0",
        // Only the sections making room glide; the held one tracks the pointer exactly.
        drag && !held && "transition-transform duration-150 ease-out",
        held && "z-10 rounded-xl border-transparent bg-background shadow-(--shadow-button)")}>
      {grip && <button type="button" data-grip aria-label={`Move ${label}`}
        onKeyDown={(event) => {
          const delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
          if (!delta) return;
          event.preventDefault();
          if (!drag) commit(index, index + delta);
        }}
        className={cn("absolute top-2 right-4.5 flex w-3 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover/section:opacity-100",
          title ? "h-6" : "h-8", held && "opacity-100")}>
        <GripVertical className="size-3" />
      </button>}
      {title && <div className="mb-1 flex min-h-6 items-center justify-between gap-2 px-2.5">
        <h3 className="text-xs text-muted-foreground">{title}</h3>
        {action && <div className={cn("flex items-center", grip && TRAILING)}>{action}</div>}
      </div>}
      {children}
    </section>
  );
}

/// Details follow the conversation's real data; empty sections take no space.
export default function PinnedSummary({
  sessionId, project, cwd, environment, branch, worktree, harness, changes, changesLoading, changesError,
  prs, prsLoading, prsError, subagents, crew, crewVisible = true, onCrewVisibleChange, todos = null, busy, liveTaskIds, sources, context, open, docked = false,
  onOpen, onManageSources, onHide,
}: Props) {
  const [allSources, setAllSources] = useState(false);
  const [previewImage, setPreviewImage] = useState<LightboxImage | null>(null);
  const [imageOpen, setImageOpen] = useState(false);
  const previewTrigger = useRef<HTMLButtonElement | null>(null);
  const [allPrs, setAllPrs] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [items, setItems] = useLocalStorage<SummaryItems>("ade.pinnedSummaryItems", {});
  const [savedOrder, setSavedOrder] = useLocalStorage<string[]>("ade.pinnedSummaryOrder", []);
  const visible = (id: Parameters<typeof summaryItemVisible>[1]) => summaryItemVisible(items, id);
  const done = subagents.filter((run) => run.done).length;
  const running = subagents.filter((run) => !run.done && (busy || (run.taskId !== null && liveTaskIds.has(run.taskId)))).length;
  const unfinished = subagents.length - done - running;
  const showWorkspace = visible("workspace");
  const showGit = (visible("branch") && branch) || visible("changes");
  const showPrs = visible("prs") && (prs.length > 0 || prsLoading || prsError !== null);
  const showSources = visible("sources") && sources.length > 0;
  // A turn ending moves the window; so does a child starting, which `busy` marks.
  const breakdown = useContextBreakdown(sessionId, open && harness === "claude_code" && visible("context"), `${context?.used}:${busy}`);
  const showContext = visible("context") && (context !== null || breakdown !== null);
  const tasks = visible("tasks") && todos?.length ? todos : null;
  const showCrew = !!crew && crewVisible;
  const present: Record<SummarySectionId, boolean> = {
    workspace: showWorkspace, git: !!showGit, prs: showPrs, crew: showCrew, tasks: !!tasks,
    subagents: visible("subagents") && subagents.length > 0, sources: showSources, context: showContext,
  };
  const shownSections = summaryOrder(savedOrder).filter((id) => present[id]);
  const reorder = useDragReorder(shownSections, (id) => id, (id, _delta, to) => {
    setSavedOrder((prev) => moveSummarySection(summaryOrder(prev), shownSections, id, to));
  });
  const empty = shownSections.length === 0;
  const trailing = reorder.shown.length > 1 ? TRAILING : undefined;
  /// Each section's body, drawn in the reader's order.
  const renderSection: Record<SummarySectionId, (at: { index: number; reorder: Reorder }) => ReactNode> = {
    workspace: (at) => <SummarySection label="Workspace" {...at}>
      <div className="flex min-h-8 min-w-0 items-center gap-2.5 px-2.5 text-xs text-foreground/80">
        <Monitor className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate" title={cwd}>{environment}</span>
        <span className={cn("max-w-32 truncate text-muted-foreground", trailing)} title={worktree ?? "Current checkout"}>{worktree ?? "Current checkout"}</span>
      </div>
      <OpenInButton path={cwd} variant="details" />
    </SummarySection>,
    git: (at) => <SummarySection label="Branch and changes" {...at}>
      {visible("branch") && branch && <div className="flex min-h-8 min-w-0 items-center gap-2.5 px-2.5 text-xs text-foreground/80" aria-label={`Branch: ${branch}`}>
        <GitBranch className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate" title={branch}>{branch}</span>
      </div>}
      {visible("changes") && <button type="button" className={row} onClick={() => onOpen("changes")}>
        <FileDiff className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">Changes</span>
        <span className={cn("flex", !(visible("branch") && branch) && trailing)}>
          {changesError ? <span className="text-muted-foreground">Unavailable</span>
            : changesLoading && !changes ? <span className="text-muted-foreground">Reading…</span>
            : <span className="flex gap-1.5 font-mono tabular-nums"><span className={changes?.added ? "text-accent-add" : "text-muted-foreground"}>+{changes?.added ?? 0}</span><span className={changes?.removed ? "text-destructive" : "text-muted-foreground"}>-{changes?.removed ?? 0}</span></span>}
        </span>
      </button>}
    </SummarySection>,
    prs: (at) => <SummarySection label="Pull requests" title="Pull requests" {...at}>
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
    </SummarySection>,
    crew: (at) => <SummarySection label="Crew" title="Crew" {...at}>{crew}</SummarySection>,
    tasks: (at) => tasks && <SummarySection label="Tasks" title="Tasks" {...at} action={<span className="text-xs tabular-nums text-muted-foreground">
      {tasks.filter((todo) => todo.status === "completed").length}/{tasks.length}
    </span>}>
      <div className="px-2.5 py-1"><TodoList todos={tasks} live={busy} dense /></div>
    </SummarySection>,
    subagents: (at) => <SummarySection label="Subagents" title="Subagents" {...at}>
      <button type="button" className={row} onClick={() => onOpen("more")}>
        <span className="flex shrink-0 -space-x-1">
          {subagents.slice(0, 3).map((run) => <BotAvatar key={run.id} seed={run.id}
            working={!run.done && (busy || (run.taskId !== null && liveTaskIds.has(run.taskId)))} />)}
        </span>
        <span>{[running > 0 && `${running} running`, done > 0 && `${done} done`, unfinished > 0 && `${unfinished} unfinished`].filter(Boolean).join(" · ")}</span>
      </button>
    </SummarySection>,
    sources: (at) => <SummarySection label="Sources" title="Sources" {...at} action={onManageSources && <Tooltip>
      <TooltipTrigger asChild><Button variant="ghost" size="icon-xs" aria-label="Manage MCP servers" onClick={onManageSources} className="-mr-1.5 text-muted-foreground"><Plus className="size-4" /></Button></TooltipTrigger>
      <TooltipContent>Manage MCP servers</TooltipContent>
    </Tooltip>}>
      {(allSources ? sources : sources.slice(0, 3)).map((source) => {
        const { icon: Icon, label } = SOURCE_ROWS[source.kind];
        const thumbnail = source.kind === "image" && source.image.path
          ? fileSrc(qualify(source.image.path, serverOfPath(cwd)))
          : null;
        const content = <>
          {thumbnail ? <Thumb item={{ src: thumbnail, name: source.label }} className="size-4 shrink-0 rounded-sm object-cover" />
            : source.kind === "mcp" && source.server
              ? <McpLogo server={{ name: source.server, transport: "http", command: null, args: [], env: [], url: null, headers: [], enabled: true, inherited: false }} className="text-muted-foreground" />
              : <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="min-w-0 flex-1 truncate" title={"url" in source ? source.url : source.label}>{source.label}</span>
          <span className="shrink-0 text-muted-foreground">{label}</span>
        </>;
        if ("url" in source) return <a key={source.id} href={source.url} className={row} onClick={(event) => {
          event.preventDefault();
          openLink(source.url, event);
        }}>{content}</a>;
        if (source.kind === "attachment") return <button key={source.id} type="button" className={row} onClick={() => {
          openPath(sessionId, source.path);
        }}>{content}</button>;
        if (source.kind === "image") return <button key={source.id} type="button" className={row} onClick={(event) => {
          const src = thumbnail ?? source.image.url;
          if (!src) return;
          previewTrigger.current = event.currentTarget;
          setPreviewImage({ src, name: source.label });
          setImageOpen(true);
        }}>{content}</button>;
        return <div key={source.id} className="flex min-h-8 items-center gap-2.5 px-2.5 py-1 text-xs text-foreground/80">{content}</div>;
      })}
      {sources.length > 3 && <button type="button" className={cn(row, "text-muted-foreground")} onClick={() => setAllSources((value) => !value)} aria-expanded={allSources}>
        {allSources ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}{allSources ? "Show less" : `View all (${sources.length})`}
      </button>}
      {previewImage && <ImageLightbox images={[previewImage]} index={imageOpen ? 0 : null}
        onIndex={() => {}} onClose={() => setImageOpen(false)}
        onCloseAutoFocus={(event) => {
          if (!previewTrigger.current?.isConnected) return;
          event.preventDefault();
          previewTrigger.current.focus();
        }} />}
    </SummarySection>,
    context: (at) => <SummarySection label="Context window" title="Context window" {...at}>
      <ContextDetails breakdown={breakdown} total={context} />
    </SummarySection>,
  };
  const hide = () => {
    onHide();
    requestAnimationFrame(() => document.getElementById("pinned-summary-toggle")?.focus());
  };
  return (
    <section id="pinned-summary" aria-label="Pinned summary"
      className={cn("min-h-0 overflow-y-auto", docked ? "flex-1" : "rounded-2xl bg-background")}
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
            {crew && <DropdownMenuCheckboxItem checked={crewVisible}
              onSelect={(event) => event.preventDefault()} onCheckedChange={onCrewVisibleChange}>
              Crew
            </DropdownMenuCheckboxItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={SUMMARY_ITEMS.every((item) => visible(item.id) === item.defaultVisible) && (!crew || crewVisible) && summaryOrder(savedOrder).every((id, i) => id === SUMMARY_SECTIONS[i])}
              onSelect={() => { setItems({}); setSavedOrder([]); onCrewVisibleChange?.(true); }}>Reset to default</DropdownMenuItem>
            <DropdownMenuItem onSelect={hide}>Hide pinned summary</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div ref={reorder.list}>
        {reorder.shown.map((id, index) => <Fragment key={id}>{renderSection[id]({ index, reorder })}</Fragment>)}
        {empty && <div className="p-2"><button type="button" className={row} onClick={() => setMenuOpen(true)}><SlidersHorizontal className="size-4" />Choose what to show</button></div>}
      </div>
    </section>
  );
}
