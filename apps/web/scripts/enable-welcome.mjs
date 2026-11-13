import { readFile, writeFile } from "node:fs/promises";

const key = process.env.RESEND_API_KEY?.trim();
if (!key) throw new Error("Configure RESEND_API_KEY first.");
const directory = new URL("../emails/generated/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("resend-welcome.json", directory), "utf8"));
let lastRequest = 0;
async function resend(path, method = "GET", body) {
  const wait = 650 - (Date.now() - lastRequest);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequest = Date.now();
  const response = await fetch(`https://api.resend.com${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Resend ${method} ${path}: ${response.status}`);
  return response.json();
}
async function list(path) {
  const items = [];
  let cursor;
  do {
    const page = await resend(`${path}?limit=100${cursor ? `&after=${cursor}` : ""}`);
    items.push(...page.data);
    cursor = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (cursor);
  return items;
}

let template = await resend(`/templates/${manifest.template.id}`);
const html = await readFile(new URL("carbon-welcome.html", directory), "utf8");
function content(value) {
  return JSON.stringify({
    text: value.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    links: [...value.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]).sort(),
  });
}
if (content(template.html) !== content(html) || template.from !== manifest.from || template.subject !== manifest.subject) {
  throw new Error("The saved welcome differs from the approved local version; review it before enabling.");
}
if (template.status === "draft") {
  await resend(`/templates/${template.id}/publish`, "POST");
  template = await resend(`/templates/${template.id}`);
}
if (template.status !== "published") throw new Error("The welcome template is not published.");
await writeFile(new URL("carbon-welcome-approved.html", directory), template.html);
console.log("Verified approved welcome template is published.");

const properties = await list("/contact-properties");
let property = properties.find((item) => item.key === "carbon_welcome");
if (!property) property = await resend("/contact-properties", "POST", { key: "carbon_welcome", type: "string", fallback_value: "" });
if (property.type && property.type !== "string") throw new Error("carbon_welcome must be a string property.");

const automation = await resend(`/automations/${manifest.automation.id}`);
if (automation.status !== "disabled") throw new Error("Disable the separate welcome automation to prevent a second delivery path.");

const contacts = await list(`/segments/${manifest.segment_id}/contacts`);
const recipients = contacts.filter((contact) => contact.unsubscribed === false);
let broadcast = await resend(`/broadcasts/${manifest.broadcast.id}`);
if (content(broadcast.html) !== content(html) || broadcast.from !== manifest.from || (broadcast.segment_id ?? broadcast.audience_id) !== manifest.segment_id) {
  throw new Error("The current-subscriber broadcast does not match the approved welcome and segment.");
}
if (broadcast.status === "draft" && recipients.length > 0) {
  if (!process.argv.includes("--send-current")) throw new Error("Use --send-current to send the approved welcome to current subscribers.");
  await resend(`/broadcasts/${broadcast.id}/send`, "POST");
  broadcast = await resend(`/broadcasts/${broadcast.id}`);
  console.log(`Current-subscriber broadcast accepted: ${broadcast.status}.`);
} else {
  console.log(`Current subscribed contacts: ${recipients.length}. Broadcast status: ${broadcast.status}.`);
}

const path = ".env.local";
const environment = await readFile(path, "utf8");
const setting = `RESEND_WELCOME_TEMPLATE_ID=${template.id}`;
const next = /^RESEND_WELCOME_TEMPLATE_ID=.*$/m.test(environment)
  ? environment.replace(/^RESEND_WELCOME_TEMPLATE_ID=.*$/m, setting)
  : `${environment.trimEnd()}\n${setting}\n`;
await writeFile(path, next, { mode: 0o600 });
await writeFile(new URL("resend-welcome.json", directory), `${JSON.stringify({
  ...manifest,
  template: { id: template.id, status: template.status },
  broadcast: { id: broadcast.id, status: broadcast.status, subscribed_contacts_at_launch: recipients.length },
  automation: { id: automation.id, status: automation.status, unused: true },
  delivery: { method: "signup_email_api", property: "carbon_welcome", website_hook: "implemented_locally_pending_deployment" },
}, null, 2)}\n`);
console.log("Welcome configured locally; the website deployment needs RESEND_WELCOME_TEMPLATE_ID too.");
