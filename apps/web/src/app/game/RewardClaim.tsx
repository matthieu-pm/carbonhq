"use client";

import { useState, type FormEvent } from "react";
import s from "./game.module.css";

export function RewardClaim({ run }: { run: { elapsedMs: number; replay: string } }) {
  const [status, setStatus] = useState<"idle" | "sending" | "registered">("idle");
  const [error, setError] = useState("");

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status !== "idle") return;
    const email = new FormData(event.currentTarget).get("email");
    setStatus("sending");
    setError("");
    const retry = "We couldn’t register your email. Please try again.";
    try {
      const response = await fetch("/api/game/reward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...run }),
      });
      const result = await response.json();
      if (!response.ok || result.registered !== true) {
        setError(typeof result.error === "string" ? result.error : retry);
        setStatus("idle");
        return;
      }
      setStatus("registered");
    } catch {
      setStatus("idle");
      setError(retry);
    }
  }

  return <section className={s.reward} aria-labelledby="reward-heading">
    <h3 id="reward-heading">Claim $100 in OpenAI credits</h3>
    {status !== "registered" && <form onSubmit={register}>
      <label htmlFor="reward-email">Email address</label>
      <div className={s.rewardFields}>
        <input id="reward-email" name="email" type="email" autoComplete="email" required maxLength={254} readOnly={status === "sending"} />
        <button type="submit" className={s.primary} disabled={status === "sending"}>
          {status === "sending" ? "Registering…" : "Register email"}
        </button>
      </div>
    </form>}
    <p role="status">{status === "registered" ? "Email registered. The Carbon team will contact you about your credits." : error}</p>
  </section>;
}
