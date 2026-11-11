import { useState } from "react";
import ReactDOM from "react-dom/client";
import PinnedSummary from "@/components/PinnedSummary";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type { ContextBreakdown } from "@/types/events";
import "../App.css";

const FULL: ContextBreakdown = {
  usedTokens: 235_400, maxTokens: 1_000_000,
  categories: [
    ["system_prompt", "System prompt", 12_700, "used"], ["system_tools", "System tools", 15_000, "used"],
    ["mcp_tools", "MCP tools", 18_500, "used"], ["mcp_instructions", "MCP server instructions", 4_600, "used"],
    ["mcp_tools_deferred", "MCP tools (deferred)", 237_700, "deferred"],
    ["system_tools_deferred", "System tools (deferred)", 25_400, "deferred"],
    ["custom_agents", "Custom agents", 2_300, "used"], ["skills", "Skills", 10_000, "used"],
    ["messages", "Messages", 172_400, "used"], ["autocompact_buffer", "Autocompact buffer", 33_000, "buffer"],
    ["free_space", "Free space", 731_600, "free"],
  ].map(([id, name, tokens, kind]) => ({ id, name, tokens, kind }) as ContextBreakdown["categories"][number]),
};
const TIGHT: ContextBreakdown = {
  usedTokens: 181_000, maxTokens: 200_000,
  categories: FULL.categories.filter((c) => c.kind === "used" && c.id !== "messages").concat(
    { id: "messages", name: "Messages", tokens: 117_900, kind: "used" },
    { id: "memory_files", name: "Memory files", tokens: 25_900, kind: "used" },
    { id: "autocompact_buffer", name: "Autocompact buffer", tokens: 13_000, kind: "buffer" },
    { id: "free_space", name: "Free space", tokens: 6_000, kind: "free" },
  ),
};
const SCENARIOS: Record<string, ContextBreakdown | null> = { "Live session": FULL, "Nearly full": TIGHT, "No running child": null };

let scenario = "Live session";
Object.assign(window, { __TAURI_INTERNALS__: {
  invoke: async (command: string, args?: { cmd?: string }) =>
    (command === "server_invoke" ? args?.cmd : command) === "context_breakdown" ? SCENARIOS[scenario] : null,
} });
// Workspace is hidden since its open-in button wants the app list this page does not fake.
localStorage.setItem("ade.pinnedSummaryItems", JSON.stringify({ workspace: false }));

function Demo() {
  const [pick, setPick] = useState(scenario);
  const total = SCENARIOS[pick] ?? FULL;
  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background p-10 text-foreground">
        <h1 className="text-lg font-medium">Context details</h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">The pinned summary's Context window section, with the CLI's breakdown faked. A session with no running child keeps the total alone.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {Object.keys(SCENARIOS).map((name) => (
            <Button key={name} size="sm" variant={name === pick ? "secondary" : "ghost"} onClick={() => { scenario = name; setPick(name); }}>{name}</Button>
          ))}
        </div>
        <div className="mt-8 w-80 rounded-2xl border border-border">
          <PinnedSummary key={pick} sessionId={`demo-${pick}`} project="carbon" cwd="/Users/me/carbon" environment="This Mac"
            branch="main" worktree={null} harness="claude_code" changes={null} changesLoading={false} changesError={null}
            prs={[]} prsLoading={false} prsError={null} subagents={[]} busy={false} liveTaskIds={new Set()} sources={[]}
            context={{ used: total.usedTokens, max: total.maxTokens }} open onOpen={() => {}} onHide={() => {}} />
        </div>
        <DemoThemeBar />
      </main>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Demo />);
