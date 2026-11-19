import { useState } from "react";
import { Bookmark, MoreHorizontal, Plus, Search } from "lucide-react";

import ShortcutKeys from "@/components/ShortcutKeys";
import { useSidebarResize } from "@/components/ResizeHandle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { editIssueViews, matchesIssueView, useIssueViews, type SavedIssueView } from "@/lib/issueViews";
import { cn } from "@/lib/utils";
import type { IssueQuery } from "@/types/events";

const row = "w-full justify-start px-1.5 text-ui text-sidebar-foreground/80 transition-none hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/80 dark:hover:bg-sidebar-accent/50";

export default function IssuesSidebar({ floating, query, label, onNewIssue, onSearch, onApply }: {
  floating: boolean;
  query: IssueQuery | null;
  label: string;
  onNewIssue: () => void;
  onSearch: () => void;
  onApply: (view: SavedIssueView) => void;
}) {
  const { style, handle } = useSidebarResize({ reserveChatSpace: !floating });
  const views = useIssueViews();
  const [editing, setEditing] = useState<{ id: string | null; name: string; query: IssueQuery } | null>(null);
  const save = () => {
    if (query) setEditing({ id: null, name: label, query: { ...query } });
  };
  return (
    <aside aria-label="Issues navigation" className="relative flex min-h-0 shrink-0 flex-col" style={style}>
      {!floating && handle}
      <div className="flex flex-col gap-px px-2 pt-3">
        <Button variant="ghost" size="sm" onClick={onNewIssue} className={row}>
          <Plus />New issue
          <ShortcutKeys ids={["session.new"]} className="ml-auto" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onSearch} className={row}>
          <Search />Search
          <ShortcutKeys ids={["search"]} className="ml-auto" />
        </Button>
      </div>
      <div className="mt-6 flex items-center px-3.5 pb-1 text-ui text-muted-foreground">
        <span className="flex-1">Saved views</span>
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label="Save current view" disabled={!query} onClick={save}><Plus /></Button>
        </TooltipTrigger><TooltipContent>Save current view</TooltipContent></Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {!views.length && <p className="px-1.5 py-2 text-ui leading-relaxed text-muted-foreground">Save the current filters to return to them here.</p>}
        {views.map((view) => (
          <div key={view.id} className="group flex items-center gap-px">
            <Button variant="ghost" size="sm" className={cn(row, "min-w-0 flex-1", matchesIssueView(view, query) && "bg-sidebar-accent")}
              onClick={() => onApply(view)}>
              <Bookmark className="shrink-0" /><span className="truncate" title={view.name}>{view.name}</span>
            </Button>
            <DropdownMenu><DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={`Options for ${view.name}`} className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"><MoreHorizontal /></Button>
            </DropdownMenuTrigger><DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => setEditing({ ...view })}>Rename</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => editIssueViews((all) => all.filter((v) => v.id !== view.id))}>Delete view</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>
          </div>
        ))}
      </div>
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent><DialogHeader><DialogTitle>{editing?.id ? "Rename view" : "Save view"}</DialogTitle>
          <DialogDescription>{editing?.id ? "Give this view a name." : "Keep this tracker and its current filters together."}</DialogDescription></DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={(e) => {
            e.preventDefault();
            if (!editing?.name.trim()) return;
            const view = { ...editing, id: editing.id ?? crypto.randomUUID(), name: editing.name.trim() };
            editIssueViews((all) => editing.id ? all.map((v) => v.id === editing.id ? view : v) : [...all, view]);
            setEditing(null);
          }}>
            <Input autoFocus aria-label="View name" maxLength={80} value={editing?.name ?? ""} onChange={(e) => setEditing((v) => v && { ...v, name: e.target.value })} />
            <Button type="submit" className="self-end" disabled={!editing?.name.trim()}>Save</Button>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
