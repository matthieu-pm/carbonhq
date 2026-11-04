import { useState } from "react";
import { createRoot } from "react-dom/client";

import AssistantMessage from "@/components/chat/AssistantMessage";
import MessageActions from "@/components/chat/MessageActions";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import "streamdown/styles.css";
import "../App.css";

const RESPONSE = "## Result\n\nKeep **Markdown**, `inline code`, and line breaks.\n\n```ts\nconst greeting = \"Hello, Carbon 👋\";\nconsole.log(greeting);\n```\n\n- First item\n- Second item\n\nTrailing paragraph.\n";
const SECOND = "A separate response.\n\nOnly this response should be copied.";
let failNext = false;
const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);

// Fail before touching the system clipboard, so the error can be checked
// without changing browser permissions for the next successful attempt.
navigator.clipboard.writeText = async (text) => {
  if (failNext) {
    failNext = false;
    throw new DOMException("Demo clipboard failure", "NotAllowedError");
  }
  await writeText(text);
};

function Demo() {
  const [streaming, setStreaming] = useState(true);
  return (
    <TooltipProvider>
      <main className="mx-auto flex max-w-3xl flex-col gap-8 p-8 pb-48">
        <DemoThemeBar />
        <h1 className="text-lg font-semibold">Copy a response</h1>
        <p className="text-ui text-muted-foreground">
          Hover a response or Tab to its copy button. Paste below to check the source text.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { failNext = true; }}>
            Fail next copy
          </Button>
          <Button variant="outline" onClick={() => setStreaming((value) => !value)}>
            {streaming ? "Finish streaming" : "Resume streaming"}
          </Button>
        </div>
        <section aria-label="First response"><AssistantMessage text={RESPONSE} /></section>
        <p className="text-ui text-muted-foreground">Tool output: this must never be copied.</p>
        <section aria-label="Second response"><AssistantMessage text={SECOND} /></section>
        <section aria-label="Streaming response">
          <AssistantMessage text="Text still arriving…" streaming={streaming} />
        </section>
        <section aria-label="Empty response"><AssistantMessage text="   " /></section>
        <div className="group/message flex flex-col items-end gap-1.5">
          <p>User message</p>
          <MessageActions text="User message" ts="2026-11-04T12:00:00Z" />
        </div>
        <label className="flex flex-col gap-2 text-ui">
          Clipboard paste check
          <textarea rows={10} className="w-full rounded-lg border border-border p-3 font-mono" />
        </label>
      </main>
    </TooltipProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Demo />);
