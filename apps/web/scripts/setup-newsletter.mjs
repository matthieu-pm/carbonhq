import { readFile, writeFile, chmod } from "node:fs/promises";

const key = process.env.RESEND_API_KEY?.trim();
if (!key) throw new Error("Set RESEND_API_KEY in apps/web/.env.local first.");

async function resend(path, method = "GET", body) {
  const response = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Resend returned ${response.status}. Check the key’s Contacts and Segments permissions.`);
  return response.json();
}

const name = "Carbon newsletter";
let segment;
let cursor;
do {
  const page = await resend(`/segments?limit=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`);
  segment = page.data.find((item) => item.name === name);
  cursor = page.has_more ? page.data.at(-1)?.id : undefined;
  if (cursor && !segment) await new Promise((resolve) => setTimeout(resolve, 600));
} while (!segment && cursor);

if (!segment) segment = await resend("/segments", "POST", { name });
if (typeof segment.id !== "string") throw new Error("Resend returned an invalid segment.");

const path = ".env.local";
const existing = await readFile(path, "utf8").catch((error) => {
  if (error.code === "ENOENT") return "";
  throw error;
});
const line = `RESEND_NEWSLETTER_SEGMENT_ID=${segment.id}`;
const normalized = existing.replace(/^RESEND_API_KEY=.*$/m, `RESEND_API_KEY=${key}`);
const next = /^RESEND_NEWSLETTER_SEGMENT_ID=.*$/m.test(normalized)
  ? normalized.replace(/^RESEND_NEWSLETTER_SEGMENT_ID=.*$/m, line)
  : `${normalized.trimEnd()}\n${line}\n`;
await writeFile(path, next, { mode: 0o600 });
await chmod(path, 0o600);
console.log(`Ready: ${name} (${segment.id}). API key kept private.`);
