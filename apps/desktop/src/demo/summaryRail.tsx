import { useState } from "react";
import ReactDOM from "react-dom/client";
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

function Demo() {
  const [panelOpen, setPanelOpen] = useState(false);
  const summary = usePinnedSummary("demo", true, true);
  const docked = summary.docks && !panelOpen;
  const card = (
    <PinnedSummary sessionId="demo" project="carbon" cwd="/Users/me/carbon" environment="This Mac"
      branch="main" worktree={null} harness="claude_code" changes={null} changesLoading={false} changesError={null}
      prs={[]} prsLoading={false} prsError={null} subagents={[]} busy={false} liveTaskIds={new Set()} sources={[]}
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
            <Button size="sm" variant="ghost" onClick={() => setPanelOpen((value) => !value)}>
              {panelOpen ? "Close panel" : "Open panel"}
            </Button>
            <PinnedSummaryToggle open={summary.open} onToggle={summary.toggle}
              popover={summary.mode === "popover" ? card : undefined} onOpenChange={summary.setOpen} boundary={summary.canvas} />
          </div>}
          footer={<div className="mx-auto w-full max-w-3xl p-3"><div className="h-20 rounded-xl border border-border bg-background" /></div>}
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

ReactDOM.createRoot(document.getElementById("root")!).render(<Demo />);
