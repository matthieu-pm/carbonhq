"use client";

import { useState } from "react";
import { ArrowUp, CircleDot, CodeXml, GitBranch, Plus } from "lucide-react";
import { ProfileSwitcher } from "@/components/app/ProfileSwitcher";
import { Fit } from "../_components/Fit";
import { BoardShot, Editor, Shot, WorkspaceSwitch, cx } from "../_components/kit";
import m from "../_components/motion.module.css";

type Workspace = "Coding" | "Design";

const SESSIONS = [
  { title: "Fix checkout layout", busy: true, on: true },
  { title: "Retry failed uploads", busy: true },
  { title: "Empty state copy" },
  { title: "Bump Next to 16.4" },
];

/// The Coding workspace as the switch leaves it: sessions on the left, a chat in the middle.
function CodingShot({ width, height }: { width: number; height: number }) {
  const compact = width < 600;
  return (
    <Shot label="Carbon's Coding workspace: a list of agent sessions and a conversation fixing the checkout layout." style={{ width, height }}>
      <div className="flex h-10 shrink-0 items-center gap-3">
        <span className="flex shrink-0 gap-2 pl-4">
          <i className="size-3 rounded-full bg-[#FF5F57]" />
          <i className="size-3 rounded-full bg-[#FEBC2E]" />
          <i className="size-3 rounded-full bg-[#28C840]" />
        </span>
        <div className={compact ? "" : "ml-[90px]"}><WorkspaceSwitch value="Coding" /></div>
        <span className="flex h-7 items-center gap-1.5 rounded-md bg-surface-thumb px-2.5">Fix checkout layout</span>
        {!compact && <span className="ml-auto mr-3 flex items-center gap-1.5 text-muted-foreground"><GitBranch className="size-3.5" />worktree-fix-checkout</span>}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={cx("flex w-[236px] shrink-0 flex-col gap-0.5 px-1.5 pt-2", compact && "hidden")}>
          <span className="flex h-8 items-center gap-2 rounded-md px-2 text-muted-foreground"><Plus className="size-3.5" />New task</span>
          <span className="mt-3 px-2 pb-1 text-[11px] text-muted-foreground">storefront</span>
          {SESSIONS.map((s) => (
            <span key={s.title} className={cx("flex h-8 items-center gap-2 rounded-md px-2", s.on ? "bg-surface-thumb" : "text-foreground/85")}>
              <CircleDot className={cx("size-3", s.busy ? "text-accent-command" : "text-muted-foreground/50")} />
              {s.title}
            </span>
          ))}
          <ProfileSwitcher />
        </div>
        <div className={cx("app-sheet flex min-w-0 flex-1 flex-col border-t border-edge-surface", !compact && "rounded-tl-[10px] border-l")}>
          <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-4 px-5 pt-8">
            <div className="ml-auto max-w-[80%] rounded-xl bg-card px-3.5 py-2.5 text-chat text-card-foreground">
              The pay button falls under the fold on small phones. Keep it visible.
            </div>
            <div className="flex flex-col gap-1.5 text-tool text-muted-foreground">
              <span className="flex items-center gap-1.5"><CodeXml className="size-3.5" />Read CheckoutSheet.tsx</span>
              <span className="flex items-center gap-1.5"><CodeXml className="size-3.5" />Edit CheckoutSheet.tsx <span className="text-accent-add">+14</span> <span className="text-destructive">−6</span></span>
            </div>
            <p className="text-chat leading-[1.65] text-foreground/90">
              The sheet used a fixed height, so the button scrolled away. I moved it into a sticky footer with safe-area padding and checked it at 360 and 393 points wide.
            </p>
          </div>
          <div className="mx-auto mb-4 flex h-12 w-[calc(100%-2rem)] max-w-[640px] items-center justify-between rounded-2xl bg-composer px-4 text-muted-foreground">
            Ask for a follow-up…
            <span className="flex size-7 items-center justify-center rounded-full bg-foreground/10"><ArrowUp className="size-4" /></span>
          </div>
        </div>
      </div>
    </Shot>
  );
}

/// The hero's switch is real: flipping it swaps the drawing under it, as the titlebar's does.
export function SwitchHero() {
  const [ws, setWs] = useState<Workspace>("Design");
  const layer = () => cx(m.swap, "col-start-1 row-start-1");

  return (
    <div className="flex flex-col items-center gap-8">
      <WorkspaceSwitch value={ws} onPick={setWs} size="lg" />
      <div className="grid w-full max-sm:hidden">
        <div className={layer()} data-hidden={ws !== "Coding" || undefined} aria-hidden={ws !== "Coding"}>
          <Fit width={1120} height={700}><CodingShot width={1120} height={700} /></Fit>
        </div>
        <div className={layer()} data-hidden={ws !== "Design" || undefined} aria-hidden={ws !== "Design"}>
          <Fit width={1120} height={700}><Editor /></Fit>
        </div>
      </div>
      <div className="grid w-full sm:hidden">
        <div className={layer()} data-hidden={ws !== "Coding" || undefined} aria-hidden={ws !== "Coding"}>
          <Fit width={400} height={620}><CodingShot width={400} height={620} /></Fit>
        </div>
        <div className={layer()} data-hidden={ws !== "Design" || undefined} aria-hidden={ws !== "Design"}>
          <Fit width={400} height={620}><BoardShot /></Fit>
        </div>
      </div>
    </div>
  );
}
