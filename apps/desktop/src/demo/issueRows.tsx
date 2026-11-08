import React from "react";
import ReactDOM from "react-dom/client";

import IssuePanel from "@/components/IssuePanel";
import IssuesView from "@/components/IssuesView";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type {
  Issue,
  IssueDetail,
  IssueFilters,
  IssueLabel,
  IssueState,
  RelatedIssue,
} from "@/types/events";
import "../App.css";

/// Linear rows dense with labels, a project and a PR, the shape the row's
/// trailing chips are judged on against Linear's own list.

const STARTED: IssueState = { id: "s1", name: "In Progress", kind: "started", color: "#f2c94c" };
const REVIEW: IssueState = { id: "s3", name: "In Review", kind: "started", color: "#5e6ad2" };
const BACKLOG: IssueState = { id: "s2", name: "Backlog", kind: "backlog", color: "#8a8f98" };

const label = (name: string, color: string): IssueLabel => ({ name, color });
const COMMERCIAL = label("Commercial", "#4ea7fc");
const STORY = label("User story", "#8b5cf6");
const GATED = label("Feature gated", "#26b5ce");
const SECURITY = label("Security", "#4ea7fc");
const RELEASE = label("Release gate", "#8b5cf6");
const CORE = label("Core production", "#26b5ce");

function row(
  n: number,
  title: string,
  state: IssueState,
  labels: IssueLabel[],
  extra: Partial<Issue> = {},
): Issue {
  return {
    tracker: "linear",
    id: `uuid-${n}`,
    identifier: `FOR-${n}`,
    title,
    url: `https://linear.app/x/issue/FOR-${n}`,
    state,
    priority: "medium",
    assignee: null,
    author: null,
    labels,
    team: "FOR",
    project: "Forge production readiness",
    createdAt: "2026-10-28T10:00:00Z",
    updatedAt: "2026-10-28T10:00:00Z",
    pullRequests: [],
    issueType: null,
    blockedBy: [],
    blocking: [],
    subIssues: { done: 0, total: 0 }, cycle: null,
    ...extra,
  };
}

const related = (n: number, title: string, state: IssueState, priority: Issue["priority"]): RelatedIssue => ({
  tracker: "linear",
  id: `uuid-${n}`,
  identifier: `FOR-${n}`,
  title,
  url: `https://linear.app/x/issue/FOR-${n}`,
  state,
  priority,
  project: "Forge production readiness",
});
/// Dated off today, so the ring reads part-run whenever the page is opened.
const CURRENT_CYCLE = {
  number: 2,
  name: null,
  startsAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
  endsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
  completedAt: null,
};
const DONE: IssueState = { id: "s4", name: "Done", kind: "completed", color: "#5e6ad2" };
const FOR_70 = related(70, "Rotate encrypted provider credentials without losing access", BACKLOG, "medium");
const FOR_121 = related(121, "Prove multi-user isolation and crash recovery on the release candidate", BACKLOG, "high");
const MANY = [85, 120, 112, 122, 100].map((n) =>
  related(n, `Verify release candidate step ${n} across every supported platform`, BACKLOG, "high"),
);

const ROWS: Issue[] = [
  row(
    155,
    "Start and expire a 14-day workspace trial without payment details",
    STARTED,
    [COMMERCIAL, GATED, STORY],
    {
      blockedBy: [FOR_70],
      blocking: [FOR_121],
      subIssues: { done: 1, total: 3 },
      cycle: CURRENT_CYCLE,
    },
  ),
  row(
    97,
    "Verify signup, email change, account linking and workspace invitations",
    STARTED,
    [SECURITY, CORE, RELEASE],
    {
      cycle: {
        number: 3,
        name: null,
        startsAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 24 * 86_400_000).toISOString(),
        completedAt: null,
      },
    },
  ),
  row(69, "Close cycles and carry unfinished work without duplication", REVIEW, [GATED, STORY], {
    pullRequests: [67],
    assignee: { name: "Matthieu", avatar: null },
  }),
  row(149, "Enforce browser request origins and session trust boundaries", BACKLOG, [SECURITY, CORE], {
    blockedBy: [...MANY, related(9, "Already shipped, so not counted on the row", DONE, "low")],
  }),
  row(124, "Verify production behavior and resolve launch regressions", BACKLOG, [], {
    project: null,
  }),
];

const FILTERS: IssueFilters = {
  teams: [{ id: "team-1", name: "Forge" }],
  projects: [{ id: "proj-1", name: "Forge production readiness" }],
  labels: [COMMERCIAL, STORY, GATED, SECURITY, RELEASE, CORE],
  issueTypes: [],
  teamStates: {},
};

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (outer: string, outerArgs: Record<string, unknown>) => {
    // Core commands arrive wrapped for the local server; unwrap to answer them.
    const wrapped = outer === "server_invoke";
    const cmd = wrapped ? (outerArgs.cmd as string) : outer;
    const args = (wrapped ? outerArgs.args : outerArgs) as Record<string, unknown>;
    if (cmd === "list_issues") {
      const query = args.query as { tracker: string; settled: boolean };
      return query.settled || query.tracker !== "linear" ? [] : ROWS;
    }
    if (cmd === "list_issue_filters") return FILTERS;
    if (cmd === "get_integrations") return { linear: null, github: null };
    if (cmd === "plugin:opener|open_url") return null;
    throw new Error(`demo: nothing stubbed for ${cmd}`);
  },
};

/// The first row opened, so the pane's Blocked by / Blocking lists show —
/// a settled blocker included, which the row's count leaves out.
const OPENED: IssueDetail = {
  ...ROWS[0],
  blockedBy: [...ROWS[0].blockedBy, related(9, "Already shipped, listed here but not counted", DONE, "low")],
  description: "Trial starts on signup and expires after 14 days without asking for a card.",
  comments: [],
  states: [],
};

function Demo() {
  return (
    <TooltipProvider>
      <div className="flex h-full flex-col bg-background">
        <DemoThemeBar />
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
          <IssuesView
            active
            connected={{ linear: true, github: false }}
            connecting={false}
            connectError={null}
            onConnect={async () => true}
            onRecheckGithub={async () => {}}
            picked={null}
            onPick={() => {}}
            onWorkOn={() => {}}
          />
          </div>
          <div className="flex w-96 shrink-0 flex-col border-l border-border">
            <IssuePanel
              sessionId={null}
              issues={[OPENED]}
              details={{ [OPENED.identifier]: OPENED }}
              loading={false}
              unavailable={null}
              onUnlink={() => {}}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Demo />
  </React.StrictMode>,
);
