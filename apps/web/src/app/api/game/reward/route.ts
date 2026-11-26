import { createHash } from "node:crypto";
import { verifyHardcoreReplay } from "@/app/game/engine";

const MAX_FORM_SIZE = 8192;
const UNAVAILABLE = "We couldn’t register your email right now. Please try again.";

export async function POST(request: Request) {
  const reply = (body: object, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  if ((origin && origin !== `${url.protocol}//${host}`) || request.headers.get("sec-fetch-site") === "cross-site") {
    return reply({ error: "Please claim your reward from the Carbon website." }, 403);
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    return reply({ error: "Please submit the reward form again." }, 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_FORM_SIZE) {
    return reply({ error: "The reward form is too large." }, 413);
  }

  let input: unknown;
  try {
    const body = await request.text();
    if (body.length > MAX_FORM_SIZE) return reply({ error: "The reward form is too large." }, 413);
    input = JSON.parse(body);
  } catch {
    return reply({ error: "Please submit the reward form again." }, 400);
  }
  if (!input || typeof input !== "object") return reply({ error: "Please submit the reward form again." }, 400);

  const { email: address, elapsedMs, replay } = input as Record<string, unknown>;
  const email = typeof address === "string" ? address.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply({ error: "Enter a valid email address." }, 400);
  }
  if (typeof elapsedMs !== "number" || typeof replay !== "string" || !verifyHardcoreReplay(replay, elapsedMs)) {
    return reply({ error: "This run did not qualify. Finish Hardcore in under two minutes to claim the reward." }, 422);
  }

  const key = process.env.RESEND_API_KEY?.trim();
  const inbox = process.env.CARBON_GAME_REWARD_INBOX?.trim();
  if (!key || !inbox) return reply({ error: UNAVAILABLE }, 503);

  const runId = createHash("sha256").update(replay).digest("hex");
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `tower-shift-hardcore/${runId}`,
      },
      body: JSON.stringify({
        from: "Carbon <newsletter@carbonhq.sh>",
        to: [inbox],
        reply_to: email,
        subject: "Tower Shift Hardcore reward claim",
        text: `Email: ${email}\nReward: $100 in OpenAI credits\nRun time: ${(elapsedMs / 1000).toFixed(3)} seconds\nRun ID: ${runId}`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok && typeof (await response.json()).id === "string") return reply({ registered: true });
    console.error("Tower Shift reward registration failed", { status: response.status });
  } catch {
    console.error("Tower Shift reward registration could not reach Resend");
  }
  return reply({ error: UNAVAILABLE }, 503);
}
