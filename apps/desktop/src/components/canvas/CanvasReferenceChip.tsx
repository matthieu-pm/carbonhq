import { useEffect, useState } from "react";
import { Frame, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fileSrc, invoke, qualify, type ServerId } from "@/lib/transport";
import { watchCanvasReference } from "@/lib/canvasReferences";
import type { Attachment, CanvasReference, CanvasReferenceStatus } from "@/types/events";

export default function CanvasReferenceChip({ reference, server, onRefresh }: {
  reference: CanvasReference;
  server: ServerId;
  onRefresh?: (attachment: Attachment) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CanvasReferenceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    let request = 0;
    const refresh = () => {
      const n = ++request;
      const metadata = { ...reference, preview: { path: null, url: null, mimeType: null } };
      void invoke<CanvasReferenceStatus>("canvas_reference_status", { reference: metadata }, server).then((next) => {
        if (!stopped && n === request) setStatus(next);
      }).catch((e) => { if (!stopped && n === request) setStatus({ state: "unavailable", revision: null, message: `Could not check the design: ${String(e)}` }); });
    };
    setStatus(null);
    refresh();
    const unsubscribe = watchCanvasReference(server, reference.canvasId, refresh);
    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [reference, server]);
  const preview = reference.preview.url ?? (reference.preview.path ? fileSrc(qualify(reference.preview.path, server)) : undefined);
  const label = status?.state === "changed" ? "Design changed" : status?.state === "unavailable" ? "Unavailable" : null;
  const refresh = async () => {
    if (!onRefresh || status?.revision == null || busy) return;
    setBusy(true); setError(null);
    try {
      const [attachment] = await invoke<Attachment[]>("capture_canvas_selection", { projectPath: reference.projectPath, id: reference.canvasId, revision: status.revision, picks: [{ frameId: reference.frameId, nodeId: reference.nodeId, bounds: null }] }, server);
      onRefresh({ ...attachment, path: qualify(attachment.path, server) });
      setOpen(false);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={setOpen}>
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={() => setOpen(true)} aria-label={`Preview design ${reference.name}`}
          className="flex h-14 max-w-64 items-center gap-2 overflow-hidden rounded-lg border border-hairline-strong bg-card pr-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {preview ? <img src={preview} alt="" className="size-14 shrink-0 border-r border-hairline bg-surface-well object-contain" /> : <Frame className="ml-3 size-5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-ui"><span className="min-w-0 truncate font-medium">{reference.name}</span><span className="ml-auto shrink-0 text-muted-foreground">r{reference.revision}</span></span>
            <span className="flex items-center gap-1.5 text-ui text-muted-foreground"><span className="min-w-0 truncate">{reference.canvasName}</span>{label && <span className="shrink-0">· {label}</span>}</span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent>{reference.canvasName} · {reference.name} · Revision {reference.revision}</TooltipContent>
    </Tooltip>
    <DialogContent className="max-h-[85vh] max-w-160 overflow-y-auto">
      <div className="min-w-0 space-y-1 pr-6">
        <DialogTitle className="break-words">{reference.name}</DialogTitle>
        <DialogDescription>{reference.canvasName} · {reference.frameName} · Revision {reference.revision}</DialogDescription>
      </div>
      {preview && <img src={preview} alt={`Captured ${reference.framePreview ? reference.frameName : reference.name}`} className="max-h-[50vh] max-w-full justify-self-center rounded-lg border border-hairline-strong bg-surface-well object-contain" />}
      <div className="space-y-1 text-ui text-muted-foreground">
        <p>{reference.frameWidth} × {reference.frameHeight} frame{reference.nodeId && !reference.framePreview ? ` · ${Math.round(reference.bounds.width)} × ${Math.round(reference.bounds.height)} layer` : ""}</p>
        {reference.framePreview && <p>This layer has no visible crop. Showing its frame.</p>}
        <p>Captured {new Date(reference.capturedAt).toLocaleString()}</p>
        <p role="status">{status?.message ?? "Checking design…"}</p>
      </div>
      {error && <p role="alert" className="text-ui text-destructive">{error}</p>}
      {onRefresh && status?.state === "changed" && <div className="flex justify-end">
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void refresh()}><RefreshCw className={busy ? "animate-spin" : ""} />{busy ? "Refreshing…" : "Refresh reference"}</Button>
      </div>}
    </DialogContent>
  </Dialog>;
}
