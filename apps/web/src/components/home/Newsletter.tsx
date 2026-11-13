"use client";

import { Check, MousePointer2 } from "lucide-react";
import { getExample } from "open-bot-avatar";
import { mountAvatar, type MountedAvatar } from "open-bot-avatar/dom";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import s from "./newsletter.module.css";

type Phase = "idle" | "filling" | "crew" | "pressing" | "sending" | "done" | "error";
const NEXT = { filling: ["crew", 1200], crew: ["pressing", 700], pressing: ["sending", 180] } as const;
const MESSAGES: Record<Phase, string> = {
  idle: "Product updates. Unsubscribe anytime.",
  filling: "Getting your email ready…",
  crew: "The crew will take it from here.",
  pressing: "Sending it off…",
  sending: "Subscribing you…",
  done: "You’re subscribed. Thanks for joining the crew.",
  error: "We couldn’t subscribe you. Please try again.",
};

/// Success follows Resend’s reply, while the crew’s press starts the request.
export function Newsletter() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const email = useRef<HTMLInputElement>(null);
  const website = useRef<HTMLInputElement>(null);
  const submission = useRef<{ email: string; website: string } | null>(null);
  const id = useId();
  const busy = phase !== "idle" && phase !== "done" && phase !== "error";

  useEffect(() => {
    if (phase !== "filling" && phase !== "crew" && phase !== "pressing") return;
    const [next, duration] = NEXT[phase];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setPhase(next), reduced ? 120 : duration);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "sending" || !submission.current) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);

    async function subscribe() {
      try {
        const response = await fetch("/api/newsletter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submission.current),
          signal: controller.signal,
        });
        const result = await response.json();
        if (cancelled) return;
        if (!response.ok || result?.subscribed !== true) {
          setError(typeof result?.error === "string" ? result.error : MESSAGES.error);
          setPhase("error");
          return;
        }
        setPhase("done");
      } catch {
        if (cancelled) return;
        setError(controller.signal.aborted ? "This is taking too long. Please try again." : MESSAGES.error);
        setPhase("error");
      } finally {
        window.clearTimeout(timer);
        submission.current = null;
      }
    }

    let cancelled = false;
    void subscribe();
    return () => { cancelled = true; controller.abort(); window.clearTimeout(timer); };
  }, [phase]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((phase !== "idle" && phase !== "error") || submission.current) return;
    submission.current = { email: email.current!.value.trim(), website: website.current!.value };
    setError("");
    setPhase("filling");
  }

  return (
    <div id="newsletter" className={s.card} data-newsletter data-phase={phase}>
      <div className={s.copy}>
        <p className={s.eyebrow}>From the crew</p>
        <h3 className={s.title}>A little Carbon in your inbox.</h3>
        <p className={s.description}>New releases, useful workflows, and what we’re building next.</p>
      </div>
      <form className={s.form} onSubmit={submit} aria-busy={busy}>
        <div className={s.honeypot} aria-hidden="true" inert>
          <label htmlFor={`${id}-website`}>Website</label>
          <input ref={website} id={`${id}-website`} name="website" type="text" autoComplete="off" tabIndex={-1} />
        </div>
        <div className={s.controls}>
          <div className={s.field}>
            <DitherFill active={busy || phase === "done"} />
            <label className="sr-only" htmlFor={`${id}-email`}>Email address</label>
            <input ref={email} id={`${id}-email`} name="email" type="email" required
              autoComplete="email" placeholder="you@example.com" readOnly={busy || phase === "done"} maxLength={254}
              aria-describedby={`${id}-status`} className={s.input} />
          </div>
          <div className={s.action}>
            <button type="submit" className={s.subscribe} disabled={busy || phase === "done"}>
              {phase === "done" ? <><Check size={15} /> Subscribed</> : phase === "error" ? "Try again" : phase === "sending" ? "Subscribing…" : "Subscribe"}
            </button>
            {(phase === "crew" || phase === "pressing" || phase === "sending" || phase === "done") && (
              <div className={s.crew} aria-hidden>
                <CrewBot happy={phase === "done"} />
                <MousePointer2 className={s.cursor} size={25} fill="white" stroke="#17135b" strokeWidth={1.5} />
                <span className={s.clickRing} />
              </div>
            )}
          </div>
        </div>
        <div className={s.note}>
          <p id={`${id}-status`} role="status">{phase === "error" ? error : MESSAGES[phase]}</p>
        </div>
      </form>
    </div>
  );
}

function CrewBot({ happy }: { happy: boolean }) {
  const host = useRef<HTMLSpanElement>(null);
  const avatar = useRef<MountedAvatar | null>(null);

  useEffect(() => {
    avatar.current = mountAvatar(host.current!, {
      definition: getExample("controller")!, color: "#f5a800", label: "",
      reducedMotion: "system", lookAt: { x: 0.6, y: 0.8 },
    });
    return () => { avatar.current?.destroy(); avatar.current = null; };
  }, []);

  useEffect(() => {
    avatar.current?.update({ mood: happy ? "happy" : "idle" });
  }, [happy]);

  return <span ref={host} className={s.bot} />;
}

// Dither-kit's 4×4 Bayer thresholds and 2px cells keep the reference's ordered texture.
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];

function DitherFill({ active }: { active: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    function paint() {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width / 2));
      canvas.height = Math.max(1, Math.round(height / 2));
      for (let y = 0; y < canvas.height; y++) {
        const density = y / canvas.height;
        for (let x = 0; x < canvas.width; x++) {
          const lit = density > (BAYER[y & 3][x & 3] + 0.5) / 16;
          const alpha = (0.3 + density * 0.7) * (lit ? 1 : 0.4);
          ctx.fillStyle = `rgba(53,143,243,${alpha})`;
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, []);

  return <canvas ref={ref} aria-hidden className={s.dither} data-active={active} />;
}
