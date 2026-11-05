import React, { useState } from "react";
import ReactDOM from "react-dom/client";

import ChatInput from "@/components/ChatInput";
import UserMessage from "@/components/chat/UserMessage";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type { McpMention } from "@/types/events";
import "../App.css";

/// The composer's `$` picker for MCP servers (CBN-8): `$` opens the agent's
/// servers, a pick places a chip, a `$word` naming no server stays prose, and
/// the sent bubble draws the same chips off the names Rust would record.

const SERVERS: McpMention[] = [
  { name: "linear", scope: "user" },
  { name: "plugin:figma:figma", scope: "plugin" },
  { name: "nucleo-icons", scope: "user" },
  { name: "postgres", scope: "project" },
];

/// Stubbed outside the component, so nothing in `src/` carries a demo seam.
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  transformCallback: () => 0,
  invoke: async (cmd: string) => {
    if (cmd === "plugin:event|listen") return 0;
    throw new Error(`demo: nothing stubbed for ${cmd}`);
  },
};

/// What `mcp_mentions::mentioned` answers for the same text, so the bubble
/// draws what a real send would record.
function mentioned(text: string): string[] {
  const names = SERVERS.map((s) => s.name);
  const found = text
    .split(/\s+/)
    .filter((w) => w.startsWith("$"))
    .map((w) => w.slice(1).replace(/[.,;:!?)]+$/, ""))
    .filter((n) => names.includes(n));
  return [...new Set(found)];
}

function Demo() {
  const [sent, setSent] = useState<string | null>(null);

  return (
    <TooltipProvider>
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col justify-end gap-4 p-8 pb-24">
        <p className="text-ui text-muted-foreground">
          Type <code>$</code> to pick an MCP server. <code>$HOME</code> names no server and stays
          prose. Send to see the bubble.
        </p>
        {sent !== null && (
          <>
            <UserMessage text={sent} mcpServers={mentioned(sent)} />
            <pre data-testid="sent" className="text-ui whitespace-pre-wrap text-muted-foreground">
              {JSON.stringify({ text: sent, mcpServers: mentioned(sent) })}
            </pre>
          </>
        )}
        <ChatInput
          onSend={(message) => setSent(message)}
          cwd="/Users/you/code/acme"
          mcpServers={SERVERS}
          sessionId="demo-mcp"
        />
      </div>
      <DemoThemeBar />
    </TooltipProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Demo />
  </React.StrictMode>,
);
