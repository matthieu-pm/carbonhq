import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { IS_MAC } from "@/lib/platform";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { AlertCircle, ChevronDown, Frame, Pencil, Plus, RefreshCw, Undo2, Redo2 } from "lucide-react";

import PanelLeftIcon from "@/components/icons/PanelLeftIcon";
import PanelRightIcon from "@/components/icons/PanelRightIcon";
import TabButton from "@/components/TabButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Spinner from "@/components/ui/spinner";
import ShortcutKeys from "@/components/ShortcutKeys";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CANVAS_PANEL_TABS as PANEL_TABS, type CanvasPanelTab } from "@/lib/canvasBoard";
import "./canvas.css";
const PANEL_LABELS: Record<CanvasPanelTab, string> = { chat: "Chat", preview: "Preview", properties: "Properties", tokens: "Tokens" };

/// Page widths at which each column stops docking. Layers (224) + panel (400)
/// + a board worth looking at (~480) is the first; layers + board the second.
const PANEL_DOCKS = 1100;
const LAYERS_DOCK = 720;

type CanvasChromeProps = {
  toggleLayersRef?: RefObject<(() => void) | null>;
  /// The page is the one showing. It stays mounted while hidden, like Spaces.
  active: boolean;
  projects: { path: string; name: string }[];
  projectPath: string | null;
  onProjectChange: (path: string) => void;
  files: { id: string; name: string }[];
  fileId: string | null;
  onFileChange: (id: string) => void;
  onCreateFile: () => void;
  onRenameFile: () => void;
  onNewFrame: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onAddToChat?: () => void;
  canAddToChat?: boolean;
  addingToChat?: boolean;
  layers: ReactNode;
  board: ReactNode;
  chat: ReactNode;
  preview: ReactNode;
  properties: ReactNode;
  tokens: ReactNode;
  panelTab: CanvasPanelTab;
  onPanelTabChange: (tab: CanvasPanelTab) => void;
  panelOpen: boolean;
  onPanelOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  /// What is picked, in words, for the panel's header and screen readers.
  selectionLabel: string | null;
};

/// The Canvas page inside AppShell's page slot: a strip of project, file tabs
/// and actions over the layers, board and right pane.
///
/// The board gets every pixel the columns leave. Below `PANEL_DOCKS` the pane
/// floats over the board instead of taking width from it, and below
/// `LAYERS_DOCK` the layers list does the same, so a narrow window keeps a
/// usable board rather than three squeezed columns.
export default function CanvasChrome(props: CanvasChromeProps) {
  const {
    active, projects, projectPath, onProjectChange, files, fileId, onFileChange, onCreateFile, onRenameFile, onNewFrame,
    layers, board, chat, preview, properties, tokens, panelTab, onPanelTabChange, panelOpen, onPanelOpenChange,
    loading, error, onRefresh, selectionLabel,
  } = props;
  const root = useRef<HTMLDivElement>(null);
  const panels = { chat, preview, properties, tokens };
  const width = useWidth(root);
  const panelDocked = width >= PANEL_DOCKS;
  const layersDocked = width >= LAYERS_DOCK;
  const compact = width > 0 && width < LAYERS_DOCK;

  // Open by default where it docks, shut where it would cover the board; the
  // reader's toggle wins until the width crosses the line again.
  // Unknown until the first measurement, so a page opening narrow starts shut.
  const [layersOpen, setLayersOpen] = useState(true);
  useLayoutEffect(() => {
    if (!props.toggleLayersRef) return;
    props.toggleLayersRef.current = () => setLayersOpen((open) => !open);
    return () => { if (props.toggleLayersRef) props.toggleLayersRef.current = null; };
  }, [props.toggleLayersRef]);
  const [dockedBefore, setDockedBefore] = useState<boolean | null>(null);
  if (width > 0 && dockedBefore !== layersDocked) {
    setDockedBefore(layersDocked);
    setLayersOpen(layersDocked);
  }

  const layersToggle = useRef<HTMLButtonElement>(null);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const ids = useId();
  const layersId = `${ids}-layers`;
  const panelId = `${ids}-panel`;
  const bodyId = `${ids}-body`;
  const fileTabId = (id: string) => `${ids}-file-${id}`;

  const file = files.find((f) => f.id === fileId) ?? null;
  const hasFile = file !== null;
  const project = projects.find((p) => p.path === projectPath) ?? null;
  const layersFloat = !layersDocked && layersOpen;
  const panelFloat = !panelDocked && panelOpen;

  // A floating card answers Escape the way a popover does, and hands focus back
  // to the button that opened it. Only for keys pressed inside the card's own
  // DOM: a menu portalled out of it bubbles here through React and must not
  // close the card along with itself.
  const escapeCloses = (close: () => void, toggle: RefObject<HTMLButtonElement | null>) => (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented || !e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    close();
    toggle.current?.focus();
  };

  const layersColumn = (
    <div
      id={layersId}
      onKeyDown={layersFloat ? escapeCloses(() => setLayersOpen(false), layersToggle) : undefined}
      className={cn(
        "flex min-h-0 flex-col text-ui",
        layersFloat
          ? "canvas-float rounded-xl bg-popover shadow-lg ring-1 ring-foreground/10 backdrop-blur-xl"
          : "w-56 shrink-0 border-r border-hairline bg-surface-frame/50",
        !layersOpen && "hidden",
      )}
      data-side="left"
    >
      <h2 className="shrink-0 px-4 pt-3 pb-1 text-xs text-muted-foreground">Layers</h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {hasFile ? layers : <p className="px-2 py-1 text-xs text-muted-foreground">No canvas open.</p>}
      </div>
    </div>
  );

  const pane = (
    <aside
      id={panelId}
      aria-label="Canvas panel"
      onKeyDown={panelFloat ? escapeCloses(() => onPanelOpenChange(false), panelToggle) : undefined}
      className={cn(
        "flex min-h-0 min-w-0 flex-col",
        panelFloat
          ? "canvas-float rounded-xl bg-popover shadow-lg ring-1 ring-foreground/10 backdrop-blur-xl"
          : "w-[25rem] min-w-0 shrink-0 overflow-hidden border-l border-hairline",
        !panelOpen && "hidden",
      )}
      data-side="right"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-2">
        <PanelTabs ids={ids} tab={panelTab} onChange={onPanelTabChange} />
        {selectionLabel && (
          <span className="ml-auto min-w-0 truncate pr-1 text-xs text-muted-foreground" title={selectionLabel}>
            {selectionLabel}
          </span>
        )}
      </div>
      {PANEL_TABS.map((tab) => (
        <div
          key={tab}
          role="tabpanel"
          id={`${ids}-panel-${tab}`}
          aria-labelledby={`${ids}-tab-${tab}`}
          // Keep the chat's scroll while looking at Properties; live preview owns its lifecycle.
          className={cn("min-h-0 min-w-0 flex-1 flex-col", panelTab === tab ? "flex" : "hidden")}
        >
          {panels[tab]}
        </div>
      ))}
    </aside>
  );

  return (
    <div ref={root} className="canvas-page" hidden={!active} inert={!active || undefined}>
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-hairline px-2">
        <IconAction
          ref={layersToggle}
          label={layersOpen ? "Hide layers" : "Show layers"}
          pressed={layersOpen}
          controls={layersId}
          onClick={() => setLayersOpen((open) => !open)}
        >
          <PanelLeftIcon className="size-4.5" />
        </IconAction>

        <ProjectPicker projects={projects} project={project} onChange={onProjectChange} compact={compact} />

        <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-hairline" />

        <FileTabs
          files={files}
          fileId={fileId}
          tabId={fileTabId}
          bodyId={bodyId}
          onChange={onFileChange}
          onRename={onRenameFile}
        />
        <IconAction label="New canvas" onClick={onCreateFile} disabled={!projectPath}>
          <Plus />
        </IconAction>

        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
          {props.onAddToChat && <Tooltip>
            <TooltipTrigger asChild><Button variant="ghost" size="sm" disabled={!props.canAddToChat} onClick={props.onAddToChat}>
              {props.addingToChat ? <Spinner /> : null}{props.addingToChat ? "Adding…" : "Add to chat"}
            </Button></TooltipTrigger>
            <TooltipContent>Add selection to chat <ShortcutKeys ids={["browser.inspect.add"]} /></TooltipContent>
          </Tooltip>}
          {hasFile && <>
            <IconAction label="Undo canvas edit" shortcut="undo" onClick={() => props.onUndo?.()} disabled={!props.canUndo}><Undo2 /></IconAction>
            <IconAction label="Redo canvas edit" shortcut="redo" onClick={() => props.onRedo?.()} disabled={!props.canRedo}><Redo2 /></IconAction>
          </>}
          {hasFile && (
            <IconAction label="Rename canvas" onClick={onRenameFile}>
              <Pencil className="size-3.5" />
            </IconAction>
          )}
          {hasFile && (compact ? (
            <IconAction label="New frame" onClick={onNewFrame}><Frame /></IconAction>
          ) : (
            <Button variant="ghost" size="sm" onClick={onNewFrame} className="text-muted-foreground hover:text-foreground">
              <Frame />New frame
            </Button>
          ))}
          <IconAction label="Refresh" onClick={onRefresh} disabled={loading} busy={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </IconAction>
          <IconAction
            ref={panelToggle}
            label={panelOpen ? "Hide panel" : "Show panel"}
            pressed={panelOpen}
            controls={panelId}
            onClick={() => onPanelOpenChange(!panelOpen)}
          >
            <PanelRightIcon className="size-4.5" />
          </IconAction>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex shrink-0 items-center gap-2 border-b border-hairline bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <AlertCircle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate" title={error}>{error}</span>
          <Button size="xs" variant="ghost" onClick={onRefresh} disabled={loading} className="text-destructive hover:text-destructive">
            Try again
          </Button>
        </div>
      )}

      <div
        id={bodyId}
        role={hasFile ? "tabpanel" : undefined}
        aria-labelledby={hasFile ? fileTabId(file.id) : undefined}
        className="relative flex min-h-0 flex-1"
        // A floating panel covers the board's right edge; the board's own
        // controls read this to stay beside it rather than under it.
        style={{ "--canvas-cover-right": panelFloat ? "calc(min(25rem, 100% - 16px) + 8px)" : "0px" } as CSSProperties}
      >
        {layersColumn}
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {hasFile ? board : (
            <EmptyBoard loading={loading} hasProject={projectPath !== null} hasProjects={projects.length > 0} onCreate={onCreateFile} />
          )}
        </div>
        {pane}
      </div>

      {/* Picks happen on the board, out of a screen reader's sight, so say them. */}
      <p className="sr-only" aria-live="polite">{selectionLabel ? `Selected ${selectionLabel}` : ""}</p>
    </div>
  );
}

/// The page's width, read off the element so the columns answer the sheet's
/// width rather than the window's. A hidden page reports zero and keeps the
/// last answer.
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => {
      const next = node.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/// A ghost icon button with its name in a real tooltip, as everywhere else in
/// the app's chrome.
function IconAction({
  ref, label, shortcut, pressed, controls, disabled, busy, onClick, children,
}: {
  ref?: RefObject<HTMLButtonElement | null>;
  label: string;
  shortcut?: "undo" | "redo";
  pressed?: boolean;
  controls?: string;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={pressed}
          aria-controls={controls}
          aria-busy={busy || undefined}
          // `aria-disabled` rather than `disabled`, so the tooltip still opens
          // and says what the button would do.
          aria-disabled={disabled || undefined}
          onClick={disabled ? undefined : onClick}
          className={cn("shrink-0 text-muted-foreground hover:text-foreground", disabled && "opacity-50 hover:bg-transparent")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}{shortcut && <KbdGroup><Kbd>{IS_MAC ? "⌘" : "Ctrl"}</Kbd>{shortcut === "redo" && <Kbd>Shift</Kbd>}<Kbd>Z</Kbd></KbdGroup>}</TooltipContent>
    </Tooltip>
  );
}

function ProjectPicker({
  projects, project, onChange, compact,
}: {
  projects: { path: string; name: string }[];
  project: { path: string; name: string } | null;
  onChange: (path: string) => void;
  compact: boolean;
}) {
  const name = project?.name ?? "No project";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Project: ${name}`}
          disabled={projects.length === 0}
          className={cn("min-w-0 shrink-0 justify-start font-medium", compact ? "max-w-28" : "max-w-48")}
        >
          <span className="truncate" title={name}>{name}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto max-w-80 min-w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Project</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={project?.path ?? ""} onValueChange={onChange}>
          {projects.map((p) => (
            <DropdownMenuRadioItem key={p.path} value={p.path} title={p.path}>
              <span className="truncate">{p.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/// The project's canvas files as tabs. Arrow keys move and open, as a tab list
/// does; double-clicking the open one renames it.
function FileTabs({
  files, fileId, tabId, bodyId, onChange, onRename,
}: {
  files: { id: string; name: string }[];
  fileId: string | null;
  tabId: (id: string) => string;
  bodyId: string;
  onChange: (id: string) => void;
  onRename: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const focusable = files.some((f) => f.id === fileId) ? fileId : files[0]?.id ?? null;

  // Keeps the open tab in view when the list scrolls, as after creating one.
  useEffect(() => {
    if (!fileId) return;
    list.current?.querySelector<HTMLElement>(`[data-file-id="${CSS.escape(fileId)}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [fileId, files.length]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = files.findIndex((f) => f.id === focusable);
    const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? files.length - 1 : null;
    if (to === null || files.length === 0) return;
    e.preventDefault();
    const next = files[(to + files.length) % files.length];
    onChange(next.id);
    list.current?.querySelector<HTMLElement>(`[data-file-id="${CSS.escape(next.id)}"]`)?.focus();
  };

  if (files.length === 0) return <span className="truncate px-1 text-ui text-muted-foreground">No canvases</span>;
  return (
    <div
      ref={list}
      role="tablist"
      aria-label="Canvas files"
      data-canvas-files
      onKeyDown={onKeyDown}
      className="flex min-w-0 shrink items-center gap-0.5 overflow-x-auto [scrollbar-width:none]"
    >
      {files.map((file) => {
        const selected = file.id === fileId;
        return (
          <TabButton
            key={file.id}
            id={tabId(file.id)}
            role="tab"
            data-file-id={file.id}
            aria-selected={selected}
            aria-controls={selected ? bodyId : undefined}
            tabIndex={file.id === focusable ? 0 : -1}
            active={selected}
            onClick={() => onChange(file.id)}
            onDoubleClick={selected ? onRename : undefined}
            title={file.name.length > 28 ? file.name : undefined}
            className="max-w-48 shrink-0 cursor-pointer truncate whitespace-nowrap"
          >
            {file.name}
          </TabButton>
        );
      })}
    </div>
  );
}

function PanelTabs({ ids, tab, onChange }: { ids: string; tab: CanvasPanelTab; onChange: (tab: CanvasPanelTab) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = PANEL_TABS.indexOf(tab);
    const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? PANEL_TABS.length - 1 : null;
    if (to === null) return;
    e.preventDefault();
    const next = PANEL_TABS[(to + PANEL_TABS.length) % PANEL_TABS.length];
    onChange(next);
    row.current?.querySelector<HTMLElement>(`#${CSS.escape(`${ids}-tab-${next}`)}`)?.focus();
  };
  return (
    <div ref={row} role="tablist" aria-label="Panel" onKeyDown={onKeyDown} className="flex shrink-0 items-center gap-0.5">
      {PANEL_TABS.map((value) => (
        <TabButton
          key={value}
          id={`${ids}-tab-${value}`}
          role="tab"
          aria-selected={tab === value}
          aria-controls={`${ids}-panel-${value}`}
          tabIndex={tab === value ? 0 : -1}
          active={tab === value}
          onClick={() => onChange(value)}
          className="cursor-pointer"
        >
          {PANEL_LABELS[value]}
        </TabButton>
      ))}
    </div>
  );
}

function EmptyBoard({
  loading, hasProject, hasProjects, onCreate,
}: {
  loading: boolean;
  hasProject: boolean;
  hasProjects: boolean;
  onCreate: () => void;
}) {
  if (loading) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-ui text-muted-foreground" role="status">
        <Spinner className="size-4" />Loading canvases…
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      {!hasProjects ? (
        <>
          <p className="text-ui font-medium">No projects yet</p>
          <p className="max-w-72 text-xs text-muted-foreground">A canvas belongs to a project. Attach one to start.</p>
        </>
      ) : !hasProject ? (
        <p className="text-ui text-muted-foreground">Pick a project to see its canvases.</p>
      ) : (
        <>
          <p className="text-ui font-medium">No canvases in this project</p>
          <p className="max-w-72 text-xs text-muted-foreground">A canvas holds frames you can compare side by side and point the agent at.</p>
          <Button size="sm" onClick={onCreate}><Plus />New canvas</Button>
        </>
      )}
    </div>
  );
}
