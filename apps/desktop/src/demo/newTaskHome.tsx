import { useState } from "react";
import ReactDOM from "react-dom/client";

import ChatInput from "@/components/ChatInput";
import ComposerToolbar from "@/components/composer/ComposerToolbar";
import HomeCards from "@/components/home/HomeCards";
import AppShell from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type {
  ApprovalPolicy,
  Effort,
  Harness,
  Model,
  PrMark,
  Project,
  SessionIndexItem,
  SessionStatus,
  SubscriptionUsage,
} from "@/types/events";
import "../App.css";

/// The new-task home (CBN-47): the real shell, composer, toolbar and cards over
/// a faked session index, PR marks and subscription usage. **Sidebar** narrows
/// the column, which is what the cards' container query answers to, and
/// **Sessions** switches between a busy index, a thin one and none — the last
/// being a first run, where the cards are not drawn at all.

const DAY = 86_400_000;
const now = Date.now();

const PROJECTS: Project[] = ["carbon", "atrium", "forge"].map((name) => ({
  path: `/Users/you/code/${name}`,
  name,
  space: null,
})) as Project[];

const TITLES = [
  "Redesign the new task page as a home",
  "Fix the transcript's scrollbar under the summary rail",
  "Let a project be filed into a profile",
  "Show the agent's task list in the pinned summary",
  "Organize Page document controls and add outline navigation",
  "Stop a stale server restarting in a loop",
  "Measure the PR panel query's GraphQL cost",
];

/// A deterministic spread, so a screenshot today matches one tomorrow.
function fakeSessions(count: number): SessionIndexItem[] {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, (_, i) => {
    // Squared, so recent weeks are busier than old ones, as a real index is.
    const age = Math.floor(random() ** 2 * 170) * DAY + Math.floor(random() * DAY * 0.5);
    const created = new Date(now - (i < 6 ? i * 0.4 * DAY : age)).toISOString();
    const project = PROJECTS[Math.floor(random() * PROJECTS.length)];
    return {
      sessionId: `demo-${i}`,
      harness: "claude_code",
      cwd: project.path,
      projectPath: project.path,
      branch: i < 6 ? `feature-${i}` : "main",
      worktreeName: null,
      worktreeRemoved: false,
      title: TITLES[i % TITLES.length],
      status: "idle",
      created,
      modified: new Date(Date.parse(created) + 3_600_000 * (i % 5)).toISOString(),
      archived: i > 12,
      pinned: false,
      hidden: false,
      aside: false,
    } as unknown as SessionIndexItem;
  });
}

const mark = (number: number, branch: string, over: Partial<PrMark> = {}): PrMark => ({
  number,
  headRefName: branch,
  isDraft: false,
  state: "OPEN",
  checksState: "CLEAR",
  mergeable: null,
  mergeStateStatus: null,
  ...over,
});

const MARKS: Record<string, PrMark> = {
  "feature-0": mark(512, "feature-0", { checksState: "RUNNING" }),
  "feature-1": mark(509, "feature-1", { checksState: "FAILING" }),
  "feature-2": mark(507, "feature-2", { isDraft: true }),
  "feature-3": mark(501, "feature-3", { state: "MERGED" }),
  "feature-4": mark(498, "feature-4", { state: "MERGED" }),
};

const STATUS: Record<string, SessionStatus> = { "demo-0": "in_progress", "demo-1": "completed" };
const ASKING = new Set(["demo-2"]);

const USAGE: SubscriptionUsage[] = [
  {
    harness: "claude_code",
    plan: "max",
    windows: [
      { label: "5-hour", remainingPercent: 64, resetsAt: new Date(now + 2.2 * 3_600_000).toISOString() },
      { label: "Weekly", remainingPercent: 81, resetsAt: new Date(now + 4 * DAY).toISOString() },
    ],
    checkedAt: new Date().toISOString(),
    unavailableReason: null,
  },
  {
    harness: "codex",
    plan: "pro",
    windows: [{ label: "Weekly", remainingPercent: 22, resetsAt: new Date(now + 2 * DAY).toISOString() }],
    checkedAt: new Date().toISOString(),
    unavailableReason: null,
  },
];

/// Stubbed here, so nothing in `src/` carries a demo seam.
Object.assign(window, {
  __TAURI_INTERNALS__: {
    transformCallback: () => 0,
    invoke: async (command: string, args?: { cmd?: string }) => {
      const cmd = command === "server_invoke" ? args?.cmd : command;
      if (cmd === "subscription_usage")
        return USAGE.map((row) => ({ ...row, checkedAt: new Date().toISOString() }));
      if (cmd === "agent_availability")
        return (["claude_code", "codex", "pi", "fx", "grok"] as Harness[]).map((harness) => ({
          harness,
          available: true,
          label: harness,
          reason: "",
        }));
      if (cmd === "plugin:event|listen") return 0;
      if (cmd === "search_files" || cmd === "check_agent_updates" || cmd === "list_servers") return [];
      return null;
    },
  },
});

const MODELS = [
  { id: "fable", label: "Fable 5.2", efforts: ["low", "medium", "high"], defaultEffort: "medium" },
  { id: "opus", label: "Opus 5.5", efforts: ["low", "medium", "high"], defaultEffort: "medium" },
].map((model) => ({
  ...model,
  arg: model.id,
  provider: "anthropic",
  acceptsImages: true,
  secondary: false,
})) as unknown as Model[];

const COUNTS = { busy: 140, thin: 5, none: 0 } as const;

function Demo() {
  const [sidebar, setSidebar] = useState(true);
  const [fill, setFill] = useState<keyof typeof COUNTS>("busy");
  const [sent, setSent] = useState<string | null>(null);
  const [modelId, setModelId] = useState("fable");
  const [effort, setEffort] = useState<Effort | null>("medium");
  const [fast, setFast] = useState(false);
  const [permissionMode, setPermissionMode] = useState<ApprovalPolicy>("auto");
  const [projectPath, setProjectPath] = useState<string | null>(PROJECTS[0].path);
  const [useWorktree, setUseWorktree] = useState(false);
  const [branch, setBranch] = useState("main");
  const [harness, setHarness] = useState<Harness>("claude_code");
  const [sessions] = useState(() => ({
    busy: fakeSessions(COUNTS.busy),
    thin: fakeSessions(COUNTS.thin),
    none: [] as SessionIndexItem[],
  }));
  const list = sessions[fill];

  return (
    <TooltipProvider>
      <div className="h-screen w-screen overflow-hidden bg-surface-frame text-foreground">
        <AppShell
          rail={<div className="w-12" />}
          sidebar={<div className="w-60 p-3 text-xs text-muted-foreground">Sessions sidebar</div>}
          sidebarMode={sidebar ? "docked" : "hidden"}
          centered
          header={
            <div className="flex h-(--titlebar-h) items-center justify-end gap-2 px-3">
              {sent !== null && (
                <span data-testid="sent" className="mr-auto truncate pl-16 text-xs text-muted-foreground">
                  Sent: {sent}
                </span>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSidebar((value) => !value)}>
                {sidebar ? "Hide sidebar" : "Show sidebar"}
              </Button>
              {(Object.keys(COUNTS) as (keyof typeof COUNTS)[]).map((key) => (
                <Button
                  key={key}
                  size="sm"
                  variant={fill === key ? "secondary" : "ghost"}
                  onClick={() => setFill(key)}
                >
                  Sessions: {key}
                </Button>
              ))}
            </div>
          }
          home={
            list.length > 0 && (
              <HomeCards
                sessions={list}
                statusBySession={STATUS}
                asking={ASKING}
                prFor={(_repo, name) => (name ? MARKS[name] : undefined)}
                onOpenSession={(id) => setSent(`open ${id}`)}
              />
            )
          }
          footer={
            <ChatInput
              isNewTask
              onSend={(message) => setSent(message)}
              cwd={projectPath}
              sessions={list}
              draftHint="⌘S to save as draft"
              toolbar={
                <ComposerToolbar
                  server="local"
                  harness={harness}
                  onHarnessChange={setHarness}
                  models={MODELS}
                  modelId={modelId}
                  effort={effort}
                  fast={fast}
                  onFastChange={setFast}
                  fastNote={null}
                  onModelChange={(id, next) => {
                    setModelId(id);
                    setEffort(next);
                  }}
                  onRefreshModels={() => {}}
                  onReloadModels={() => {}}
                  onSeedProvider={() => {}}
                  loadingModels={false}
                  permissionMode={permissionMode}
                  onPermissionModeChange={setPermissionMode}
                  projects={PROJECTS}
                  projectPath={projectPath}
                  onSelectProject={setProjectPath}
                  onAttachProject={() => {}}
                  branches={{ current: branch, branches: ["main", "release", "feature-0"], defaultBase: "origin/main", dirty: 0 }}
                  branch={branch}
                  onSelectBranch={setBranch}
                  onOpenBranches={() => {}}
                  pendingBranch={null}
                  onConfirmBranchSwitch={() => {}}
                  onCancelBranchSwitch={() => {}}
                  useWorktree={useWorktree}
                  onToggleWorktree={() => setUseWorktree((value) => !value)}
                  onAttach={() => {}}
                  onMentionPage={() => {}}
                  contextUsage={null}
                  isNewSession
                  busy={false}
                  modelLast
                />
              }
            />
          }
        >
          {null}
        </AppShell>
        <DemoThemeBar />
      </div>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Demo />);
