import { Check, RotateCw, TriangleAlert } from "lucide-react";

import { type ManualCheck, updateFailure } from "@/hooks/useUpdater";
import type { UpdateStatus } from "@/types/events";

type UpdateRowProps = {
  status: UpdateStatus | null;
  /// Where something the user asked for has got to. The check verdicts are only
  /// drawn when there is no `status` — a real update outranks any verdict about
  /// not finding one — while the two install failures are drawn once one exists.
  manual: ManualCheck;
};

/// Update verdicts, pinned to the sidebar's bottom edge. The offer itself is
/// the rail's `UpdateRailButton`.
///
/// Drawn only while there is something to say — the sidebar has no permanent
/// footer, and a row that reads "up to date" is chrome for a fact nobody asked
/// about.
export default function UpdateRow({ status, manual }: UpdateRowProps) {
  // Nothing found, and a hand-triggered check waiting on or reporting that.
  // Still nothing at all for the scheduled check, which is the common case and
  // asked no question.
  if (!status) {
    if (manual === "idle") return null;
    return (
      <Footer>
        <Note>
          {manual === "checking" && (
            <>
              <RotateCw className="size-4 shrink-0 animate-spin" />
              Checking for updates…
            </>
          )}
          {manual === "up_to_date" && (
            <>
              <Check className="size-4 shrink-0" />
              Up to date
            </>
          )}
          {manual === "failed" && (
            <>
              <TriangleAlert className="size-4 shrink-0" />
              Couldn't check for updates
            </>
          )}
        </Note>
      </Footer>
    );
  }

  // A failed install needs a sentence the rail has no room for.
  const failure = updateFailure(manual);
  if (!failure) return null;
  return (
    <Footer>
      <Note>
        <TriangleAlert className="size-4 shrink-0" />
        {failure}
      </Note>
    </Footer>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="shrink-0 px-2 py-2">{children}</div>;
}

/// A line the row states rather than offers — same metrics as the downloading
/// line, so the footer doesn't change height as a check moves through it.
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1.5 py-1 text-ui text-muted-foreground">
      {children}
    </div>
  );
}
