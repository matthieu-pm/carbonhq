import { useState } from "react";
import ReactDOM from "react-dom/client";

import Rail from "@/components/layout/Rail";
import { SettingsButton } from "@/components/Sidebar";
import SubscriptionUsageButton from "@/components/SubscriptionUsageButton";
import UpdateRailButton from "@/components/UpdateRailButton";
import UpdateRow from "@/components/UpdateRow";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import { type ManualCheck, updateFailure } from "@/hooks/useUpdater";
import type { UpdateStatus } from "@/types/events";
import "../App.css";

Object.assign(window, { __TAURI_INTERNALS__: {
  invoke: async (command: string, args?: { cmd?: string }) =>
    (command === "server_invoke" ? args?.cmd : command) === "subscription_usage" ? [] : null,
} });

type Scenario = { name: string; status: UpdateStatus | null; blocked?: boolean; manual?: ManualCheck };

const SCENARIOS: Scenario[] = [
  { name: "No update", status: null },
  { name: "Found, size unknown", status: { state: "downloading", version: "0.32.0", percent: null } },
  { name: "Downloading 40%", status: { state: "downloading", version: "0.32.0", percent: 40 } },
  { name: "Ready", status: { state: "ready", version: "0.32.0", notes: null } },
  { name: "Ready, turn running", status: { state: "ready", version: "0.32.0", notes: null }, blocked: true },
  { name: "Install failed", status: { state: "ready", version: "0.32.0", notes: null }, manual: "install_failed" },
];

function Demo() {
  const [pick, setPick] = useState(0);
  const [installs, setInstalls] = useState(0);
  const s = SCENARIOS[pick];
  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background p-10 text-foreground">
        <h1 className="text-lg font-medium">Update button in the rail</h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">
          The rail's foot in each update state, with the sidebar row beside it. Hover the blue button for its tooltip.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {SCENARIOS.map((x, i) => (
            <Button key={x.name} size="sm" variant={i === pick ? "secondary" : "ghost"} onClick={() => setPick(i)}>{x.name}</Button>
          ))}
        </div>
        <div className="mt-8 flex h-96 overflow-hidden rounded-xl border border-border bg-surface-frame">
          <Rail
            place="home"
            spaces
            onHome={() => {}}
            onSpaces={() => {}}
            onIssues={() => {}}
            onHomeHover={() => {}}
            peeks={false}
            footer={
              <>
                <UpdateRailButton status={s.status} blocked={!!s.blocked} failure={updateFailure(s.manual ?? "idle")} onInstall={() => setInstalls((n) => n + 1)} />
                <SubscriptionUsageButton onAccounts={() => {}} />
                <SettingsButton onOpen={() => {}} />
              </>
            }
          />
          <aside className="flex w-64 flex-col border-l border-hairline">
            <div className="flex-1" />
            <UpdateRow status={s.status} manual={s.manual ?? "idle"} />
          </aside>
        </div>
        <p role="status" className="mt-4 text-sm text-muted-foreground">Install pressed {installs} times</p>
        <DemoThemeBar />
      </main>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Demo />);
