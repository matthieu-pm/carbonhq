import { useEffect, useRef, useState } from "react";
import { FileText, Link2, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { importLinearDocument, listLinearDocuments, type LinearDocumentSummary } from "@/lib/linearPages";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Page } from "@/types/events";

export default function LinearImportDialog({ open, onOpenChange, server, projectPaths, onImported }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server: string;
  projectPaths: string[];
  onImported: (page: Page) => void;
}) {
  const [query, setQuery] = useState("");
  const [documents, setDocuments] = useState<LinearDocumentSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const context = useRef(0);
  const alive = useRef(true);
  const current = useRef({ open, server, projectPaths, onImported, onOpenChange });
  current.current = { open, server, projectPaths, onImported, onOpenChange };

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { context.current++; }, [open, server]);
  useEffect(() => {
    const request = ++generation.current;
    setSelected(null);
    setDocuments([]);
    setCursor(null);
    setError(null);
    if (!open) return;
    setLoading(true);
    const timer = setTimeout(() => {
      void listLinearDocuments(server, query).then((result) => {
        if (!alive.current || generation.current !== request) return;
        setDocuments(result.documents.filter((document) => !document.trashed));
        setCursor(result.nextCursor);
      }, (reason) => {
        if (alive.current && generation.current === request) setError(String(reason));
      }).finally(() => {
        if (alive.current && generation.current === request) setLoading(false);
      });
    }, 250);
    return () => { clearTimeout(timer); generation.current++; };
  }, [open, server, query, retry]);

  const more = async () => {
    if (!cursor || loading || importing) return;
    const request = generation.current;
    setLoading(true);
    setError(null);
    try {
      const result = await listLinearDocuments(server, query, cursor);
      if (!alive.current || generation.current !== request) return;
      setDocuments((previous) => {
        const known = new Set(previous.map((document) => document.id));
        return [...previous, ...result.documents.filter((document) => !document.trashed && !known.has(document.id))];
      });
      setCursor(result.nextCursor);
    } catch (reason) {
      if (alive.current && generation.current === request) setError(String(reason));
    } finally {
      if (alive.current && generation.current === request) setLoading(false);
    }
  };

  const link = async () => {
    if (!selected || importing || loading) return;
    const request = context.current;
    const documentId = selected;
    setImporting(true);
    setError(null);
    try {
      const result = await importLinearDocument(server, documentId, projectPaths);
      if (!alive.current || context.current !== request || !current.current.open || current.current.server !== server) return;
      current.current.onImported(result.page);
      current.current.onOpenChange(false);
    } catch (reason) {
      if (alive.current && context.current === request) setError(String(reason));
    } finally {
      if (alive.current) setImporting(false);
    }
  };

  return <Dialog open={open} onOpenChange={(next) => { if (!importing) onOpenChange(next); }}>
    <DialogContent className="max-w-xl" dismissible={!importing}>
      <DialogHeader>
        <DialogTitle>Link a Linear document</DialogTitle>
        <DialogDescription>Keep a Markdown Page in sync with Linear. Edits in either app update the linked document.</DialogDescription>
      </DialogHeader>
      <label className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
        <Search className="size-4 shrink-0" strokeWidth={1.5} />
        <input className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none" aria-label="Search Linear documents" placeholder="Search documents" value={query} disabled={importing}
          onChange={(event) => { generation.current++; setLoading(true); setQuery(event.target.value); }} />
      </label>
      {error && <div role="alert" className="flex items-start gap-3 rounded-lg border border-border p-3 text-xs text-destructive"><p className="min-w-0 flex-1">{error}</p><button className="shrink-0 underline underline-offset-2" disabled={importing} onClick={() => setRetry((value) => value + 1)}>Retry</button></div>}
      <div className="max-h-80 min-h-36 overflow-auto" aria-busy={loading}>
        {documents.length > 0 && <div className="flex flex-col gap-1" role="radiogroup" aria-label="Linear document">
          {documents.map((document, index) => <button key={document.id} role="radio" aria-checked={selected === document.id} tabIndex={selected ? (selected === document.id ? 0 : -1) : (index === 0 ? 0 : -1)} disabled={importing || loading}
            className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-sidebar-accent/50 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60", selected === document.id && "bg-sidebar-accent")}
            onClick={() => setSelected(document.id)}
            onKeyDown={(event) => {
              const next = event.key === "ArrowDown" || event.key === "ArrowRight" ? Math.min(index + 1, documents.length - 1) : event.key === "ArrowUp" || event.key === "ArrowLeft" ? Math.max(index - 1, 0) : event.key === "Home" ? 0 : event.key === "End" ? documents.length - 1 : null;
              if (next === null) return;
              event.preventDefault();
              setSelected(documents[next].id);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
            }}>
            <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm">{document.title}</span>{document.project && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{document.project.name}</span>}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(document.updatedAt)}</span>
          </button>)}
        </div>}
        {loading && <div role="status" className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading documents…</div>}
        {!loading && !error && documents.length === 0 && <p className="px-3 py-12 text-center text-sm text-muted-foreground">{query.trim() ? "No documents match your search." : "No Linear documents are available."}</p>}
      </div>
      <div className="flex items-center gap-2">
        {cursor && <Button variant="ghost" size="sm" disabled={loading || importing} onClick={() => void more()}>Load more</Button>}
        <div className="ml-auto flex gap-2"><Button variant="ghost" size="sm" disabled={importing} onClick={() => onOpenChange(false)}>Cancel</Button><Button size="sm" disabled={!selected || loading || importing} onClick={() => void link()}>{importing ? <Loader2 className="animate-spin" /> : <Link2 />}{importing ? "Linking…" : "Link document"}</Button></div>
      </div>
      <p className="text-xs text-muted-foreground">Uses the Linear account connected in Carbon’s Settings. Linking an existing Page opens the same Page.</p>
    </DialogContent>
  </Dialog>;
}
