import { useState } from "react";
import ReactDOM from "react-dom/client";
import UserMessage from "@/components/chat/UserMessage";
import { SentMessageEditorProvider } from "@/components/chat/SentMessageEditor";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import { activeMessageEvents } from "@/lib/messageEdit";
import type { AgentEvent } from "@/types/events";
import "../App.css";

let scenario = "Completed";
let replay: (text: string) => void = () => {};
function event(id: string, seq: number, text: string): AgentEvent {
  return { id, seq, sessionId: "edit-demo", harness: "codex", ts: new Date().toISOString(), turnId: null, subagent: null,
    payload: { type: "user_message", text, baseline: "tree", queued: false, from: null, cwd: null, images: [], issues: [] } };
}
Object.assign(window, { __TAURI_INTERNALS__: {
  invoke: async (command: string, args: {cmd?: string; args?: {prompt: string}; prompt?: string}) => {
    const cmd = command === "server_invoke" ? args.cmd : command;
    if (cmd === "message_edit_eligibility") return {
      allowed: scenario !== "Tool effects" && scenario !== "Unsupported",
      reason: scenario === "Tool effects" ? "This turn ran tools or has effects Carbon cannot fully undo. Editing is blocked; your original message is unchanged."
        : scenario === "Unsupported" ? "This agent does not have a verified turn-replacement path in Carbon yet. Your original message is unchanged." : null,
    };
    if (cmd === "edit_sent_message") {
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (scenario === "Failed replay") throw new Error("The agent refused the rewind.");
      replay((args.args ?? args).prompt!);
    }
    return null;
  },
} });

function Demo() {
  const [pick, setPick] = useState(scenario);
  const [events, setEvents] = useState([event("original",0,"Write a short welcome message for Carbon.")]);
  replay = (text) => setEvents((current) => [...current, event("replacement",1,text), {
    ...event("marker",2,""), payload: {type:"turn_replayed",promptEventId:"original",replacementEventId:"replacement"},
  }]);
  const active = activeMessageEvents(events);
  return <TooltipProvider><main className="min-h-screen bg-background p-10 text-foreground">
    <h1 className="text-lg font-medium">Edit sent message</h1>
    <div className="my-6 flex flex-wrap gap-2">{["Completed","Running","Tool effects","Unsupported","Failed replay"].map((name) =>
      <Button key={name} variant={name===pick?"secondary":"ghost"} onClick={() => {scenario=name;setPick(name);setEvents([event("original",0,"Write a short welcome message for Carbon.")]);}}>{name}</Button>)}</div>
    <SentMessageEditorProvider key={pick} session={{sessionId:"edit-demo",events}} busy={pick==="Running"}>
      <div className="max-w-xl rounded-xl border border-border p-6">
        {active.map((e) => e.payload.type==="user_message" ? <UserMessage key={e.id} eventId={e.id} text={e.payload.text} ts={e.ts}/> : null)}
        <p className="mt-6 text-chat text-muted-foreground">{events.length>1 ? "Response to the revised prompt." : pick==="Running"?"The agent is working…":"Welcome to Carbon."}</p>
      </div>
    </SentMessageEditorProvider>
    <DemoThemeBar />
  </main></TooltipProvider>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(<Demo/>);
