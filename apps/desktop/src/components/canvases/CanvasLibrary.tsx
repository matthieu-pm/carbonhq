import { lazy, Suspense, useLayoutEffect, useRef, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  Ellipsis,
  Folder,
  FolderPlus,
  LayoutGrid,
  List,
  Plus,
} from "lucide-react";

import { useSidebarResize } from "@/components/ResizeHandle";
import ShortcutKeys from "@/components/ShortcutKeys";
import { DockedSidebarFrame } from "@/components/layout/AppShell";
import { SidebarSearch, sidebarRow } from "@/components/layout/SidebarSearch";
import { ChevronDownOutline12, DoodleOutline18 } from "@/components/icons/nucleo";
import { ItemTab } from "@/components/layout/ViewTabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import Segmented from "@/components/Segmented";
import { canvasKey, type CanvasAction, type CanvasFile, type useCanvasLibrary } from "@/hooks/useCanvasLibrary";
import { useHotkey, useDigitHotkey } from "@/hooks/useHotkey";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { relativeTime } from "@/lib/format";
import { projectLabel } from "@/lib/servers";
import { cn } from "@/lib/utils";
import type { Project } from "@/types/events";

const CanvasEditor = lazy(() => import("./CanvasEditor").then(module => ({ default: module.CanvasEditor })));

type Library = ReturnType<typeof useCanvasLibrary>;
type Location = { project: string; folder: string };
type Creation = { kind: "create" | "folder"; project: string; name: string };
const basename = (folder: string) => folder.split("/").at(-1) ?? "";
const parent = (folder: string) => folder.split("/").slice(0, -1).join("/");

function CanvasPicker({ label, options, value, onChange, filter = false, onAttach }: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  filter?: boolean;
  onAttach?: () => void;
}) {
  const selected = options.find((option) => option.value === value)?.label;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant={filter ? "ghost" : "secondary"} size="sm"
          aria-label={`${label}: ${selected ?? ""}`}
          className={filter
            ? "min-w-0 max-w-full justify-start gap-1 px-1.5 text-ui font-normal text-muted-foreground"
            : "w-full min-w-0 justify-between text-ui font-normal"}>
          <span className="truncate">{selected}</span>
          <ChevronDownOutline12 className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={label} className="min-w-52">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} textValue={option.label} className="text-ui">
              <span className="truncate">{option.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {onAttach && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAttach} className="text-ui">
              <FolderPlus />Attach project…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function editedAt(time: number) {
  const age = relativeTime(new Date(time).toISOString());
  if (age === "now") return "Edited just now";
  return /^\d+[mhd]$/.test(age) ? `Edited ${age} ago` : `Edited ${age}`;
}

export function CanvasTabs({ library, alignX }: { library: Library; alignX: number }) {
  const keys = [null, ...library.tabs.map(canvasKey)];
  const current = library.active ? canvasKey(library.active) : null;
  useHotkey(
    "tab.close",
    () => {
      if (current) library.close(current);
    },
    { enabled: !!current, page: true },
  );
  const step = (by: number) => library.select(keys[(keys.indexOf(current) + by + keys.length) % keys.length]);
  useHotkey("tab.prev", () => step(-1), { page: true });
  useHotkey("tab.next", () => step(1), { page: true });
  useDigitHotkey(
    "tab.pick",
    (i) => {
      if (i === 8 || i < keys.length) library.select(keys[i === 8 ? keys.length - 1 : i]);
    },
    { page: true },
  );
  return (
    <div
      role="tablist"
      aria-label="Canvas tabs"
      className="-mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1"
      style={{ marginLeft: alignX ? `max(-0.25rem, calc(${alignX}px - 0.25rem - var(--tabs-lead)))` : "-0.25rem" }}
    >
      <ItemTab
        fixed
        icon={<LayoutGrid className="size-3.5" />}
        label="Dashboard"
        active={!current}
        onPick={() => library.select(null)}
      />
      {library.tabs.map((tab) => {
        const key = canvasKey(tab);
        return (
          <ItemTab
            key={key}
            icon={<DoodleOutline18 className="size-3.5" />}
            label={tab.name}
            hint={`${tab.project}/canvases/${tab.folder ? tab.folder + "/" : ""}${tab.name}.canvas.json`}
            active={key === current}
            onPick={() => library.select(key)}
            onClose={() => library.close(key)}
          />
        );
      })}
    </div>
  );
}

export function CanvasLibrary({
  library,
  projects,
  collapsed,
  visible,
  onAttach,
  onSidebarWidth,
}: {
  library: Library;
  projects: Project[];
  collapsed: boolean;
  visible: boolean;
  onAttach: (onPicked?: (path: string) => void) => void;
  onSidebarWidth: (width: number) => void;
}) {
  const { scope } = library;
  const { archived } = scope;
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useLocalStorage<"grid" | "list">("carbon.canvasLibrary.layout", "grid");
  const [creation, setCreation] = useState<Creation | null>(null);
  const [moving, setMoving] = useState<CanvasFile | null>(null);
  const [destination, setDestination] = useState("");
  const [error, setError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const { style, handle } = useSidebarResize();
  const sidebarWidth = Number(style.width);
  useLayoutEffect(() => { onSidebarWidth(sidebarWidth); }, [onSidebarWidth, sidebarWidth]);
  const search = useRef<HTMLInputElement>(null);
  const scopedProjects = projects.filter((p) => !scope.project || scope.project === p.path);
  const needle = query.trim().toLowerCase();
  const items = scopedProjects
    .flatMap((project) =>
      (library.libraries[project.path]?.canvases ?? [])
        .filter((file) => file.archived === archived && (archived || needle || file.folder === scope.folder))
        .filter((file) => `${file.name} ${file.folder} ${project.name}`.toLowerCase().includes(needle))
        .map((file) => ({ ...file, project: project.path, projectLabel: projectLabel(project) })),
    )
    .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name));
  const folders = archived
    ? []
    : scopedProjects.flatMap((project) =>
        (library.libraries[project.path]?.folders ?? [])
          .filter((folder) => (needle ? folder.toLowerCase().includes(needle) : parent(folder) === scope.folder))
          .map((folder) => ({ project: project.path, projectLabel: projectLabel(project), folder })),
      );
  const browse = (where: Location, archive = false) => {
    library.setLocation({ project: where.project, folder: where.folder, archived: archive });
    setQuery("");
    library.select(null);
    setError("");
  };
  const mutate = async (project: string, action: CanvasAction) => {
    setError("");
    try {
      return await library.change(project, action);
    } catch (err) {
      setError(String(err));
      return false;
    }
  };
  const create = (kind: Creation["kind"]) => {
    if (kind === "create" && scope.project) {
      void mutate(scope.project, { kind, folder: scope.folder });
      return;
    }
    if (kind === "folder" && !projects.length) {
      onAttach();
      return;
    }
    setError("");
    setCreation({ kind, project: scope.project || projects[0]?.path || "", name: "" });
  };
  const attachForCreation = () => onAttach((project) =>
    setCreation((draft) => draft && { ...draft, project }),
  );
  const submit = async () => {
    if (!creation?.project) return;
    const { kind, name, project } = creation;
    const folder = project === scope.project ? scope.folder : "";
    const action: CanvasAction = kind === "folder" ? { kind, folder, name: name.trim() } : { kind, folder };
    if (await mutate(project, action)) setCreation(null);
  };
  useHotkey(
    "search",
    () => {
      library.select(null);
      setSearchOpen(true);
      requestAnimationFrame(() => search.current?.focus());
    },
    { enabled: visible, page: true },
  );
  useHotkey("session.new", () => create("create"), { enabled: visible });
  const searchBox = (
    <SidebarSearch label="Search canvases" inputRef={search} open={searchOpen} value={query}
      onOpenChange={(open) => {
        if (open) library.select(null);
        setSearchOpen(open);
      }}
      onChange={(value) => {
        library.select(null);
        setQuery(value);
      }}
    />
  );
  const projectOptions = projects.map((project) => ({ value: project.path, label: projectLabel(project) }));
  const projectFilter = (
    <CanvasPicker filter label="Filter by project" value={scope.project} onAttach={() => onAttach()}
      options={[{ value: "", label: "All projects" }, ...projectOptions]}
      onChange={(project) => browse({ project, folder: "" }, archived)} />
  );
  const collection =
    layout === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,13.5rem),1fr))] gap-3" : "grid gap-1";
  const title = archived ? "Archive" : basename(scope.folder) || "Dashboard";
  return (
    <main aria-label="Design workspace" className="flex min-h-0 min-w-0 flex-1">
      {!collapsed && !library.active && (
        <DockedSidebarFrame>
          <aside
            aria-label="Canvas library navigation"
            style={style}
            className="relative flex min-h-0 shrink-0 flex-col"
          >
            {handle}
            <div className="flex flex-col gap-px px-2 pt-3">
              <Button variant="ghost" size="sm" className={sidebarRow} disabled={library.busy} onClick={() => create("create")}>
                <Plus />New canvas
                <ShortcutKeys ids={["session.new"]} className="ml-auto" />
              </Button>
              {searchBox}
            </div>
            <div className="mt-4 px-2 pb-1">{projectFilter}</div>
            <nav className="flex min-h-0 flex-col gap-px overflow-y-auto px-2">
              {[
                { label: "Dashboard", icon: LayoutGrid, archive: false },
                { label: "Archive", icon: Archive, archive: true },
              ].map(({ label, icon: Icon, archive }) => (
                <Button key={label} variant="ghost" size="sm"
                  aria-current={archived === archive && !library.active ? "page" : undefined}
                  onClick={() => browse({ project: scope.project, folder: "" }, archive)}
                  className={cn(sidebarRow, "aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-foreground")}
                >
                  <Icon />{label}
                </Button>
              ))}
            </nav>
          </aside>
        </DockedSidebarFrame>
      )}
      {library.active ? (
        <Suspense fallback={<p role="status" className="m-4 text-ui">Opening canvas…</p>}>
          <CanvasEditor key={canvasKey(library.active)} file={library.active} projects={projects}
            collapsed={collapsed} sidebarStyle={style} resizeHandle={handle}
            libraryError={creation || moving ? "" : error} />
        </Suspense>
      ) : (
        <section className="content-backdrop library-pane flex min-w-0 flex-1 flex-col overflow-hidden pt-8">
          <div className="shrink-0 px-(--library-header-inset)">
            {collapsed && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="w-48 max-w-full">{searchBox}</div>
                {projectFilter}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => browse({ project: scope.project, folder: "" }, !archived)}
                >
                  {archived ? "Dashboard" : "Archive"}
                </Button>
              </div>
            )}
            <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
              <h1 className="truncate text-xl font-medium">{title}</h1>
              <div className="flex flex-wrap items-center gap-2">
                {!archived && (
                  <>
                    <Button size="sm" disabled={library.busy} onClick={() => create("create")}>
                      <Plus />
                      New canvas
                    </Button>
                    <Button variant="secondary" size="sm" disabled={library.busy} onClick={() => create("folder")}>
                      <FolderPlus />
                      New folder
                    </Button>
                  </>
                )}
                <Segmented
                  label="Library layout"
                  value={layout}
                  onPick={setLayout}
                  options={[
                    { value: "list", label: "List view", content: <List className="size-3.5" /> },
                    { value: "grid", label: "Grid view", content: <LayoutGrid className="size-3.5" /> },
                  ]}
                />
              </div>
            </header>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-(--library-content-inset) pb-8">
            {library.errors.length > 0 && (
              <div role="alert" className="mb-3 text-ui text-destructive">
                {library.errors.join(" · ")}{" "}
                <Button size="xs" variant="ghost" onClick={library.refresh}>
                  Retry
                </Button>
              </div>
            )}
            {error && !creation && !moving && (
              <p role="alert" className="mb-3 text-ui text-destructive">
                {error}
              </p>
            )}
            <div className={cn(collection, folders.length > 0 && "mb-3")}>
              {folders.map((f) => (
                <button
                  key={canvasKey({ ...f, name: "" })}
                  onClick={() => browse(f)}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-hairline bg-surface-frame/30 p-3 text-left hover:bg-sidebar-accent/50"
                >
                  <Folder className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-ui font-medium">{basename(f.folder)}</span>
                    <span className="block truncate text-xs text-muted-foreground">{f.projectLabel}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className={collection}>
              {items.map((file) => (
                <article
                  key={canvasKey(file)}
                  className="group relative min-w-0 overflow-hidden rounded-lg border border-hairline bg-surface-frame/30 hover:border-foreground/20"
                >
                  <button
                    disabled={archived}
                    onClick={() => library.open(file)}
                    className={cn(
                      "flex w-full cursor-pointer text-left disabled:cursor-default",
                      layout === "grid" ? "flex-col" : "items-center gap-3 px-3",
                    )}
                  >
                    {layout === "list" && <DoodleOutline18 className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="block min-w-0 flex-1 py-2.5 pr-9 pl-3">
                      <span className="block truncate text-ui font-medium">{file.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {file.projectLabel}
                        {file.folder && ` / ${file.folder}`} · {editedAt(file.modified)}
                      </span>
                    </span>
                    {layout === "grid" && (
                      <span aria-hidden className="w-full px-2 pb-2">
                        <span className="flex aspect-[1.75] w-full items-center justify-center rounded-md border border-hairline bg-background">
                          <DoodleOutline18 className="size-6 text-muted-foreground/35" />
                        </span>
                      </span>
                    )}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={`Actions for ${file.name}`}
                        variant="ghost"
                        size="icon-xs"
                        disabled={library.busy}
                        className="absolute top-2 right-2 text-muted-foreground"
                      >
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      {!archived && (
                        <DropdownMenuItem
                          className="text-ui"
                          onSelect={() => {
                            setError("");
                            setDestination(file.folder);
                            setMoving(file);
                          }}
                        >
                          <Folder />
                          Move to folder…
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem
                        className="text-ui"
                        onSelect={() =>
                          void mutate(file.project, {
                            kind: archived ? "restore" : "archive",
                            folder: file.folder,
                            name: file.name,
                          })
                        }
                      >
                        {archived ? <ArchiveRestore /> : <Archive />}
                        {archived ? "Restore" : "Archive"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </article>
              ))}
            </div>
            {!items.length && !folders.length && !library.errors.length && (
              <div className="flex min-h-52 flex-col items-center justify-center gap-2 text-center text-ui text-muted-foreground">
                {archived ? <Archive className="size-6" /> : <DoodleOutline18 className="size-6" />}
                {library.loading
                  ? "Loading canvases…"
                  : needle
                    ? "No matching canvases"
                    : archived
                      ? "No archived canvases"
                      : !projects.length
                        ? "Attach a project to create a canvas."
                        : "No canvases yet"}
                {!projects.length && !library.loading && (
                  <Button size="sm" variant="secondary" onClick={() => onAttach()}>
                    Attach project
                  </Button>
                )}
              </div>
            )}
          </div>
        </section>
      )}
      <Dialog
        open={visible && !!(creation || moving)}
        onOpenChange={(open) => {
          if (!open && !library.busy) {
            setCreation(null);
            setMoving(null);
            setError("");
          }
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>
            {moving ? "Move canvas" : creation?.kind === "folder" ? "New folder" : "New canvas"}
          </DialogTitle>
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (moving) {
                void mutate(moving.project, {
                  kind: "move",
                  name: moving.name,
                  folder: moving.folder,
                  destination,
                }).then((ok) => {
                  if (ok) setMoving(null);
                });
              } else void submit();
            }}
          >
            {creation && (
              <>
                {projectOptions.length ? (
                  <CanvasPicker label="Destination project" value={creation.project} options={projectOptions}
                    onChange={(project) => setCreation({ ...creation, project })}
                    onAttach={creation.kind === "create" ? attachForCreation : undefined} />
                ) : (
                  <Button type="button" variant="secondary" size="sm" onClick={attachForCreation}>
                    <FolderPlus />Attach project…
                  </Button>
                )}
                {creation.kind === "folder" && (
                  <Input
                    aria-label="Folder name"
                    placeholder="Folder name"
                    autoFocus
                    value={creation.name}
                    onChange={(e) => setCreation({ ...creation, name: e.target.value })}
                  />
                )}
              </>
            )}
            {moving && (
              <CanvasPicker label="Destination folder" value={destination} onChange={setDestination}
                options={[
                  { value: "", label: "Dashboard" },
                  ...(library.libraries[moving.project]?.folders ?? []).map((folder) => ({ value: folder, label: folder })),
                ]} />
            )}
            {error && (
              <p role="alert" className="text-ui text-destructive">
                {error}
              </p>
            )}
            <Button
              type="submit"
              className="justify-self-end"
              disabled={library.busy || (!!creation && !creation.project) || (creation?.kind === "folder" && !creation.name.trim())}
            >
              {moving ? "Move" : creation?.kind === "folder" ? "Create folder" : "Create canvas"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
