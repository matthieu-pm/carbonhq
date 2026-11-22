import { ClaudeGlyph } from "@/components/ClaudeGlyph";
import { OpenAIGlyph } from "@/components/OpenAIGlyph";
import { PiGlyph } from "@/components/PiGlyph";
import h from "./hero.module.css";

export function AgentMarks() {
  return (
    <span className={h.agentMarks} aria-hidden="true">
      <span><OpenAIGlyph className="size-3" /></span>
      <span><PiGlyph className="size-3" /></span>
      <span><ClaudeGlyph className="size-3" /></span>
    </span>
  );
}
