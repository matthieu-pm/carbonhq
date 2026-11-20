import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Download, Loader2, Play, Presentation } from "lucide-react";
import { gallery } from "@openpresentation/gallery";
import { createOpfEditor, type OpfEditor } from "@openpresentation/opf-editor/workspace";
import { loadPreviewFonts } from "@openpresentation/opf-render/preview-fonts";
import "@openpresentation/opf-editor/styles.layered.css";
import "./deck.css";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { editPageDraft, markPageDraftPending, pageDraft, persistPageDraft, resolvePageDraft, savePageDraft, usePageDocument, type PageDraft } from "@/hooks/usePageDocument";
import { uploadPageAsset, usePageAssets } from "@/hooks/usePageAssets";
import { readPage, type LocatedPage, type Page } from "@/lib/pages";
import { deckSlides, renderSlide, loadDeckImage, imagePreview } from "@/lib/deckPreview";

type Props = {
  page: LocatedPage<Page>;
  active: boolean;
  snapshot: boolean;
  onOpenCurrent: () => void;
  onTitle: (title: string) => void;
  onFlushReady: (flush: () => void) => void;
};

export default function DeckDocument(props: Props) {
  return props.snapshot ? <DeckView {...props} /> : <LiveDeck {...props} />;
}

function LiveDeck(props: Props) {
  const draft = usePageDocument(props.page, props.active);
  return <DeckView {...props} draft={draft} />;
}

function DeckView({ page, active, snapshot, draft, onOpenCurrent, onTitle, onFlushReady }: Props & { draft?: PageDraft }) {
  const source = draft?.markdown ?? page.markdown;
  const title = draft?.title ?? page.title;
  const readOnly = snapshot || Boolean(draft?.base.trashed);
  const mount = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const handle = useRef<OpfEditor | null>(null);
  const currentSource = useRef(source);
  const initial = useRef(source);
  initial.current = source;
  const [ready, setReady] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const [reviewed, setReviewed] = useState<LocatedPage<Page> | null>(null);
  const [comparing, setComparing] = useState(false);
  const { assets, error: assetError } = usePageAssets(page, active);
  const images = useRef(assets);
  images.current = assets;

  const previews = useRef(new Map<string, string>());
  const referenced = assets.filter((asset) => asset.mimeType.startsWith("image/") && source.includes(asset.url)).map((asset) => asset.url).join("\n");
  useEffect(() => {
    let stopped = false;
    const load = async () => {
      const needed = new Set(referenced.split("\n"));
      let added = false;
      for (const asset of images.current) {
        if (!needed.has(asset.url) || previews.current.has(asset.url)) continue;
        const data = await loadDeckImage(asset, page.server);
        if (stopped) return;
        previews.current.set(asset.url, data);
        added = true;
      }
      if (!stopped && added) {
        if (pageDraft(page)?.dirty) handle.current?.canvas?.render();
        else setGeneration((n) => n + 1);
      }
    };
    if (active && referenced) void load().catch((reason) => { if (!stopped) setError(String(reason)); });
    return () => { stopped = true; };
  }, [active, referenced, page.server, generation]);

  useLayoutEffect(() => {
    if (!active || !mount.current || !toolbar.current) return;
    let stopped = false;
    setReady(false);
    setError("");
    currentSource.current = initial.current;
    let editor: OpfEditor;
    try {
      editor = createOpfEditor(mount.current, {
        document: JSON.parse(initial.current), catalogs: [gallery], fonts: loadPreviewFonts("/opf-fonts"),
        layout: "full", readOnly, persistence: false,
        panels: { source: false, design: true, present: true, export: false },
        // The slide row under the canvas already counts slides, and the
        // inspector is the Design panel, so neither repeats in the bar. `more`
        // holds whatever a narrow window cannot fit.
        toolbar: ["title", "history", "views", "more"], slots: { toolbar: toolbar.current },
        imageResolver: (src) => src ? previews.current.get(src) : undefined,
        onAddAsset: async ({ file }) => {
          if (!(file instanceof File)) throw new Error("Choose an image file.");
          const asset = await uploadPageAsset(page, file, () => {});
          previews.current.set(asset.url, await imagePreview(file, asset));
          images.current = [...images.current, asset];
          return asset.url;
        },
        onChange: ({ document }) => {
          if (stopped || readOnly) return;
          const markdown = JSON.stringify(document);
          currentSource.current = markdown;
          const name = (document as { name?: unknown }).name;
          const title = typeof name === "string" && name.trim() ? name.trim() : "Untitled deck";
          editPageDraft(page, { markdown, title });
        },
        on: {
          draft: () => { if (!readOnly) markPageDraftPending(page); },
          cancel: () => { if (!readOnly) editPageDraft(page, { markdown: currentSource.current }); },
          save: () => { if (!readOnly) void savePageDraft(page); },
        },
        onError: (reason) => { if (!stopped) setError(reason.message); },
      });
      handle.current = editor;
      void editor.ready.then(() => { if (!stopped) setReady(true); }, (reason) => { if (!stopped) setError(String(reason)); });
    } catch (reason) { setError(String(reason)); }
    return () => {
      if (!readOnly && pageDraft(page)?.pending) editor?.commit();
      if (!readOnly) persistPageDraft(page);
      stopped = true;
      handle.current = null;
      editor?.destroy();
    };
  }, [active, generation, readOnly, page.id, page.server]);

  useEffect(() => {
    if (active && source !== currentSource.current && (snapshot || !draft?.dirty)) {
      setGeneration((n) => n + 1);
    }
  }, [active, source, snapshot, draft?.dirty]);
  useEffect(() => { if (!snapshot) onTitle(title); }, [title, snapshot, onTitle]);
  useEffect(() => {
    if (snapshot) return;
    const flush = () => { handle.current?.commit(); persistPageDraft(page); void savePageDraft(page); };
    onFlushReady(flush);
    window.addEventListener("beforeunload", flush);
    return () => window.removeEventListener("beforeunload", flush);
  }, [onFlushReady, page, snapshot]);

  const download = async () => {
    const editor = handle.current;
    if (!editor || !editor.commit()) return;
    setExporting(true);
    setError("");
    try {
      const { exportDeck } = await import("@/lib/deckExport");
      await exportDeck(editor.getDocument(), title, await loadPreviewFonts("/opf-fonts"), images.current, page.server);
    } catch (reason) { setError(String(reason)); }
    finally { setExporting(false); }
  };
  const review = async () => {
    handle.current?.commit();
    setComparing(true);
    try { setReviewed(await readPage(page)); }
    catch (reason) { setError(String(reason)); }
  };
  const resolve = async (choice: "saved" | "draft") => {
    if (!reviewed) return;
    await resolvePageDraft(page, choice, reviewed.revision);
    if (choice === "saved") setGeneration((n) => n + 1);
    setComparing(false);
    setReviewed(null);
  };
  const status = snapshot ? `Revision ${page.revision}` : draft?.conflict ? "Draft kept" : draft?.saving ? "Saving…" : draft?.dirty ? "Unsaved changes" : "Saved";
  // The shared draft queue words its conflict for Pages.
  const message = error || assetError || (!snapshot && (draft?.conflict ? "This deck changed elsewhere. Your draft is kept." : draft?.error));
  return <section className="spaces-document spaces-deck">
    {/* The editor's own bar mounts in `toolbar`, so title, history and views
        share Carbon's one row; renaming the deck takes the whole row. */}
    <div className="spaces-document-tools" data-opf-title-row>
      <Presentation className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div ref={toolbar} className="spaces-deck-toolbar" />
      <div className="spaces-document-meta">
        <span role="status" className="spaces-document-status">{status}</span>
        {snapshot && <Button size="sm" variant="ghost" onClick={onOpenCurrent}>Open current deck</Button>}
        <Tooltip><TooltipTrigger asChild>
          <Button size="sm" variant="ghost" disabled={!ready || exporting} onClick={() => void download()}>{exporting ? <Loader2 className="animate-spin" /> : <Download />}{exporting ? "Exporting…" : "Export"}</Button>
        </TooltipTrigger><TooltipContent>Download as an editable PowerPoint file</TooltipContent></Tooltip>
        <Button size="sm" className="ml-1" disabled={!ready} onClick={() => handle.current?.present()}><Play />Present</Button>
      </div>
    </div>
    {message && <div role="alert" className="spaces-error mt-3">{message}
      {draft?.conflict ? <button onClick={() => void review()}>Review changes</button>
        : <button onClick={() => { if (draft?.dirty) void savePageDraft(page); setGeneration((n) => n + 1); }}>Retry</button>}
    </div>}
    <div ref={mount} className="spaces-deck-editor" />
    <Dialog open={comparing} onOpenChange={(open) => { setComparing(open); if (!open) setReviewed(null); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>This deck changed elsewhere</DialogTitle>
          <DialogDescription>Compare the saved deck with your draft. Both stay in version history after you choose.</DialogDescription>
        </DialogHeader>
        <div className="deck-compare">
          <DeckSide label={reviewed ? `Saved · revision ${reviewed.revision}` : "Saved"} source={reviewed?.markdown} other={draft?.markdown} images={previews.current} />
          <DeckSide label="Your draft" source={draft?.markdown} other={reviewed?.markdown} images={previews.current} />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setComparing(false)}>Keep editing</Button>
          <Button variant="outline" disabled={!reviewed} onClick={() => void resolve("saved")}>Use saved deck</Button>
          <Button disabled={!reviewed} onClick={() => void resolve("draft")}>Save my draft</Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}

/// One half of the conflict dialog: the cover slide, then every slide title,
/// with the titles the other side lacks drawn in full ink.
function DeckSide({ label, source, other, images }: { label: string; source?: string; other?: string; images: Map<string, string> }) {
  const [cover, setCover] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    setCover(null);
    if (source) void renderSlide(JSON.parse(source), 0, images).then((svg) => { if (!stopped) setCover(svg); }, () => {});
    return () => { stopped = true; };
  }, [source, images]);
  const titles = source ? deckSlides(source) : [];
  const theirs = other ? deckSlides(other) : [];
  return <div className="min-w-0">
    <h3 className="mb-2 text-sm font-medium">{label}</h3>
    <div className="deck-cover" aria-hidden="true">{cover ? <img className="deck-cover-svg" src={cover} alt="" /> : source ? <Loader2 className="animate-spin" /> : <Presentation />}</div>
    {source ? <ol>{titles.map((title, index) => <li key={index} data-changed={theirs[index] !== title}>{title}</li>)}</ol>
      : <p className="mt-2 text-xs text-muted-foreground">Loading…</p>}
  </div>;
}
