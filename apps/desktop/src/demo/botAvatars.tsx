import { StrictMode, useState, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";

import BotAvatar from "@/components/BotAvatar";
import Crew from "@/components/Crew";
import PinnedSummary from "@/components/PinnedSummary";
import SessionAvatar from "@/components/SessionAvatar";
import SubagentPanel from "@/components/SubagentPanel";
import BackgroundTasksIndicator from "@/components/chat/BackgroundTasksIndicator";
import StreamingToolCall from "@/components/chat/StreamingToolCall";
import SubagentRow from "@/components/chat/SubagentRow";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type { PaneState } from "@/hooks/useSessions";
import { BOT_AVATARS, botAvatar } from "@/lib/botAvatars";
import type { SubagentRun } from "@/lib/transcript";
import type { SessionIndexItem } from "@/types/events";
import "../App.css";

mockIPC((command) => command === "list_open_apps" ? [] : null);

if (new URLSearchParams(location.search).has("reduced-motion")) {
  const matchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query) => {
    const media = matchMedia(query);
    if (query === "(prefers-reduced-motion: reduce)") Object.defineProperty(media, "matches", { value: true });
    return media;
  };
}

const noop = () => {};
const seeds = BOT_AVATARS.map(({ definition }) => {
  let i = 0;
  while (botAvatar(`${definition.id}-${i}`).definition.id !== definition.id) i++;
  return `${definition.id}-${i}`;
});
const pane = (): PaneState => ({ session: null, busy: false, working: null,
  backgroundTaskCount: 0, liveTaskIds: new Set(), compacting: false, apiRetry: null, queuedMessages: [] });
const chat = { onOpenSubagent: noop, onOpenSession: noop, onOpenSubagentPanel: noop,
  onOpenPlan: noop, onRespondPermission: noop, onAnswerQuestions: noop };
const names = ["Review the conversation layout", "Check keyboard navigation", "Verify background tasks"];
const crewItem = (i: number): SessionIndexItem => ({
  sessionId: seeds[i + 3], harness: "claude_code", cwd: "/work/carbon", projectPath: "/work/carbon",
  branch: null, worktreeName: null, worktreeRemoved: false, title: names[i], titleLocked: false,
  model: "opus", effort: null, permissionMode: "auto", fast: false, status: "idle", forkFrom: null,
  threadId: null, issues: [], parentSessionId: "demo", created: "2026-11-13T00:00:00Z",
  modified: "2026-11-13T00:00:00Z", archived: false, pinned: false, hidden: false, aside: false, continueOff: false,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 rounded-xl border border-border bg-card p-4">
    <h2 className="mb-3 text-xs font-medium text-muted-foreground">{title}</h2>{children}
  </section>;
}

function Demo() {
  const [working, setWorking] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [crewOpen, setCrewOpen] = useState<ReadonlySet<string>>(new Set());
  const runs: SubagentRun[] = names.map((description, i) => ({
    id: seeds[i], taskId: `task-${i}`, label: description, description, status: null, lastTool: null,
    done: i === 1 || !working, background: i === 2 && working, usage: null, events: [], inline: false,
    spawn: { id: `spawn-${i}`, sessionId: "demo", harness: "claude_code", seq: i,
      ts: "2026-11-13T00:00:00Z", turnId: null, subagent: null, raw: null,
      payload: { type: "tool_call_started", callId: seeds[i], name: "Agent", toolType: "subagent_spawn",
        title: null, input: { prompt: `Review this area: ${description}.`, description }, rawInput: null } },
  }));
  return <TooltipProvider>
    <main className="min-h-screen bg-background px-8 py-6 text-foreground">
      <header className="mb-5 flex items-center justify-between gap-4">
        <div><h1 className="text-xl font-medium">Meet the crew</h1>
          <p className="mt-1 text-sm text-muted-foreground">32 characters. One identity, wherever the agent appears.</p></div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setStreaming((v) => !v); setWorking(true); }}>
            {streaming ? "Commit spawn" : "Stream spawn"}</Button>
          <Button onClick={() => { setWorking((v) => !v); setStreaming(false); }}>
            {working ? "Finish work" : "Start agents"}</Button>
        </div>
      </header>
      <section aria-label="32 avatar characters" className="mb-5 grid grid-cols-4 gap-2 sm:grid-cols-8">
        {BOT_AVATARS.map(({ definition }, i) => <div key={definition.id}
          className="flex flex-col items-center rounded-lg bg-surface-raised px-2 py-1.5">
          <BotAvatar seed={seeds[i]} working={working} className="size-14" />
          <span className="text-xs text-muted-foreground">{definition.name}</span>
        </div>)}
      </section>
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr_320px]">
        <Section title="Conversation">
          <div className="flex flex-col gap-4">
            {runs.map((run, i) => streaming && i === 0
              ? <StreamingToolCall key={run.id} callId={run.id} name="Agent" partialJson={JSON.stringify({ description: run.description })} />
              : <SubagentRow key={run.id} run={run} onOpen={setSelected} />)}
            {working && <BackgroundTasksIndicator count={1} agentIds={[seeds[2]]} onOpen={() => setSelected(seeds[2])} />}
            <div className="flex items-center gap-1 text-ui text-muted-foreground">
              <SessionAvatar sessionId={seeds[3]} name="Crew reviewer" />Crew reviewer sent a message
            </div>
          </div>
        </Section>
        <Section title="Side panel">
          <SubagentPanel runs={runs} selectedId={selected} resultByCallId={new Map()}
            live={working} onSelect={setSelected} onStopTask={() => setWorking(false)} />
        </Section>
        <div className="flex min-w-0 flex-col gap-4">
          <Section title="Pinned summary">
            <PinnedSummary sessionId="demo" project="carbon" cwd="/work/carbon" environment="This Mac"
              branch={null} worktree={null} harness="codex" changes={null} changesLoading={false} changesError={null}
              prs={[]} prsLoading={false} prsError={null} subagents={runs} busy={working}
              liveTaskIds={working ? new Set(["task-2"]) : new Set()} sources={[]} context={null}
              open docked onOpen={() => setSelected(seeds[0])} onHide={noop} />
          </Section>
          <Section title="Crew sessions">
            <Crew rows={names.map((_, i) => ({ item: crewItem(i), busy: working && i === 0,
              asking: i === 2, unread: i === 1 }))} open={crewOpen} selectedId={null}
              paneState={pane} prFor={() => undefined} onToggle={(id) => setCrewOpen((prev) => prev.has(id) ? new Set() : new Set([id]))}
              onFocus={noop} onOpenInMain={noop} onShowInSidebar={noop} composing={false} active={false} chat={chat} />
          </Section>
        </div>
      </div>
      <DemoThemeBar />
    </main>
  </TooltipProvider>;
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<StrictMode><Demo /></StrictMode>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
