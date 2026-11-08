import { useEffect, useMemo, type MutableRefObject } from "react";
import { Plus } from "lucide-react";

import IssuePanel from "@/components/IssuePanel";
import { Button } from "@/components/ui/button";
import { useSessionIssues } from "@/hooks/useIssues";
import type { IssueRef } from "@/types/events";

/// One issue across the whole sheet: the side pane's detail, in a column held
/// to a reading width. Mounted per tab and hidden while another is up, so each
/// keeps its scroll; it reads only while shown.
export default function IssueTabView({
  issue,
  active,
  refreshRef,
  onWorkOn,
}: {
  issue: IssueRef;
  active: boolean;
  /// Where the shown tab hands its refresh up, for the toolbar button and ⌘R.
  refreshRef: MutableRefObject<(() => void) | null>;
  onWorkOn: (issue: IssueRef) => void;
}) {
  const refs = useMemo(() => [issue], [issue]);
  const data = useSessionIssues(refs, active);

  useEffect(() => {
    if (!active) return;
    refreshRef.current = data.refresh;
    return () => {
      if (refreshRef.current === data.refresh) refreshRef.current = null;
    };
  }, [active, data.refresh, refreshRef]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-4 pb-12">
        <div className="flex justify-end px-3 pb-1">
          <Button variant="secondary" size="xs" onClick={() => onWorkOn(issue)}>
            Work on it
            <Plus data-icon="inline-end" />
          </Button>
        </div>
        <IssuePanel
          // No session, so no link to remove.
          sessionId={null}
          issues={refs}
          onUnlink={() => {}}
          details={data.details}
          loading={data.loading}
          unavailable={data.unavailable}
        />
      </div>
    </div>
  );
}
