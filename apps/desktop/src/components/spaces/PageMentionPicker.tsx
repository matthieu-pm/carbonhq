import { useDeferredValue, useLayoutEffect, useRef, useState } from "react";
import { FileText, Loader2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePages } from "@/hooks/usePages";
import { readPage, type LocatedPage, type Page } from "@/lib/pages";
import { serverName } from "@/lib/servers";

/// References name a saved revision, so a later edit cannot change what a prompt cited.
export default function PageMentionPicker({ open, visibleProjects, onOpenChange, onSelect, contextKey }: {
  contextKey?: string; open: boolean; visibleProjects: string[] | null; onOpenChange: (open: boolean) => void; onSelect: (page: LocatedPage<Page>) => void;
}) {
  const generation = useRef(0);
  const latest = useRef({ open, visibleProjects, onSelect, onOpenChange });
  latest.current = { open, visibleProjects, onSelect, onOpenChange };
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const { pages, loading, error } = usePages(open, deferred);
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  useLayoutEffect(() => {
    setPicking(null);
    setPickError(null);
    return () => { generation.current++; };
  }, [open, contextKey]);
  const visible = pages.filter((page) => !page.trashed && (visibleProjects === null || page.projectPaths.length === 0 || page.projectPaths.some((p) => visibleProjects.includes(p))));
  const select = async (target: typeof pages[number]) => {
    const seq = ++generation.current;
    setPicking(target.id); setPickError(null);
    try {
      const document = await readPage(target);
      const current = latest.current;
      if (seq !== generation.current || !current.open) return;
      if (current.visibleProjects !== null && document.projectPaths.length > 0 && !document.projectPaths.some((path) => current.visibleProjects?.includes(path))) throw new Error("This Page is outside the current Profile.");
      current.onSelect(document); current.onOpenChange(false);
    }
    catch (reason) { if (seq === generation.current && latest.current.open) setPickError(String(reason)); }
    finally { if (seq === generation.current) setPicking(null); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Reference a Page</DialogTitle><DialogDescription>Add a saved Page revision to your prompt.</DialogDescription></DialogHeader><label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2"><Search className="size-4 text-muted-foreground" /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a Page" placeholder="Search Pages…" className="min-w-0 flex-1 text-sm outline-none" /></label>{(error || pickError) && <p role="alert" className="text-xs text-destructive">{pickError || error}</p>}<div className="max-h-80 overflow-auto">{loading ? <Loader2 className="m-4 size-4 animate-spin" /> : visible.length ? visible.map((page) => <button key={`${page.server}:${page.id}`} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted disabled:opacity-50" disabled={picking !== null} onClick={() => void select(page)}><FileText className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-sm">{page.title}</span><span className="text-xs text-muted-foreground">{serverName(page.server)}</span>{picking === page.id && <Loader2 className="size-3 animate-spin" />}</button>) : <p className="py-8 text-center text-sm text-muted-foreground">No Pages found.</p>}</div></DialogContent></Dialog>;
}
