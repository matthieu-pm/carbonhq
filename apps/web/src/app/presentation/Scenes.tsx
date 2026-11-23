"use client";

import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { ClaudeGlyph } from "@/components/ClaudeGlyph";
import { FxGlyph } from "@/components/FxGlyph";
import { GrokGlyph } from "@/components/GrokGlyph";
import { OpenAIGlyph } from "@/components/OpenAIGlyph";
import { PiGlyph } from "@/components/PiGlyph";
import { DesignPreview } from "../design-workspace/opus-b/_shared/DesignPreview";
import { BASE, useScene, type Step } from "../design-workspace/opus-b/_shared/scene";
import styles from "./presentation.module.css";

const agents = [
  { name: "Claude Code", Icon: ClaudeGlyph, models: ["Opus 5.5", "Sonnet"] },
  { name: "Codex", Icon: OpenAIGlyph, models: ["Sol", "Astra"] },
  { name: "Grok Build", Icon: GrokGlyph, models: ["Grok 4.7"] },
  { name: "pi", Icon: PiGlyph, models: ["Use pi’s default"] },
  { name: "fx", Icon: FxGlyph, models: ["Use provider default"] },
] as const;

export function AgentPicker({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [harness, setHarness] = useState(0);
  const [model, setModel] = useState(0);
  const { Icon, models, name } = agents[harness];

  return (
    <div className={styles.picker} data-tour-target="agents" onKeyDown={(event) => {
      if (event.key === "Escape") setOpen(false);
    }}>
      <button className={styles.pickerTrigger} type="button" aria-label={`Agent and model, ${name}`}
        aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon /> {models[model]} <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.pickerPopover} role="group" aria-label="Agent picker">
          <div className={styles.agentTrack} role="group" aria-label="Agents">
            {agents.map(({ name: label, Icon: Mark }, item) => (
              <button key={label} type="button" aria-pressed={item === harness} aria-label={label}
                onClick={() => { setHarness(item); setModel(0); }}>
                <Mark />
              </button>
            ))}
          </div>
          {models.map((label, item) => (
            <button type="button" key={label} className={styles.modelRow} onClick={() => { setModel(item); setOpen(false); }}>
              {label}{item === model && <Check aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const canvasStart = { ...BASE, panel: "chat" } as const;
const noPlayback: Step[] = [];

export function DesignSurface({ onCoding }: { onCoding: () => void }) {
  const canvas = useScene(canvasStart, noPlayback, false);
  return (
    <DesignPreview ctl={canvas} compactPanel="chat" hero desktopOnly
      onWorkspaceChange={(workspace) => { if (workspace === "Coding") onCoding(); }} />
  );
}
