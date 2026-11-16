import type { Harness } from "@/types/events";
import controls from "./harnessControls.json";

export type Control = "model" | "effort" | "stance" | "fast";

/// A pick must reach the next prompt to stay editable during a turn.
/// fx defers to its queued turn; unmeasured ACP agents keep controls locked.
export function lockedMidTurn(harness: Harness, control: Control, busy: boolean): boolean {
  const policy = controls[harness as keyof typeof controls];
  return busy && (!policy || policy.live[control] === "locked");
}
