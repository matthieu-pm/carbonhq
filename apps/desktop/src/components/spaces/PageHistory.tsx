import { useEffect, useRef, useState } from "react";
import { ArrowLeft, History, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import PagePreview from "./PagePreview";
import { invoke } from "@/lib/transport";
import { relativeTime } from "@/lib/format";
import { openPage, type LocatedPage, type Page, type PageSummary, type PageAsset } from "@/lib/pages";

/// Restoring creates another revision, leaving the historical document untouched.
export default function PageHistory({ page, dirty, assets, onClose, onRestored }: {
  page: LocatedPage<Page>; dirty: boolean; assets: PageAsset[]; onClose: () => void; onRestored: () => void;
}) {
  const [versions, setVersions] = useState<PageSummary[]>([]);
  const [version, setVersion] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    let stopped = false;
    void invoke<PageSummary[]>("page_history", { id: page.id }, page.server).then((list) => { if (!stopped) setVersions(list); }, (reason) => { if (!stopped) setError(String(reason)); }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; generation.current++; };
  }, [page.id, page.server, page.revision]);
  const inspect = async (revision: number) => {
    const seq = ++generation.current;
    setLoading(true); setError(null);
    try { const result = await invoke<Page>("read_page_version", { id: page.id, version: revision }, page.server); if (seq === generation.current) setVersion(result); }
    catch (reason) { if (seq === generation.current) setError(String(reason)); }
    finally { if (seq === generation.current) setLoading(false); }
  };
  const restore = async () => {
    if (!version || dirty) return;
    setRestoring(true); setError(null);
    try { await invoke("restore_page_version", { id: page.id, revision: page.revision, version: version.revision }, page.server); onRestored(); setVersion(null); }
    catch (reason) { setError(String(reason)); }
    finally { setRestoring(false); }
  };
  return <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-auto border-l border-border p-5" aria-label="Version history"><header className="flex items-center gap-2 text-sm font-medium"><History className="size-4" />Version history<Button className="ml-auto" size="icon-sm" variant="ghost" aria-label="Close history" onClick={onClose}><X /></Button></header>
    {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    {loading ? <Loader2 className="size-4 animate-spin" /> : version ? <><Button size="sm" variant="ghost" className="justify-start" onClick={() => { ++generation.current; setVersion(null); }}><ArrowLeft />All versions</Button><h3 className="text-sm font-medium">{version.title}</h3><p className="text-xs text-muted-foreground">Revision {version.revision} · {relativeTime(version.modified)}</p><div className="text-sm"><PagePreview markdown={version.markdown} server={page.server} assets={assets} onOpenPage={openPage} /></div><Button size="sm" disabled={dirty || restoring || version.revision === page.revision} onClick={() => void restore()}>{restoring ? "Restoring…" : "Restore this version"}</Button>{dirty && <p className="text-xs text-muted-foreground">Save or resolve your draft before restoring a version.</p>}</> : <><p className="text-xs text-muted-foreground">The latest 100 versions. Restoring keeps every saved version.</p>{versions.map((item) => <button key={item.revision} className="flex flex-col gap-1 rounded-md px-2 py-2 text-left hover:bg-muted" onClick={() => void inspect(item.revision)}><span className="text-sm">Revision {item.revision}{item.revision === page.revision ? " · Current" : ""}</span><span className="text-xs text-muted-foreground">{relativeTime(item.modified)} · {item.title}</span></button>)}</>}
  </aside>;
}
