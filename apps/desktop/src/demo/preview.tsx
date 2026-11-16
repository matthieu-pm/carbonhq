import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";

import PreviewControl from "@/components/preview/PreviewControl";
import WindowToolbar from "@/components/layout/WindowToolbar";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import { invoke } from "@/lib/transport";
import type { SessionIndexItem } from "@/types/events";
import "../App.css";

/// The shipping preview control against a throwaway carbon-serve, opened with server and token.
function Demo() {
  const [sessions, setSessions] = useState<SessionIndexItem[]>([]);
  const [selected, setSelected] = useState("");
  const [pages, setPages] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const active = sessions.find((s) => s.sessionId === selected);

  useEffect(() => {
    void invoke<SessionIndexItem[]>("list_session_index_items", { archived: false }).then((rows) => {
      setSessions(rows);
      setSelected(rows[0]?.sessionId ?? "");
    }).catch((e: unknown) => setError(String(e)));
  }, []);

  return <TooltipProvider>
    <div className="flex h-screen flex-col bg-background text-foreground">
      <WindowToolbar fullscreen>
        <span className="flex-1 text-sm font-medium">{active?.title ?? "Managed preview"}</span>
        {active && <PreviewControl key={active.sessionId} sessionId={active.sessionId} cwd={active.cwd}
          onOpen={async (id, url) => { setPages((prev) => ({ ...prev, [id]: url })); }} />}
      </WindowToolbar>
      <main className="flex min-h-0 flex-1 gap-4 p-4">
        <aside className="flex w-64 shrink-0 flex-col gap-2">
          <p className="mb-2 text-xs text-muted-foreground">Real sessions on the test server</p>
          {sessions.map((s) => <Button key={s.sessionId} variant={s.sessionId === selected ? "secondary" : "ghost"}
            className="justify-start" onClick={() => setSelected(s.sessionId)}>{s.title}</Button>)}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </aside>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface-well">
          {pages[selected] ? <>
            <p className="border-b border-hairline px-3 py-2 font-mono text-xs text-muted-foreground">{pages[selected]}</p>
            <iframe title="Running app preview" src={pages[selected]} className="min-h-0 flex-1 border-0 bg-white" />
          </> : <div className="m-auto max-w-72 text-center text-sm text-muted-foreground">Start a preview to run the app in this session’s worktree.</div>}
        </div>
      </main>
      <DemoThemeBar />
    </div>
  </TooltipProvider>;
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<Demo />);
import.meta.hot?.dispose(() => root.unmount());
