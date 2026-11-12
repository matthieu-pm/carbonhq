import { describe, expect, it } from "vitest";
import { renderAvatarSvg, validateAvatar } from "open-bot-avatar";

import { BOT_AVATARS, botAvatar, streamsSubagent } from "@/lib/botAvatars";
import { buildTranscript } from "@/lib/transcript";
import type { AgentEvent } from "@/types/events";

describe("bot avatars", () => {
  it("ships 32 distinct, valid silhouettes and colors that render in every mood", () => {
    expect(BOT_AVATARS).toHaveLength(32);
    expect(new Set(BOT_AVATARS.map(({ definition }) => definition.id)).size).toBe(32);
    expect(new Set(BOT_AVATARS.map(({ definition }) => definition.body.path)).size).toBe(32);
    expect(new Set(BOT_AVATARS.map(({ color }) => color)).size).toBe(32);
    for (const { definition, color } of BOT_AVATARS) {
      expect(validateAvatar(definition), definition.id).toMatchObject({ ok: true });
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
      for (const motion of ["idle", "thinking", "happy"] as const) {
        const svg = renderAvatarSvg(definition, { color, motion, time: 2, size: 24 });
        expect(svg, `${definition.id}: ${motion}`).toContain("<svg");
        expect(svg).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it("keeps the streamed call's identity through lifecycle ids, completion and replay", () => {
    const callId = "toolu_01AvatarRegression";
    const payload = { type: "tool_call_started", callId, name: "Agent", toolType: "subagent_spawn",
      title: null, input: { description: "Review layout" }, rawInput: null };
    const spawn = { id: "e1", sessionId: "s", harness: "claude_code", seq: 1,
      ts: "2026-11-13T00:00:00Z", turnId: null, subagent: null, raw: null, payload } as AgentEvent;
    const started = { ...spawn, id: "e2", seq: 2, subagent: { id: callId, label: "Reviewer" },
      payload: { type: "subagent_started", agentId: "harness-task-123", description: "Review layout" } } as AgentEvent;
    const finished = { ...started, id: "e3", seq: 3,
      payload: { type: "subagent_completed", agentId: "harness-task-123", summary: "Done", usage: null } } as AgentEvent;
    const preview = botAvatar(callId);
    for (const events of [[spawn, started], [spawn, started, finished]]) {
      const run = buildTranscript(JSON.parse(JSON.stringify(events)), true).subagents[0];
      expect(botAvatar(run.id)).toBe(preview);
      expect(run.id).not.toBe(run.taskId);
    }
    expect(botAvatar("crew-session-123").definition.id).toBe("chat");
    expect(botAvatar(callId).definition.id).toBe("bell");
    expect(botAvatar("019ab23d-058b-7b06-a8ec-123456789abc").definition.id).toBe("barbell");
  });

  it("exposes only the two eyes as SVG rectangles for the working scan", () => {
    for (const { definition, color } of BOT_AVATARS) {
      const svg = renderAvatarSvg(definition, { color, motion: "idle", reducedMotion: true });
      expect(svg.match(/<rect\b/g), definition.id).toHaveLength(2);
      expect(svg, definition.id).toContain("<use ");
    }
  });

  it("recognizes spawn previews across harnesses without decorating other task tools", () => {
    for (const name of ["Task", "Agent", "spawn_agent", "spawn_subagent", "subagent"]) {
      expect(streamsSubagent(name), name).toBe(true);
    }
    for (const name of ["TaskOutput", "TodoWrite", "stop_task", "get_command_or_subagent_output", "Bash"]) {
      expect(streamsSubagent(name), name).toBe(false);
    }
  });
});
