import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import LinearIcon from "@/components/LinearIcon";
import { Button } from "@/components/ui/button";
import { importLinearDocument, listLinearDocuments, type LinearDocumentSummary } from "@/lib/linearPages";
import { locatePage, type LocatedPage, type Page } from "@/lib/pages";
import type { ServerId } from "@/lib/transport";
import { relativeTime } from "@/lib/format";

/// The workspace's Linear documents, read live from Linear. Opening one links
/// it as a synced Page first, which is idempotent — an already linked document
/// opens the Page it already has.
export default function LinearDocuments({ active, server, query, onOpened, onError }: {
  active: boolean;
  server: ServerId;
  query: string;
  onOpened: (page: LocatedPage<Page>) => void;
  onError: (message: string) => void;
}) {
  const [documents, setDocuments] = useState<LinearDocumentSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    if (!active) return;
    const request = ++generation.current;
    setLoading(true);
    setFailure(null);
    const timer = setTimeout(() => {
      listLinearDocuments(server, query).then((result) => {
        if (generation.current !== request) return;
        setDocuments(result.documents.filter((document) => !document.trashed));
        setCursor(result.nextCursor);
      }, (reason) => {
        if (generation.current === request) { setDocuments([]); setCursor(null); setFailure(String(reason)); }
      }).finally(() => { if (generation.current === request) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); generation.current++; };
  }, [active, server, query, retry]);

  const more = async () => {
    if (!cursor || loading) return;
    const request = generation.current;
    setLoading(true);
    try {
      const result = await listLinearDocuments(server, query, cursor);
      if (generation.current !== request) return;
      setDocuments((previous) => {
        const known = new Set(previous.map((document) => document.id));
        return [...previous, ...result.documents.filter((document) => !document.trashed && !known.has(document.id))];
      });
      setCursor(result.nextCursor);
    } catch (reason) {
      if (generation.current === request) onError(String(reason));
    } finally {
      if (generation.current === request) setLoading(false);
    }
  };

  const open = async (document: LinearDocumentSummary) => {
    if (opening) return;
    setOpening(document.id);
    try {
      const result = await importLinearDocument(server, document.id, []);
      onOpened(locatePage(result.page, server));
    } catch (reason) {
      onError(String(reason));
    } finally {
      setOpening(null);
    }
  };

  if (failure) {
    return <div className="spaces-empty"><LinearIcon className="size-8 text-muted-foreground/60" /><h3>Linear documents couldn’t load</h3><p>{failure}</p><Button size="sm" variant="outline" onClick={() => setRetry((value) => value + 1)}>Try again</Button></div>;
  }
  if (documents.length === 0) {
    return loading
      ? <div className="spaces-empty"><Loader2 className="size-5 animate-spin" /><p>Loading Linear documents…</p></div>
      : <div className="spaces-empty"><LinearIcon className="size-8 text-muted-foreground/60" /><h3>{query.trim() ? "No documents found" : "No Linear documents"}</h3><p>{query.trim() ? "Try another title." : "Documents from your Linear workspace appear here."}</p></div>;
  }
  return <div className="spaces-table" role="grid" aria-label="Linear documents" aria-busy={loading}>
    <div className="spaces-row spaces-row-head" role="row">
      <span className="spaces-row-check" />
      <span className="spaces-row-body"><span role="columnheader">Name</span><span role="columnheader">Source</span><span role="columnheader">Last activity</span></span>
    </div>
    {documents.map((document) => <div key={document.id} className="spaces-row" role="row">
      <span className="spaces-row-check" />
      <span className="spaces-row-body" onClick={() => void open(document)}>
        <span role="gridcell" className="flex min-w-0 items-center gap-3">
          <span className="spaces-page-icon">{opening === document.id ? <Loader2 className="animate-spin" /> : <LinearIcon />}</span>
          <button className="truncate text-left outline-none focus-visible:underline" disabled={!!opening} onClick={(event) => { event.stopPropagation(); void open(document); }}>{document.title}</button>
        </span>
        <span role="gridcell" className="truncate text-muted-foreground">{document.project?.name ?? "—"}</span>
        <span role="gridcell" className="text-muted-foreground">{relativeTime(document.updatedAt)}</span>
      </span>
    </div>)}
    {cursor && <div className="flex justify-center pt-4"><Button size="sm" variant="ghost" disabled={loading} onClick={() => void more()}>{loading && <Loader2 className="animate-spin" />}Load more</Button></div>}
  </div>;
}
