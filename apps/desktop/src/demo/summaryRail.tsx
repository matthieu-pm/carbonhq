import { useState } from "react";
import ReactDOM from "react-dom/client";
import Crew from "@/components/Crew";
import type { PaneState } from "@/hooks/useSessions";
import type { AgentEvent, AgentEventPayload, SessionIndexItem } from "@/types/events";
import AppShell from "@/components/layout/AppShell";
import PinnedSummary, { PinnedSummaryToggle } from "@/components/PinnedSummary";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import { usePinnedSummary } from "@/hooks/usePinnedSummary";
import type { ContextBreakdown } from "@/types/events";
import "../App.css";

const BREAKDOWN: ContextBreakdown = {
  usedTokens: 221_100, maxTokens: 1_000_000,
  categories: [
    ["messages", "Messages", 127_400, "used"], ["memory_files", "Memory files", 25_900, "used"],
    ["mcp_tools", "MCP tools", 23_200, "used"], ["system_tools", "System tools", 15_100, "used"],
    ["system_prompt", "System prompt", 11_900, "used"], ["skills", "Skills", 9_900, "used"],
    ["autocompact_buffer", "Autocompact buffer", 33_000, "buffer"], ["free_space", "Free space", 745_900, "free"],
    ["mcp_tools_deferred", "MCP tools (deferred)", 229_900, "deferred"],
  ].map(([id, name, tokens, kind]) => ({ id, name, tokens, kind }) as ContextBreakdown["categories"][number]),
};
Object.assign(window, { __TAURI_INTERNALS__: {
  invoke: async (command: string, args?: { cmd?: string }) =>
    (command === "server_invoke" ? args?.cmd : command) === "context_breakdown" ? BREAKDOWN : null,
} });
// Workspace is hidden since its open-in button wants the app list this page does not fake.
localStorage.setItem("ade.pinnedSummaryItems", JSON.stringify({ workspace: false }));
localStorage.removeItem("ade.pinnedSummarySessions");

const TODOS = [
  { content: "Look at how the summary rail is laid out", status: "completed" as const },
  { content: "Move the chat scrollbar for the rail, which takes the canvas's right margin", status: "in_progress" as const },
  { content: "Check it in the summary-rail demo", status: "pending" as const },
];

const CREW: SessionIndexItem[] = ["Review the layout", "Check keyboard navigation", "Verify the release"].map((title, i) => ({
  sessionId: `crew-${i}`, harness: "codex", cwd: "/Users/me/carbon", projectPath: "/Users/me/carbon",
  branch: `dev/crew-${i}`, worktreeName: null, worktreeRemoved: false, title, titleLocked: false,
  model: "gpt-5", effort: null, permissionMode: "auto", fast: false, status: i === 0 ? "in_progress" : "completed",
  forkFrom: null, threadId: null, issues: [], parentSessionId: "demo", created: "2026-11-13T00:00:00Z",
  modified: "2026-11-13T00:00:00Z", archived: false, pinned: false, hidden: i === 2, aside: false, continueOff: false,
}));
const event = (sessionId: string, seq: number, payload: AgentEventPayload): AgentEvent => ({
  sessionId, seq, id: `${sessionId}-${seq}`, harness: "codex", ts: "2026-11-13T00:00:00Z",
  turnId: null, subagent: null, payload,
});
const QUESTION = "Which layout should I check first?";
const noop = () => {};

function Demo() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [working, setWorking] = useState(true);
  const [crewVisible, setCrewVisible] = useState(true);
  const [crewOpen, setCrewOpen] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState("demo");
  const [answer, setAnswer] = useState<string | null>(null);
  const [shownInSidebar, setShownInSidebar] = useState(false);
  const paneState = (id: string): PaneState => ({
    session: { ...CREW.find((item) => item.sessionId === id)!, olderBefore: null, events: [
      event(id, 0, { type: "user_message", text: "Check the crew in the pinned summary.", images: [], issues: [], mcpServers: [], baseline: null, queued: false, from: null, cwd: null }),
      event(id, 1, { type: "assistant_text", block: null, text: "The crew now shares the summary. I am checking the layout and keyboard controls." }),
      ...(id === "crew-2" && !answer ? [event(id, 2, { type: "questions_asked", requestId: "crew-question", toolUseId: "ask", questions: [{
        question: QUESTION, header: "Layout", multiSelect: false, freeText: true,
        options: [{ label: "Desktop", description: null, preview: null }, { label: "Compact", description: null, preview: null }],
      }] })] : []),
    ] }, busy: working && id === "crew-0", working: null, backgroundTaskCount: 0,
    liveTaskIds: new Set(), compacting: false, apiRetry: null, queuedMessages: [],
  });
  const chat = { onOpenSubagent: noop, onOpenSession: setSelectedId, onOpenSubagentPanel: noop, onOpenPlan: noop,
    onRespondPermission: noop, onAnswerQuestions: (_id: string, _request: string, answers: Record<string, string>) => setAnswer(answers[QUESTION]) };

  const summary = usePinnedSummary("demo", true, true);
  const docked = summary.docks && !panelOpen;
  const card = (
    <PinnedSummary sessionId="demo" project="carbon" cwd="/Users/me/carbon" environment="This Mac"
      branch="main" worktree={null} harness="claude_code" changes={null} changesLoading={false} changesError={null}
      prs={[]} prsLoading={false} prsError={null} subagents={[]} busy liveTaskIds={new Set()} sources={[]}
      crew={<Crew rows={CREW.map((item, i) => ({ item: { ...item, hidden: item.hidden && !shownInSidebar }, busy: working && i === 0, asking: i === 2 && !answer, unread: i === 1 }))}
        open={crewOpen} selectedId={selectedId} paneState={paneState} prFor={() => undefined}
        onToggle={(id) => { const opening = !crewOpen.has(id); setCrewOpen((prev) => { const next = new Set(prev); if (opening) next.add(id); else next.delete(id); return next; }); if (opening) setSelectedId(id); else if (selectedId === id) setSelectedId("demo"); }}
        onFocus={setSelectedId} onOpenInMain={(id) => setSelectedId(`main:${id}`)}
        onShowInSidebar={() => setShownInSidebar(true)} composing={false} active={summary.open} chat={chat} />}
      crewVisible={crewVisible} onCrewVisibleChange={setCrewVisible}
      todos={TODOS}
      context={{ used: BREAKDOWN.usedTokens, max: BREAKDOWN.maxTokens }} open={summary.open} docked={docked}
      onOpen={() => {}} onHide={() => summary.setOpen(false)} />
  );
  return (
    <TooltipProvider>
      <div className="h-screen w-screen overflow-hidden bg-surface-frame text-foreground">
        <AppShell
          rail={<div className="w-12" />}
          sidebar={<div className="w-60 p-3 text-xs text-muted-foreground">Sessions sidebar</div>}
          sidebarMode="docked"
          panel={<div className="w-96 p-3 text-xs text-muted-foreground">Right panel</div>}
          panelOpen={panelOpen}
          header={<div className="flex h-(--titlebar-h) items-center justify-end gap-2 px-3">
            <Button size="sm" variant="ghost" onClick={() => setWorking((value) => !value)}>
              {working ? "Finish review" : "Restart review"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPanelOpen((value) => !value)}>
              {panelOpen ? "Close panel" : "Open panel"}
            </Button>
            <PinnedSummaryToggle open={summary.open} onToggle={summary.toggle}
              popover={summary.mode === "popover" ? card : undefined} onOpenChange={summary.setOpen} boundary={summary.canvas} />
          </div>}
          footer={<div className="mx-auto w-full max-w-3xl p-3"><div className="rounded-xl border border-border bg-background p-3 text-xs text-muted-foreground">
            <label htmlFor="crew-demo-composer">Send to: {selectedId}</label>
            <textarea id="crew-demo-composer" aria-label="Message crew member" className="mt-2 w-full resize-none bg-transparent outline-none" rows={2} />
            {answer && <p role="status">Answered: {answer}</p>}
            {shownInSidebar && <p role="status">Release session shown in sidebar</p>}
          </div></div>}
          summaryLayoutRef={summary.ref} summaryDocked={docked}
          summary={summary.mode === "pinned" ? card : null} summaryOpen={summary.open} summaryKey="demo"
        >
          <div className="chat-scroll flex-1 overflow-y-auto py-6 text-sm text-muted-foreground">
            <div className="mx-auto max-w-3xl px-6">
              <p id="mode" data-mode={summary.mode}>With the right panel shut and room beside this column, the summary docks as a rail. An open panel or a tighter window floats it as a card over the transcript, and a narrow one makes it a popover. This column must not move as it opens and closes.</p>
            </div>
          </div>
        </AppShell>
        <DemoThemeBar />
      </div>
    </TooltipProvider>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(<Demo />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
