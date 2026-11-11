import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChartNoAxesColumn, CircleDot, Settings } from "lucide-react";

import { SIDEBAR_WIDTH } from "./Sidebar";

/// Keeps the website preview on the desktop's rail, inset sidebar and sheet geometry.
export default function Window({
  sidebar,
  tabs,
  headerEnd,
  main,
  crew,
  panel,
  sidebarWidth = SIDEBAR_WIDTH,
  interactive = false,
  sidebarOpen = true,
  onToggleSidebar,
  onHome,
  onBack,
  onForward,
  className,
}: {
  sidebar: ReactNode;
  /// The tab strip, lined up with the sheet's left edge.
  tabs?: ReactNode;
  /// The strip's far end: the branch, then the PR tab or the panel toggle.
  headerEnd?: ReactNode;
  main: ReactNode;
  /// The crew runs the full height beside the transcript *and* the composer,
  /// inside the chat's sheet. No border between the two: the crew's own
  /// ramped edge is the seam.
  crew?: ReactNode;
  panel?: ReactNode;
  sidebarWidth?: number;
  interactive?: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onHome?: () => void;
  onBack?: () => void;
  onForward?: () => void;
  className?: string;
}) {
  return (
    <div
      aria-hidden={!interactive}
      data-app-window
      className={cx(
        "app-frame relative flex flex-col overflow-hidden rounded-xl border border-border text-foreground shadow-window select-none",
        className,
      )}
    >
      <header className="flex h-(--titlebar-h) shrink-0 items-center pr-3">
        <div className="flex shrink-0 items-center" style={{ width: sidebarOpen ? sidebarWidth + 52 : 172 }}>
          <TrafficLights className="w-[84px] shrink-0 pl-[19px]" />
          <ChromeControl label="Go back" onClick={onBack} disabled={!onBack}>
            <ArrowLeft className="size-4" />
          </ChromeControl>
          <ChromeControl label="Go forward" onClick={onForward} disabled={!onForward}>
            <ArrowRight className="size-4" />
          </ChromeControl>
          <ChromeControl label="Toggle sidebar" onClick={onToggleSidebar} pressed={sidebarOpen}>
            <PanelLeftIcon className="size-4.5" />
          </ChromeControl>
          {sidebarOpen && (
            <span className="ml-auto mr-2 flex items-center gap-1 text-ui text-muted-foreground">
              All Profiles
            </span>
          )}
        </div>
        <span aria-hidden className="h-4 w-px shrink-0 bg-hairline" />
        <div className="flex min-w-0 flex-1 items-center gap-0.5 self-stretch overflow-hidden pl-2">
          {tabs}
        </div>
        {headerEnd && <div className="flex shrink-0 items-center gap-3 pl-3">{headerEnd}</div>}
      </header>

      <div className="flex min-h-0 flex-1 pr-2 pb-2">
        <nav aria-label="App preview navigation" className="flex w-[52px] shrink-0 flex-col items-center gap-1 pt-1">
          <ChromeControl label="New task" onClick={onHome} className="size-9 bg-sidebar-accent text-foreground">
            <svg viewBox="0 0 18 18" className="size-4.5" aria-hidden fill="currentColor">
              <path d="M10.059 1.363a1.75 1.75 0 0 0-2.118 0l-5.25 3.99A1.75 1.75 0 0 0 2 6.746v7.504A2.75 2.75 0 0 0 4.75 17h2.5v-3.5a1.75 1.75 0 0 1 3.5 0V17h2.5A2.75 2.75 0 0 0 16 14.25V6.746c0-.546-.255-1.062-.691-1.393Z" />
            </svg>
          </ChromeControl>
          <span role="img" aria-label="Spaces" className="group/spaces relative grid size-9 place-items-center text-muted-foreground">
            <svg viewBox="0 0 18 18" className="size-4.5" aria-hidden>
              <path d="M5.25,14h-1c-1.517,0-2.75-1.233-2.75-2.75V3.25C1.5,1.733,2.733,.5,4.25,.5h5c1.517,0,2.75,1.233,2.75,2.75v1.052c0,.414-.336,.75-.75,.75s-.75-.336-.75-.75v-1.052c0-.689-.561-1.25-1.25-1.25H4.25c-.689,0-1.25,.561-1.25,1.25V11.25c0,.689,.561,1.25,1.25,1.25h1c.414,0,.75,.336,.75,.75s-.336,.75-.75,.75Z" fill="currentColor"></path><path d="M15.487,6.927l-2.914-2.914c-.331-.331-.77-.513-1.237-.513H7.25c-1.517,0-2.75,1.233-2.75,2.75V14.25c0,1.517,1.233,2.75,2.75,2.75h6c1.517,0,2.75-1.233,2.75-2.75v-6.086c0-.467-.182-.907-.513-1.237Zm-1.053,1.068l-.002,.005h-2.432c-.275,0-.5-.225-.5-.5v-2.432l.005-.002,2.929,2.929Z" fill="currentColor"></path>
            </svg>
            <span role="tooltip" className="pointer-events-none absolute top-full left-0 z-50 mt-1 hidden whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-ui text-foreground shadow-lg group-hover/spaces:block">Spaces</span>
          </span>
          <span aria-hidden className="grid size-9 place-items-center text-muted-foreground"><CircleDot className="size-4.5" /></span>
          <div className="flex-1" />
          <span aria-hidden className="grid size-9 place-items-center text-muted-foreground"><ChartNoAxesColumn className="size-4.5" /></span>
          <span aria-hidden className="grid size-9 place-items-center text-muted-foreground"><Settings className="size-4.5" /></span>
        </nav>
        <div className="flex min-w-0 flex-1 gap-1.5">
          <Sheet className="flex-1">
            {sidebarOpen && <div className="flex shrink-0 border-r border-hairline bg-surface-frame/50">{sidebar}</div>}
            <div className="flex min-w-0 flex-1 flex-col">{main}</div>
            {crew}
          </Sheet>
          {panel && <Sheet className="shrink-0">{panel}</Sheet>}
        </div>
      </div>
    </div>
  );
}

/// Gives working preview controls a keyboard label and a real tooltip.
function ChromeControl({ label, children, onClick, disabled, pressed, className }: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <span className="group/control relative flex shrink-0">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className={cx("grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30 disabled:hover:bg-transparent", className)}
      >
        {children}
      </button>
      <span role="tooltip" className="pointer-events-none absolute top-full left-0 z-50 mt-1 hidden whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-ui text-foreground shadow-lg group-hover/control:block group-focus-within/control:block">{label}</span>
    </span>
  );
}

/// A raised card on the frame: an 8px corner, a hairline ring, its contents
/// clipped to that radius.
function Sheet({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "app-sheet relative flex min-h-0 min-w-0 overflow-hidden rounded-[8px] shadow-[0_0_0_1px_var(--color-hairline)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/// The three macOS window controls, which float over the app's own header under
/// `titleBarStyle: Overlay`.
export function TrafficLights({ className }: { className?: string }) {
  return (
    <div className={cx("flex items-center gap-2", className)}>
      {["#ff5f57", "#febc2e", "#28c840"].map((fill) => (
        <span key={fill} className="size-3 rounded-full" style={{ backgroundColor: fill }} />
      ))}
    </div>
  );
}

/// A rounded rectangle with its left column filled — the sidebar toggle, drawn
/// after VS Code's. The fill is a plain rect clipped to the rounded outline, so
/// its corners follow the border's arc instead of squaring off.
export function PanelLeftIcon({
  className,
  mirrored = false,
}: {
  className?: string;
  /// The right panel's toggle is the same glyph flipped.
  mirrored?: boolean;
}) {
  const id = mirrored ? "carbon-panel-right" : "carbon-panel-left";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      aria-hidden
      className={cx(className, mirrored && "-scale-x-100")}
    >
      <clipPath id={id}>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
      </clipPath>
      <rect
        x="3"
        y="5"
        width="6.5"
        height="14"
        fill="currentColor"
        stroke="none"
        clipPath={`url(#${id})`}
      />
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
    </svg>
  );
}

/// Class joiner. The app's `cn` folds conflicting Tailwind classes; nothing
/// here overrides a copied class, so plain concatenation is the whole job.
export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
