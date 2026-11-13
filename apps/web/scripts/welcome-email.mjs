import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { APPLE_MARK } from "./email-assets.mjs";

export const WELCOME_SUBJECT = "Welcome to Carbon";
export const WELCOME_FROM = "Carbon <newsletter@carbonhq.sh>";
export const WELCOME_EVENT = "carbon.newsletter.subscribed";
const SITE = "https://carbonhq.sh";

export function welcomeHtml() {
  const font = "Inter,Arial,Helvetica,sans-serif";
  const mono = "'Geist Mono','Courier New',monospace";
  const p = (text) => `<p style="margin:20px 0 0;font:16px/26px ${font};color:#a3a3a3">${text}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>Welcome to Carbon</title><style>body{margin:0!important;padding:0!important}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}@media only screen and (max-width:600px){.gutter{padding-left:24px!important;padding-right:24px!important}.headline{font-size:30px!important;line-height:36px!important}.step{padding-left:14px!important}}</style></head><body style="margin:0;padding:0;background:#141414"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">You’re on the list. Here’s where to start.</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#141414"><tr><td align="center" style="padding:24px 0"><!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#000000" style="max-width:600px;table-layout:fixed;border-collapse:collapse;border-radius:10px">
<tr><td class="gutter" style="padding:32px 40px;border-bottom:1px solid #242424"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="32" valign="middle" style="height:32px;line-height:0"><a href="${SITE}" aria-label="Carbon" style="display:block;width:32px"><img src="${SITE}/icon-dark.svg" alt="Carbon" width="32" height="32" style="display:block;width:32px;height:32px;margin-left:-3px;border:0"></a></td><td align="right" valign="middle" style="font:11px/14px ${mono};letter-spacing:.66px;text-transform:uppercase;color:#7c7c7c">From the crew</td></tr></table></td></tr>
<tr><td class="gutter" style="padding:48px 40px"><h1 class="headline" style="margin:0;font:300 36px/42px ${font};letter-spacing:-1.08px;color:#ffffff">Welcome to the crew.</h1>${p("Thanks for subscribing. You’re on the list for new releases, useful workflows, and a look at what we’re building.")}${p("Carbon brings your coding agents into one app. Run them side by side, give each task its own worktree, and review the changes in one place.")}<div style="padding-top:28px"><a href="${SITE}/download/macos" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#ffffff;color:#0b0b0f;font:500 14px/20px ${font};text-decoration:none">${APPLE_MARK}Download for macOS</a></div></td></tr>
<tr><td class="gutter" style="padding:36px 40px 40px;border-top:1px solid #242424"><p style="margin:0 0 24px;font:11px/14px ${mono};letter-spacing:.66px;text-transform:uppercase;color:#7c7c7c">Your first session</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td width="28" valign="top" style="padding-top:3px;font:11px/18px ${mono};color:#7c7c7c">01</td><td class="step" style="padding:0 0 22px 18px"><p style="margin:0;font:500 15px/22px ${font};color:#ffffff">Bring a project.</p><p style="margin:4px 0 0;font:14px/22px ${font};color:#a3a3a3">Attach a repository or a folder you already work in.</p></td></tr>
<tr><td width="28" valign="top" style="padding-top:3px;font:11px/18px ${mono};color:#7c7c7c">02</td><td class="step" style="padding:0 0 22px 18px"><p style="margin:0;font:500 15px/22px ${font};color:#ffffff">Pick an agent.</p><p style="margin:4px 0 0;font:14px/22px ${font};color:#a3a3a3">Choose a harness and model, then give it one clear task.</p></td></tr>
<tr><td width="28" valign="top" style="padding-top:3px;font:11px/18px ${mono};color:#7c7c7c">03</td><td class="step" style="padding-left:18px"><p style="margin:0;font:500 15px/22px ${font};color:#ffffff">Follow the work.</p><p style="margin:4px 0 0;font:14px/22px ${font};color:#a3a3a3">Read the conversation, inspect the changes, and keep your next task nearby.</p></td></tr>
</table><p style="margin:24px 0 0"><a href="${SITE}/docs/get-started/first-session" style="font:14px/20px ${font};color:#ffffff;text-decoration:underline;text-underline-offset:4px">Read the first-session guide</a></p></td></tr>
<tr><td class="gutter" bgcolor="#1612f8" style="padding:36px 40px;background-color:#1612f8;background-image:repeating-linear-gradient(90deg,#1511da 0 1px,transparent 1px 6px)"><h2 style="margin:0;font:300 24px/30px ${font};letter-spacing:-.6px;color:#ffffff">A little Carbon in your inbox.</h2><p style="margin:12px 0 0;font:15px/24px ${font};color:#d0cfff">We’ll share what’s new and practical ways to get more from your agents. You can unsubscribe anytime.</p><p style="margin:24px 0 0;font:15px/24px ${font};color:#ffffff">Thanks for being here,<br>The Carbon crew</p></td></tr>
<tr><td class="gutter" style="padding:24px 40px 32px"><p style="margin:0;font:12px/18px ${font};color:#7c7c7c">You’re receiving this because you subscribed at carbonhq.sh. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#a3a3a3;text-decoration:underline">Unsubscribe</a></p><p style="margin:12px 0 0;font:11px/16px ${mono};color:#7c7c7c">© 2026 Carbon · Free and open source</p></td></tr>
</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}

export const WELCOME_TEXT = `Welcome to the crew.

Thanks for subscribing. You’re on the list for new releases, useful workflows, and a look at what we’re building.

Carbon brings your coding agents into one app. Run them side by side, give each task its own worktree, and review the changes in one place.

Download for macOS: ${SITE}/download/macos

Your first session
01 — Bring a project. Attach a repository or a folder you already work in.
02 — Pick an agent. Choose a harness and model, then give it one clear task.
03 — Follow the work. Read the conversation, inspect the changes, and keep your next task nearby.

Read the first-session guide: ${SITE}/docs/get-started/first-session

A little Carbon in your inbox.
We’ll share what’s new and practical ways to get more from your agents. You can unsubscribe anytime.

Thanks for being here,
The Carbon crew

You’re receiving this because you subscribed at carbonhq.sh.
Unsubscribe: {{{RESEND_UNSUBSCRIBE_URL}}}
`;

async function main() {
  const directory = new URL("../emails/generated/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const html = welcomeHtml();
  await writeFile(new URL("carbon-welcome.html", directory), html);
  await writeFile(new URL("carbon-welcome.txt", directory), WELCOME_TEXT);
  console.log("Generated welcome email HTML and text.");
  if (!process.argv.includes("--upload")) return;

  const key = process.env.RESEND_API_KEY?.trim();
  const segment = process.env.RESEND_NEWSLETTER_SEGMENT_ID?.trim();
  if (!key || !segment) throw new Error("Configure Resend and the newsletter segment first.");
  let lastRequest = 0;
  async function resend(path, method = "GET", body) {
    const wait = 650 - (Date.now() - lastRequest);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest = Date.now();
    const response = await fetch(`https://api.resend.com${path}`, {
      method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(`Resend ${method} ${path}: ${response.status} ${String(result.message ?? "").replaceAll(key, "[key]")}`);
    }
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

  const templates = await list("/templates");
  let template = templates.find((item) => item.alias === "carbon-welcome");
  if (template && template.status !== "draft") throw new Error("Refusing to replace a published welcome template.");
  const templateBody = { name: "Carbon welcome", alias: "carbon-welcome", from: WELCOME_FROM, subject: WELCOME_SUBJECT, html, text: WELCOME_TEXT };
  const savedTemplate = await resend(template ? `/templates/${template.id}` : "/templates", template ? "PATCH" : "POST", templateBody);
  template = await resend(`/templates/${template?.id ?? savedTemplate.id}`);
  if (template.status !== "draft" || template.html !== html || template.from !== WELCOME_FROM) throw new Error("Welcome template verification failed.");
  console.log(`Verified welcome template draft: ${template.id}`);

  const broadcasts = await list("/broadcasts");
  let broadcast = broadcasts.find((item) => item.name === "Carbon welcome — current subscribers");
  if (broadcast && broadcast.status !== "draft") throw new Error("Refusing to replace a non-draft welcome broadcast.");
  const broadcastBody = { name: "Carbon welcome — current subscribers", segment_id: segment, from: WELCOME_FROM, subject: WELCOME_SUBJECT, html, text: WELCOME_TEXT };
  const savedBroadcast = await resend(broadcast ? `/broadcasts/${broadcast.id}` : "/broadcasts", broadcast ? "PATCH" : "POST", { ...broadcastBody, ...(broadcast ? {} : { send: false }) });
  broadcast = await resend(`/broadcasts/${broadcast?.id ?? savedBroadcast.id}`);
  if (broadcast.status !== "draft" || broadcast.html !== html || broadcast.from !== WELCOME_FROM || (broadcast.segment_id ?? broadcast.audience_id) !== segment) throw new Error("Welcome broadcast verification failed.");
  console.log(`Verified welcome broadcast draft: ${broadcast.id}`);

  const events = await list("/events");
  let event = events.find((item) => item.name === WELCOME_EVENT);
  if (!event) event = await resend("/events", "POST", { name: WELCOME_EVENT });
  const automations = await list("/automations");
  let automation = automations.find((item) => item.name === "Carbon welcome — future newsletter subscribers");
  if (automation && automation.status !== "disabled") throw new Error("Refusing to change an active welcome automation.");
  const automationBody = {
    name: "Carbon welcome — future newsletter subscribers", status: "disabled",
    steps: [
      { key: "signup", type: "trigger", config: { event_name: WELCOME_EVENT } },
      { key: "welcome", type: "send_email", config: { template: { id: template.id }, from: WELCOME_FROM } },
    ],
    connections: [{ from: "signup", to: "welcome" }],
  };
  await writeFile(new URL("carbon-welcome-automation.json", directory), `${JSON.stringify(automationBody, null, 2)}\n`);
  const draftAutomation = { ...automationBody, steps: [automationBody.steps[0]], connections: [] };
  const savedAutomation = await resend(automation ? `/automations/${automation.id}` : "/automations", automation ? "PATCH" : "POST", draftAutomation);
  automation = await resend(`/automations/${automation?.id ?? savedAutomation.id}`);
  if (automation.status !== "disabled" || automation.steps.some((step) => step.type === "send_email") || !automation.steps.some((step) => step.type === "trigger" && step.config.event_name === WELCOME_EVENT)) throw new Error("Disabled welcome automation verification failed.");
  console.log(`Verified disabled welcome automation: ${automation.id}`);
  await writeFile(new URL("resend-welcome.json", directory), `${JSON.stringify({
    from: WELCOME_FROM, subject: WELCOME_SUBJECT, segment_id: segment,
    template: { id: template.id, status: template.status },
    broadcast: { id: broadcast.id, status: broadcast.status },
    event: { id: event.id, name: WELCOME_EVENT },
    automation: { id: automation.id, status: automation.status, email_step_pending_template_publication: true, signup_event_integration_pending: true },
  }, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
