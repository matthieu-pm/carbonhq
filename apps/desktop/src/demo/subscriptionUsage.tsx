import { useState } from "react";
import ReactDOM from "react-dom/client";
import SubscriptionUsageButton from "@/components/SubscriptionUsageButton";
import { SettingsButton } from "@/components/Sidebar";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type { SubscriptionUsage } from "@/types/events";
import "../App.css";

let scenario = "Live example";
function snapshot(): SubscriptionUsage[] {
  return ([
    ["codex", "Pro", [94]], ["claude_code", "Pro", [68, 90]], ["grok", "SuperGrok Plus", [58]],
  ] as const).map(([harness, plan, values], i) => ({
    harness, plan, checkedAt: new Date(Date.now() - (scenario === "Stale" ? 180_000 : 0)).toISOString(),
    unavailableReason: scenario === "Unavailable" || (scenario === "Partial" && i === 2) ? "Not signed in. Connect your subscription in Accounts." : null,
    windows: scenario === "Unavailable" || (scenario === "Partial" && i === 2) ? [] : values.map((value, j) => ({
      label: values.length === 2 && j === 0 ? "5 hours" : "Weekly",
      remainingPercent: scenario === "Empty" ? 0 : scenario === "Full" ? 100 : scenario === "Low" ? 8 : value,
      resetsAt: new Date(Date.now() + (j === 0 && values.length === 2 ? 3 * 3_600_000 : 2 * 86_400_000)).toISOString(),
    })),
  }));
}

Object.assign(window, { __TAURI_INTERNALS__: {
  invoke: async (command: string, args?: { cmd?: string }) => {
    const cmd = command === "server_invoke" ? args?.cmd : command;
    if (cmd !== "subscription_usage") return null;
    await new Promise((resolve) => setTimeout(resolve, scenario === "Loading" ? 4_000 : 200));
    if (scenario === "Error") throw new Error("Connection lost");
    return snapshot();
  },
} });

function Demo() {
  const [pick, setPick] = useState(scenario);
  const [accounts, setAccounts] = useState(false);
  return (
    <TooltipProvider>
      <main className="min-h-screen bg-background p-10 text-foreground">
        <h1 className="text-lg font-medium">Subscription usage</h1>
        <p className="mt-2 max-w-lg text-sm text-muted-foreground">Open the circle beside Settings. Try each state, keyboard navigation, and the themes below.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {["Live example", "Full", "Empty", "Low", "Partial", "Unavailable", "Loading", "Stale", "Error"].map((name) => (
            <Button key={name} size="sm" variant={name === pick ? "secondary" : "ghost"} onClick={() => { scenario = name; setPick(name); setAccounts(false); }}>{name}</Button>
          ))}
        </div>
        <div className="mt-8 flex h-12 w-64 items-center justify-end gap-1 rounded-xl border border-border bg-card px-3">
          <SubscriptionUsageButton key={pick} onAccounts={() => setAccounts(true)} />
          <SettingsButton onOpen={() => setAccounts(true)} />
        </div>
        {accounts && <p role="status" className="mt-4 text-sm">Accounts opened</p>}
        <DemoThemeBar />
      </main>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Demo />);
