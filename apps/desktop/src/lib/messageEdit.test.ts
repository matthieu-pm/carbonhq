import { describe, expect, it } from "vitest";
import { activeMessageEvents } from "@/lib/messageEdit";
import { buildTranscript } from "@/lib/transcript";
import type { AgentEvent } from "@/types/events";

function e(id: string, payload: AgentEvent["payload"]): AgentEvent {
  return {id,payload,sessionId:"s",harness:"codex",seq:0,ts:"2026-11-04T20:00:00Z",turnId:null,subagent:null};
}
function prompt(id: string) { return e(id,{type:"user_message",text:id,baseline:null,images:[],issues:[],mcpServers:[],queued:false,from:null,cwd:null}); }

describe("replayed message history", () => {
  it("removes exactly the superseded turn and leaves prior history and the replacement response", () => {
    const events=[prompt("prior"),prompt("old"),e("old-response",{type:"assistant_text",text:"obsolete",block:null}),prompt("revised"),e("new-response",{type:"assistant_text",text:"current",block:null}),e("marker",{type:"turn_replayed",promptEventId:"old",replacementEventId:"revised"})];
    expect(activeMessageEvents(events).map(e=>e.id)).toEqual(["prior","revised","new-response","marker"]);
    const turns=buildTranscript(events).turns;
    expect(turns.some(turn=>turn.prompt?.id==="old")).toBe(false);
    expect(turns.some(turn=>turn.prompt?.id==="revised")).toBe(true);
  });
  it("does not discard anything when a marker's boundaries are missing or inverted", () => {
    const events=[prompt("p"),e("marker",{type:"turn_replayed",promptEventId:"missing",replacementEventId:"p"})];
    expect(activeMessageEvents(events)).toBe(events);
  });
  it("supports editing the replacement again without restoring an earlier response", () => {
    const events=[prompt("one"),prompt("two"),e("r1",{type:"turn_replayed",promptEventId:"one",replacementEventId:"two"}),prompt("three"),e("r2",{type:"turn_replayed",promptEventId:"two",replacementEventId:"three"})];
    expect(activeMessageEvents(events).map(e=>e.id)).toEqual(["three","r2"]);
  });
});
