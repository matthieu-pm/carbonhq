import React, { useState } from "react";
import ReactDOM from "react-dom/client";

import PermissionSelector from "@/components/composer/PermissionSelector";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type { ApprovalPolicy, Harness } from "@/types/events";
import "../App.css";

/// The composer's permission picker with each stance held, so every icon and
/// Bypass's red can be read on the trigger at once. The last row is live.
const STANCES: ApprovalPolicy[] = ["auto", "plan", "manual", "bypassPermissions"];

function Row({ harness, initial }: { harness: Harness; initial: ApprovalPolicy }) {
  const [value, setValue] = useState<ApprovalPolicy>(initial);
  return (
    <div className="flex h-10 w-fit items-center rounded-2xl border bg-(--surface-card) px-2">
      <PermissionSelector harness={harness} value={value} onChange={setValue} />
    </div>
  );
}

function Demo() {
  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col gap-6 p-8">
        <DemoThemeBar />
        <div className="flex flex-wrap gap-3">
          {STANCES.map((s) => (
            <Row key={s} harness="claude_code" initial={s} />
          ))}
        </div>
        <Row harness="claude_code" initial="auto" />
      </div>
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Demo />
  </React.StrictMode>,
);
