import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { invoke, listen, type ServerId } from "@/lib/transport";
import type { RecoveryItem } from "@/types/events";

export default function RecoveryNotice({ sessionId, server, busy }: {
  sessionId: string;
  server: ServerId;
  busy: boolean;
}) {
  const [items, setItems] = useState<RecoveryItem[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let current = true;
    invoke<RecoveryItem[]>("list_work_recovery", { sessionId }, server).then(
      (found) => { if (current) { setItems(found); setFailure(null); } },
      (error) => {
        if (current && !String(error).includes("unknown command")) setFailure(String(error));
      },
    );
    return () => { current = false; };
  }, [sessionId, server, busy, revision]);

  useEffect(() => {
    const listeners = ["session_changed", "recovery_changed"].map((event) =>
      listen<{ sessionId: string }>(event, (update) => {
        if (update.server === server && update.payload.sessionId === sessionId) setRevision((value) => value + 1);
      }),
    );
    listeners.push(listen("live_state", (update) => {
      if (update.server === server) setRevision((value) => value + 1);
    }));
    return () => { for (const listener of listeners) void listener.then((unlisten) => unlisten()); };
  }, [server, sessionId]);

  const dismiss = async (item: RecoveryItem) => {
    if (sending) return;
    setSending(item.id);
    try {
      await invoke("dismiss_work_recovery", { sessionId, id: item.id }, server);
      setRevision((value) => value + 1);
    } catch (error) {
      setFailure(String(error));
    } finally {
      setSending(null);
    }
  };

  const recover = async (item: RecoveryItem) => {
    if (sending) return;
    setSending(item.id);
    setFailure(null);
    try {
      const delivery = await invoke<{ state: string; detail?: string }>("recover_work", {
        sessionId: item.sessionId, id: item.id, action: item.action,
      }, server);
      if (delivery.state === "failed" || delivery.state === "uncertain" || delivery.state === "canceled") {
        throw new Error(delivery.detail ?? "The continuation could not be submitted. Inspect the session before trying again.");
      }
      setRevision((value) => value + 1);
    } catch (error) {
      setFailure(String(error));
    } finally {
      setSending(null);
    }
  };

  if (!items.length && !failure) return null;
  return <div className="mb-7 max-h-64 space-y-3 overflow-y-auto px-3 text-ui" aria-label="Work recovery">
    {items.map((item) => <div key={`${item.kind}-${item.id}`} className="space-y-1">
      <p className="font-medium">Work interrupted</p>
      <p className="text-muted-foreground">{item.reason}</p>
      <div className="flex items-start gap-2">
        {(item.action === "resume" || item.action === "retry") && <Button
          size="sm" variant="secondary" disabled={busy || sending !== null}
          onClick={() => void recover(item)}
        >{sending === item.id ? "Sending…" : item.action === "resume" ? "Resume" : "Retry"}</Button>}
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer py-1.5 text-muted-foreground">Inspect</summary>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/40 p-3 font-mono text-xs">{JSON.stringify(item.details, null, 2)}</pre>
        </details>
        <Button size="sm" variant="ghost" disabled={sending !== null} onClick={() => void dismiss(item)}>Dismiss</Button>
      </div>
    </div>)}
    {failure && <div role="alert" className="text-destructive">
      <p>{failure}</p>
      <Button size="sm" variant="ghost" onClick={() => setRevision((value) => value + 1)}>Refresh recovery</Button>
    </div>}
  </div>;
}
