import type { AvatarDefinition } from "open-bot-avatar";

import definitions from "@/lib/botAvatarDefinitions.json";

const COLORS = [
  "#f5a800", "#8b5cf6", "#f97316", "#a3bc14", "#159de0", "#14b875", "#e83f91", "#c78925",
  "#a64ce6", "#e5b500", "#ef4d4d", "#c342cf", "#05a5b2", "#ed7020", "#4285ed", "#a39616",
  "#dc3479", "#d69c00", "#40a944", "#f58a0b", "#287edb", "#9253dc", "#00ac88", "#db45b3",
  "#e8a317", "#008fbf", "#775be8", "#13a65e", "#f2bd00", "#d66b29", "#8fb91c", "#eb5140",
];

// Keep this size and order: persisted ids must keep their character across releases.
export const BOT_AVATARS: ReadonlyArray<{ definition: AvatarDefinition; color: string }> = definitions.map((definition, index) => ({
  definition: definition as AvatarDefinition,
  color: COLORS[index],
}));

/// The spawning call id or crew session id survives streaming, retitles and reloads.
export function botAvatar(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  }
  return BOT_AVATARS[(hash >>> 0) % BOT_AVATARS.length];
}

/// Streaming has a tool name before the normalized tool type has arrived.
export function streamsSubagent(name: string) {
  return /^(?:Task|Agent|spawn_agent|spawn_subagent|subagent)$/.test(name);
}
