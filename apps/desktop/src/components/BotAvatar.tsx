import { memo, useEffect, useRef } from "react";
import { mountAvatar, type MountedAvatar } from "open-bot-avatar/dom";

import { botAvatar } from "@/lib/botAvatars";
import { cn } from "@/lib/utils";
import "./BotAvatar.css";

/// One character everywhere, with animation owned by the renderer rather than React.
export default memo(function BotAvatar({ seed, working = false, className }: {
  seed: string;
  working?: boolean;
  className?: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const avatar = useRef<MountedAvatar | null>(null);
  const previous = useRef({ seed, working });
  const turns = useRef(0);
  const { definition, color } = botAvatar(seed);

  useEffect(() => {
    avatar.current = mountAvatar(host.current!, {
      definition, color, label: "", reducedMotion: "system", still: true,
    });
    return () => {
      avatar.current?.destroy();
      avatar.current = null;
    };
  }, [definition, color]);

  useEffect(() => {
    // The former working pose is idle now; working keeps the body still for the eye scan.
    avatar.current?.update({ mood: working ? "idle" : "thinking", still: working });
    if (previous.current.seed === seed && previous.current.working !== working) {
      turns.current += 1;
      host.current!.style.rotate = `${turns.current * 360}deg`;
    }
    previous.current = { seed, working };
  }, [working, definition, color, seed]);

  return <span ref={host} aria-hidden data-bot-avatar={definition.id} data-working={working}
    className={cn("inline-block size-6 shrink-0 align-middle", className)} />;
});
