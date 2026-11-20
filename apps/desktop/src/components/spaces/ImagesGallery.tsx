import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Loader2, MessageSquare, Upload } from "lucide-react";
import ImageLightbox, { Thumb } from "@/components/chat/ImageLightbox";
import { Button } from "@/components/ui/button";
import { useHotkey } from "@/hooks/useHotkey";
import { uploadSpaceAsset } from "@/hooks/usePageAssets";
import type { PageTarget } from "@/lib/pages";
import { useServers } from "@/lib/servers";
import { fileSrc, invoke, listen, LOCAL, noteSession, qualify, type ServerId } from "@/lib/transport";
import type { AgentEvent, ImageListing, SpaceImage } from "@/types/events";

type LocatedImage = SpaceImage & { server: ServerId };

export default function ImagesGallery({ active, query, visibleProjects, onPage, onSession }: {
  active: boolean;
  query: string;
  visibleProjects: string[] | null;
  onPage: (target: PageTarget, title: string) => void;
  onSession: (id: string) => void;
}) {
  const servers = useServers();
  const owners = useMemo(() => [LOCAL, ...servers.filter((s) => s.status === "connected").map((s) => s.id)], [servers]);
  const [images, setImages] = useState<LocatedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const seq = ++generation.current;
    const results = await Promise.allSettled(owners.map(async (server) => {
      const { images, unavailable } = await invoke<ImageListing>("list_space_images", {}, server);
      return { images: images.map((row) => ({ ...row, server })), unavailable };
    }));
    if (seq !== generation.current) return;
    setImages(results.flatMap((r) => r.status === "fulfilled" ? r.value.images : []).sort((a, b) => b.modified - a.modified));
    setReadError(results.flatMap((r, i) => {
      if (r.status === "rejected") return [`${owners[i]}: ${String(r.reason)}`];
      return r.value.unavailable ? ["Some image sources could not be read."] : [];
    }).join(" · "));
    setLoading(false);
  }, [owners]);

  useEffect(() => {
    if (!active) return;
    let timer: number;
    let stopped = false;
    const reload = () => {
      if (stopped) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 150);
    };
    const listeners = ["page_assets_changed", "pages_changed", "space_images_changed", "session_title", "live_state"].map((event) => listen(event, reload));
    listeners.push(listen<AgentEvent>("agent_event", ({ payload }) => { if (payload.payload.type === "turn_completed") reload(); }));
    void refresh();
    return () => {
      stopped = true;
      generation.current++;
      window.clearTimeout(timer);
      listeners.forEach((off) => void off.then((fn) => fn()));
    };
  }, [active, refresh]);
  useHotkey("panel.refresh", () => void refresh(), { enabled: active, page: true });

  const words = query.trim().toLowerCase().split(/\s+/);
  const listed = images.filter((row) => owners.includes(row.server) &&
    (!visibleProjects || !row.projectPaths.length || row.projectPaths.some((p) => visibleProjects.includes(qualify(p, row.server)))) &&
    words.every((word) => `${row.name} ${row.sourceTitle}`.toLowerCase().includes(word)));
  const previews = listed.map((row) => ({ src: fileSrc(qualify(row.path, row.server)), name: row.name }));
  const index = listed.findIndex((row) => qualify(row.path, row.server) === selected);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    setUploadError("");
    const failures = [];
    for (const file of files) {
      try { await uploadSpaceAsset(null, file); }
      catch (reason) { failures.push(`${file.name}: ${String(reason)}`); }
    }
    setUploading(false);
    setUploadError(failures.join(" · "));
    void refresh();
  };

  return <>
    <header className="spaces-header">
      <h2 className="text-xl font-semibold tracking-tight">Images</h2>
      <input ref={picker} hidden type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp" onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        void upload(files);
      }} />
      <Button size="sm" className="ml-auto" disabled={uploading} onClick={() => picker.current?.click()}>
        {uploading ? <Loader2 className="animate-spin" /> : <Upload />}{uploading ? "Uploading…" : "Upload images"}
      </Button>
    </header>
    {readError && <div role="alert" className="spaces-error">{readError}<button onClick={() => void refresh()}>Retry</button></div>}
    {uploadError && <div role="alert" className="spaces-error">{uploadError}</div>}
    {loading ? <div role="status" className="spaces-empty"><Loader2 className="size-5 animate-spin" /><p>Loading images…</p></div>
      : listed.length === 0 && readError ? null : listed.length === 0 ? <div className="spaces-empty"><ImageIcon className="size-8 text-muted-foreground/60" />
          <h3>{query ? "No matching images" : "No images yet"}</h3>
          <p>{query ? "Try an image name, Page title, or session title." : "Generate an image in a session or upload one here or in a Page."}</p></div>
      : <div className="spaces-images-grid">
        {listed.map((row, i) => {
          const key = qualify(row.path, row.server);
          const source = row.pageId || row.sessionId;
          return <article key={key} className="min-w-0">
            <button type="button" className="block w-full cursor-zoom-in text-left" onClick={() => setSelected(key)} aria-label={`Preview ${row.name}`}>
              <Thumb item={previews[i]} className="aspect-[4/3] w-full rounded-lg border border-border bg-muted" />
              <span className="mt-2 block truncate text-ui font-medium" title={row.name}>{row.name}</span>
            </button>
            {source ? <button type="button" className="mt-1 flex max-w-full items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" onClick={() => {
              if (row.pageId) onPage({ id: row.pageId, server: row.server }, row.sourceTitle);
              else if (row.sessionId) { noteSession(row.sessionId, row.server); onSession(row.sessionId); }
            }}>
              {row.pageId ? <FileText className="size-3 shrink-0" /> : <MessageSquare className="size-3 shrink-0" />}
              <span className="truncate">{row.sourceTitle || (row.pageId ? "Open Page" : "Open session")}</span>
            </button> : <span className="mt-1 block text-xs text-muted-foreground">Uploaded to Spaces</span>}
          </article>;
        })}
      </div>}
    <ImageLightbox images={previews} index={active && index >= 0 ? index : null}
      onIndex={(i) => setSelected(qualify(listed[i].path, listed[i].server))} onClose={() => setSelected(null)} />
  </>;
}
