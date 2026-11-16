import { useState } from "react";
import { SquareDashedMousePointer, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Attachment } from "@/types/events";

export default function InspectionChip({ attachment, onRemove }: {
  attachment: Attachment;
  onRemove: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const context = attachment.inspection!;
  const label = context.selector ?? "Layout region";
  const source = context.source;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" onClick={() => setOpen(true)}
            aria-label={`Preview ${label}`}
            className="flex h-14 max-w-60 items-center gap-2 rounded-lg border border-hairline-strong bg-card pr-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <img src={attachment.preview ?? undefined} alt="" className="size-14 shrink-0 rounded-l-lg border-r border-hairline object-cover" />
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-ui text-muted-foreground"><SquareDashedMousePointer className="size-3" />Inspection</span>
              <span className="block truncate font-mono text-ui">{label}</span>
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Preview inspection</TooltipContent>
      </Tooltip>
      <DialogContent className="max-h-[85vh] max-w-160 overflow-y-auto">
        <div className="min-w-0 space-y-1 pr-6">
          <DialogTitle className="break-all font-mono">{label}</DialogTitle>
          <DialogDescription>
            {context.pagePath} · {Math.round(context.viewport.width)} × {Math.round(context.viewport.height)} viewport
          </DialogDescription>
        </div>
        <img src={attachment.preview ?? undefined} alt={`Captured ${label}`}
          className="max-h-72 max-w-full justify-self-center rounded-lg border border-hairline-strong object-contain" />
        <div className="space-y-1 text-ui text-muted-foreground">
          <p>{Math.round(context.bounds.width)} × {Math.round(context.bounds.height)} at ({Math.round(context.bounds.x)}, {Math.round(context.bounds.y)})</p>
          <p className="break-all">Source: {source.confidence}{source.file ? ` · ${source.file}${source.line ? `:${source.line}` : ""}` : ""}</p>
          <p>Captured {new Date(context.capturedAt).toLocaleString()} · Tab {context.tabId}</p>
          {context.kind === "region" && <p>This region has no single source element.</p>}
        </div>
        {context.markup && <details className="text-ui">
          <summary className="cursor-pointer text-muted-foreground">Captured markup</summary>
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-hairline bg-background p-3 font-mono text-ui whitespace-pre-wrap break-all">{context.markup}</pre>
        </details>}
        {Object.keys(context.styles).length > 0 && <details className="text-ui">
          <summary className="cursor-pointer text-muted-foreground">Computed styles</summary>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-ui">
            {Object.entries(context.styles).map(([key, value]) => <div key={key} className="contents">
              <dt className="text-muted-foreground">{key}</dt><dd className="min-w-0 break-all">{value}</dd>
            </div>)}
          </dl>
        </details>}
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={() => { setOpen(false); onRemove(attachment.path); }}>
            <X className="size-3.5" />Remove from chat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
