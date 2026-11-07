import { useTheme } from "@/hooks/useTheme";
import { readableStateColor } from "@/lib/issueColor";
import { cn } from "@/lib/utils";
import type { IssueLabel } from "@/types/events";

/// One label, in the colour the tracker gave it.
///
/// A label has no meaning apart from that colour, unlike a status, which folds
/// onto a fixed vocabulary — so it is drawn rather than approximated. **Through
/// `readableStateColor`, the same correction the state glyphs take**: a GitHub
/// repository picks its label colours against GitHub's own white background and
/// half of them are pale (`#ffffff` for `wontfix`, `#ededed` for `no-review`),
/// which reads on this app's dark palette and vanishes on its light one. That
/// function keeps the hue and spends the lightness, so a green label stays green
/// and only stops being invisible.
///
/// Its own component because three surfaces draw one — the page's rows, the
/// panel's detail and the filter menu's dot — and a per-site copy would leave
/// them disagreeing about the mode the first time one forgot to read it.
/// The pill every trailing chip on an issue row wears — labels, project, PRs,
/// relations — so the row reads as one set of metadata, Linear's way. A fixed
/// height, since the row's label strip hides overflow by being one chip tall.
export const ISSUE_CHIP =
  "h-6 shrink-0 items-center gap-1.5 rounded-full border border-border px-2 text-muted-foreground";

export default function IssueLabelChip({
  label,
  dot,
  className,
}: {
  label: IssueLabel;
  /// Draw the colour alone, for a row that already carries the name as text.
  dot?: boolean;
  className?: string;
}) {
  const { resolvedMode } = useTheme();
  const color = label.color ? readableStateColor(label.color, resolvedMode === "light") : null;

  const swatch = (
    <span
      className={cn("size-2 shrink-0 rounded-full", dot && className)}
      style={{ background: color ?? "var(--muted-foreground)" }}
    />
  );
  if (dot) return swatch;

  // Linear's own pill: the colour on a dot and the name in the row's quiet
  // tone, so a row of five labels reads as metadata rather than five accents.
  return (
    <span
      className={cn(ISSUE_CHIP, "inline-flex", className)}
    >
      {swatch}
      {label.name}
    </span>
  );
}
