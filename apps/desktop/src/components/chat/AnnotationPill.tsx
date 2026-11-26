import { MessageSquareText, Pencil, SquareDashed, Trash2, X } from "lucide-react";
import { HoverCard } from "radix-ui";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AnnotationTarget } from "@/types/events";

/// One annotation as the pill lists it, whichever side of the send it is on.
export type PillItem = {
  key: string;
  note: string;
  target: AnnotationTarget;
  url: string;
  /// The crop, ready for an `<img>`, or `null` where none was taken.
  src: string | null;
};

/// What Ask marked on a page, counted in one pill. Hovering it lists each
/// crop with its note; with `onEdit` and `onDelete` — the composer, before
/// sending — each row can be changed or taken off.
///
/// One pill rather than a tile per annotation: the crops are a selection's
/// context, not attachments the reader chose, and a row of them would read
/// as pictures to look at.
export default function AnnotationPill({
  items,
  onClear,
  onEdit,
  onDelete,
  side = "top",
  align = "start",
}: {
  items: PillItem[];
  onClear?: () => void;
  onEdit?: (key: string, note: string) => void;
  onDelete?: (key: string) => void;
  side?: "top" | "bottom";
  align?: "start" | "end";
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!items.length) return null;
  const count = `${items.length} annotation${items.length === 1 ? "" : "s"}`;

  return (
    <HoverCard.Root openDelay={120} closeDelay={150} onOpenChange={(open) => !open && setEditing(null)}>
      <div className="group/pill relative inline-flex w-fit">
        <HoverCard.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline-strong bg-card px-2.5 text-ui text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <MessageSquareText className="size-3.5 text-muted-foreground" />
            {count}
          </button>
        </HoverCard.Trigger>

        {/* The tray's own remove control, on the pill as on a tile. */}
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Remove ${count}`}
            className={cn(
              "absolute -top-1.5 -right-1.5 rounded-full border border-border bg-secondary p-0.5 text-secondary-foreground opacity-0 transition-opacity",
              "group-hover/pill:opacity-100 focus-visible:opacity-100 focus-visible:outline-none",
            )}
          >
            <X className="size-3" strokeWidth={2.5} />
          </button>
        )}
      </div>

      <HoverCard.Portal>
        <HoverCard.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="z-50 flex max-h-96 w-88 flex-col overflow-y-auto rounded-xl bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur-xl duration-100 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          {items.map((item, i) => (
            <Row
              key={item.key}
              item={item}
              divided={i > 0}
              editing={editing === item.key}
              onEditStart={onEdit && (() => setEditing(item.key))}
              onEditEnd={(note) => {
                setEditing(null);
                if (note !== null && onEdit) onEdit(item.key, note);
              }}
              onDelete={onDelete && (() => onDelete(item.key))}
            />
          ))}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

function Row({
  item,
  divided,
  editing,
  onEditStart,
  onEditEnd,
  onDelete,
}: {
  item: PillItem;
  divided: boolean;
  editing: boolean;
  onEditStart?: () => void;
  /// `null` is a cancel.
  onEditEnd: (note: string | null) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState(item.note);

  return (
    <div className={cn("flex flex-col gap-1.5 rounded-lg px-2 py-2", divided && "border-t border-hairline")}>
      <div className="flex items-center gap-2">
        {item.src ? (
          <img
            src={item.src}
            alt=""
            className="h-8 w-12 shrink-0 rounded-md border border-hairline-strong bg-card object-cover object-top"
          />
        ) : (
          <span className="flex h-8 w-12 shrink-0 items-center justify-center rounded-md border border-hairline-strong bg-card text-muted-foreground">
            <SquareDashed className="size-3.5" />
          </span>
        )}

        <Target target={item.target} url={item.url} />

        {(onEditStart || onDelete) && !editing && (
          <span className="ml-auto flex shrink-0 items-center">
            {onEditStart && (
              <Button variant="ghost" size="icon-sm" aria-label="Edit note" onClick={() => {
                setDraft(item.note);
                onEditStart();
              }}>
                <Pencil />
              </Button>
            )}
            {onDelete && (
              <Button variant="ghost" size="icon-sm" aria-label="Delete annotation" onClick={onDelete}>
                <Trash2 />
              </Button>
            )}
          </span>
        )}
      </div>

      {editing ? (
        <textarea
          // Focused on open: the pencil was the reader asking to type.
          autoFocus
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => onEditEnd(draft.trim() || item.note)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onEditEnd(draft.trim() || item.note);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onEditEnd(null);
            }
          }}
          className="w-full resize-none rounded-md border border-hairline-strong bg-transparent px-2 py-1.5 text-chat outline-none focus:border-ring"
        />
      ) : (
        item.note && <p className="text-chat break-words whitespace-pre-wrap">{item.note}</p>
      )}
    </div>
  );
}

/// What the annotation points at, in the muted line above its note.
function Target({ target, url }: { target: AnnotationTarget; url: string }) {
  const where = hostOf(url);
  if (target.kind === "element") {
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-ui text-muted-foreground" title={target.selector}>
        <code className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
          {target.tag}
        </code>
        <span className="truncate">{target.text || where}</span>
      </span>
    );
  }
  return (
    <span className="min-w-0 truncate text-ui text-muted-foreground" title={url}>
      {target.kind === "region" ? "Selected region" : "Visible page"}
      {where && ` · ${where}`}
    </span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
