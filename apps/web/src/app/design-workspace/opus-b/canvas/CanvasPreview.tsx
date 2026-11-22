"use client";

import { cx } from "@/components/app/Window";
import { DesignPreview, PIN } from "../_shared/DesignPreview";
import { BASE, click, type, useScene, type Message, type Step } from "../_shared/scene";

const COMMENT = "Make it full width, clear of the home bar.";
const SENT: Message = { from: "user", text: COMMENT, x: PIN[0], y: PIN[1] };
const REPLY =
  "The button sits on the home indicator in your snapshot. Making it full width with a 34px bottom inset in OnboardingScreen.tsx.";

/// Circle the button with the pen, pin a comment on it, send it, and watch it
/// land in Canvas chat as a snapshot the agent answers.
const STEPS: Step[] = [
  { hold: 1100, set: { target: null, panel: "chat" } },
  ...click("tool-Pen", { tool: "Pen" }),
  { hold: 1400, set: { ink: 1, target: null } },
  ...click("tool-Comment", { tool: "Comment" }),
  ...click("pin-spot", { pin: PIN, commentOpen: true, commentText: "" }),
  ...type(COMMENT, "commentText", 42),
  ...click("comment-send", { commentOpen: false, messages: [SENT] }, 500),
  { hold: 1000, set: { target: null } },
  { hold: 700, set: { messages: [SENT, { from: "agent", text: "Reading the snapshot…" }] } },
  { hold: 3800, set: { messages: [SENT, { from: "agent", text: REPLY }] } },
];

const STAGES = [
  ["01", "Pen", "Circle what's wrong"],
  ["02", "Comment", "Pin a note on it"],
  ["03", "Send", "Carbon takes the snapshot"],
  ["04", "Canvas chat", "The agent reads the picture"],
] as const;

export function CanvasPreview({ windowOnly = false }: { windowOnly?: boolean }) {
  const ctl = useScene(BASE, STEPS);
  if (windowOnly) return <DesignPreview ctl={ctl} compactPanel="chat" hero />;

  const { state } = ctl;
  const stage = state.messages.length ? 3 : state.commentOpen || state.pin ? (state.commentText ? 2 : 1) : state.tool === "Pen" || state.ink ? 0 : -1;
  return (
    <>
      <DesignPreview ctl={ctl} story="Pen, pin, send: the snapshot lands in Canvas chat" compactPanel="chat" />
      <ol className="mt-10 grid border border-[#FFFFFF26] max-lg:divide-y lg:grid-cols-4 lg:divide-x divide-[#FFFFFF26] light:divide-black/10 light:border-black/10">
        {STAGES.map(([n, name, body], i) => (
          <li key={n} className={cx("flex flex-col gap-1.5 p-5 transition-colors duration-300", i <= stage ? "bg-[#FFFFFF1A] light:bg-[#F4F4F5]" : "")}>
            <span className="font-mono text-[11px] leading-[14px] tracking-[0.06em] text-[#8A8A8A] uppercase light:text-[#6B6B6B]">
              {n} · {name}
            </span>
            <span className={cx("text-[15px] leading-[22px] transition-colors duration-300", i <= stage ? "text-white light:text-[#0A0A0A]" : "text-[#8A8A8A] light:text-[#6B6B6B]")}>{body}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
