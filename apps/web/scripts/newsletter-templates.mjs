import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { APPLE_MARK } from "./email-assets.mjs";

const SITE = "https://carbonhq.sh";
const REPO = "https://github.com/matthieu-pm/carbonhq";
const INSTALL = "curl -fsSL https://carbonhq.sh/install.sh | sh";
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/// Tables and inline styles preserve the wireframe where email clients drop web layout CSS.
export function newsletterHtml(theme) {
  const dark = theme === "dark";
  const c = dark
    ? { bg: "#000000", surround: "#141414", text: "#ffffff", muted: "#7c7c7c", body: "#a3a3a3", line: "#242424", tile: "#080808", code: "#141414", green: "#3dd68c", purple: "#c98bff" }
    : { bg: "#ffffff", surround: "#f4f4f2", text: "#0a0a0a", muted: "#8a8a8a", body: "#525252", line: "#e5e5e5", tile: "#fafafa", code: "#f5f5f5", green: "#0b8a5a", purple: "#8526d1" };
  const font = "Inter,Arial,Helvetica,sans-serif";
  const mono = "'Geist Mono','Courier New',monospace";
  const table = (content, style = "") => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;${style}">${content}</table>`;
  const label = (text, color = c.muted) => `<p style="margin:0;font:11px/14px ${mono};letter-spacing:.66px;text-transform:uppercase;color:${color}">${text}</p>`;
  const paragraph = (text, margin = "12px 0 0") => `<p style="margin:${margin};font:15px/24px ${font};color:${c.body}">${text}</p>`;
  const link = (text, href = `${SITE}/docs`) => `<a href="${href}" style="color:${c.text};font:14px/20px ${font};text-decoration:underline;text-underline-offset:4px">${text}</a>`;
  const button = (text, href = `${SITE}/download/macos`, inverted = false) => `<a href="${href}" style="display:inline-block;padding:10px 16px;border-radius:6px;background:${inverted || dark ? "#ffffff" : "#0a0a0a"};color:${inverted || dark ? "#0b0b0f" : "#ffffff"};font:500 14px/20px ${font};text-decoration:none;box-shadow:inset 0 -1px 0 #4d4c4c,0 1px 2px #00000040">${text === "Download for macOS" ? APPLE_MARK : ""}${text}</a>`;
  const block = (content, heading) => `<tr><td class="gutter section" style="padding:48px 40px;border-top:1px solid ${c.line}">${heading ? `<div style="padding-bottom:24px">${label(heading)}</div>` : ""}${content}</td></tr>`;
  const h2 = (text, margin = "0") => `<h2 style="margin:${margin};font:400 20px/26px ${font};letter-spacing:-.4px;color:${c.text}">${text}</h2>`;
  const placeholder = (text, height) => table(`<tr><td height="${height}" align="center" style="height:${height}px;border:1px dashed ${c.line};border-radius:10px;background-color:${c.tile};background-image:repeating-linear-gradient(135deg,${c.line} 0 1px,transparent 1px 10px);padding:0 12px">${label(text)}</td></tr>`);
  const item = (title, text) => `<p style="margin:0 0 10px;font:14px/22px ${font};color:${c.body}"><strong style="font-weight:500;color:${c.text}">${title}</strong> ${text}</p>`;
  const group = (name, color, content, first = false) => `<tr><td class="stack change-label" width="112" valign="top" style="width:112px;padding:20px 24px 20px 0;${first ? "" : `border-top:1px solid ${c.line};`}">${label(`<span style="color:${color}">■</span>&nbsp; ${name}`, c.text)}</td><td class="stack change-body" valign="top" style="padding:20px 0 10px;${first ? "" : `border-top:1px solid ${c.line};`}">${content}</td></tr>`;
  const tip = (n, title, text, command) => `<tr><td width="40" valign="top" style="padding:3px 12px 24px 0;">${label(n)}</td><td style="padding-bottom:24px"><p style="margin:0;font:500 15px/22px ${font};color:${c.text}">${title}</p><p style="margin:4px 0 0;font:14px/22px ${font};color:${c.body}">${text}</p><div style="margin-top:12px;padding:8px 12px;border:1px solid ${c.line};border-radius:6px;background:${c.code};font:12px/18px ${mono};color:${dark ? "#cfcfcf" : c.text};overflow-wrap:anywhere;word-break:break-word">${escape(command)}</div></td></tr>`;
  const reading = (title, source) => `<tr><td style="padding:14px 0;border-top:1px solid ${c.line};font:14px/20px ${font};color:${c.text}">${title}</td><td align="right" style="padding:14px 0 14px 12px;border-top:1px solid ${c.line};font:11px/16px ${mono};color:${c.muted}">${source}&nbsp;↗</td></tr>`;

  const masthead = `<tr><td class="gutter" style="padding:10px 40px;border-bottom:1px solid ${c.line}">${table(`<tr><td style="font:12px/16px ${font};color:${c.muted}">0.30 is in beta, the pinned summary up close, three ways to fan out.</td><td align="right" valign="top" style="padding-left:16px;white-space:nowrap">${label(`<a href="{{{VIEW_ONLINE_URL}}}" style="color:${c.muted};text-decoration:none">View online</a>`)}</td></tr>`)}</td></tr><tr><td class="gutter" style="padding:32px 40px 40px">${table(`<tr><td height="32" valign="middle" style="height:32px;line-height:0"><a href="${SITE}" aria-label="Carbon" style="display:block;width:32px;text-decoration:none"><img src="${SITE}/${dark ? "icon-dark.svg" : "icon.svg"}" width="32" height="32" alt="Carbon" style="display:block;width:32px;height:32px;border:0;margin-left:-3px"></a></td><td align="right" valign="middle" style="vertical-align:middle">${label("No. 07 · Nov 2026")}</td></tr>`)}</td></tr>`;
  const lead = block(`<h1 class="headline" style="margin:0;font:300 32px/36px ${font};letter-spacing:-.96px;color:${c.muted}"><span style="color:${c.text}">Carbon 0.30 is in beta.</span> A rail for everything that isn’t a session, remote MCP servers, and a summary that stays put.</h1>${paragraph("Four betas in two weeks. Here is what changed, one feature up close, and a few ways people are running more than one agent at once.", "16px 0 32px")}${placeholder("Hero · 0.30 window, rail open", 325)}<div style="padding-top:32px">${button("Get the beta")}&nbsp;&nbsp;&nbsp; ${link("Read the changelog", `${SITE}/changelog`)}</div>`);
  const shipped = block(table(group("New", c.green, item("Navigation rail.", "Home, Issues, usage and Settings get their own rail, with Back and Forward.") + item("Remote MCP servers.", "Add and manage them from Settings."), true) + group("Improved", "#1612f8", item("Context breakdown.", "See what fills a Claude Code session’s context window.") + item("Appearance.", "Interface and code font sizes are set separately.") + item("Issue details.", "Linear issues show relations, sub-issues and cycles.")) + group("Fixed", c.purple, item("Mac connection after install.", "The background server no longer points at an ejected disk image.") + item("Tabs.", "Keep their state when switching views.")), `border-top:1px solid ${c.line};border-bottom:1px solid ${c.line}`) + `<div style="padding-top:20px">${link("Full changelog", `${SITE}/changelog`)}</div>`, "What shipped · 0.30.0-beta.1–4");
  const deepDive = block(`${placeholder("GIF · summary docks as a rail", 347)}${h2("The pinned summary, docked.", "24px 0 0")}${paragraph("Close the right panel and the summary docks beside the chat as a full-height rail. Open it again and the summary floats as a card. Either way the chat stays where it was.")}${paragraph("It now carries the agent’s task list and, for Claude Code, what fills the context window: messages, tools, system prompt, skills, memory and the room left.")}<div style="padding-top:20px">${link("How the summary works")}</div>`, "Up close");
  const workflow = block(`${h2("Three ways to fan out.")}<div style="padding-top:24px">${table(tip("01", "Hand a review to another agent.", "A second session starts from this one’s branch and sends its findings back.", "carbon session new --base <id> --harness codex") + tip("02", "Let the agent look at the page.", "Every session has its own browser. The agent opens, reads and clicks it like you would.", "carbon browser open http://localhost:3000") + tip("03", "Park a task for later.", "Drafts keep the prompt and every pick, and wait in the sidebar until you start them.", 'carbon draft new "Move settings to the rail"'))}</div>`, "Workflow");
  const community = block(`<div style="padding:24px;border:1px solid ${c.line};border-radius:10px;background:${c.tile}"><blockquote style="margin:0;font:17px/26px ${font};letter-spacing:-.17px;color:${c.text}">“[Quote from a user, two lines at most. What they run in Carbon and what it replaced.]”</blockquote>${table(`<tr><td width="44" style="padding-top:20px"><div style="width:32px;height:32px;border-radius:50%;background:${c.line}">&nbsp;</div></td><td style="padding-top:20px"><p style="margin:0 0 2px;font:14px/20px ${font};color:${c.text}">[Name]</p>${label("[Role · company]")}</td></tr>`)}</div><div style="padding-top:40px;padding-bottom:12px">${label("Worth reading")}</div>${table(reading("[Article or video title]", "[domain.com]") + reading("[A user’s write-up of their setup]", "[blog.example]") + reading("[Release from a harness Carbon runs]", "[github.com]"), `border-bottom:1px solid ${c.line}`)}`, "From the crew");
  const closing = `<tr><td bgcolor="#1612f8" style="background-color:#1612f8;background-image:repeating-linear-gradient(90deg,#1511da 0 1px,transparent 1px 6px);border-radius:0 0 10px 10px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="gutter" style="padding:56px 40px 40px"><h2 style="margin:0;font:300 28px/32px ${font};letter-spacing:-.84px;color:#ffffff">Your subscription, your favourite harness. Mix and switch freely.</h2><div style="padding-top:32px">${table(`<tr><td class="stack install" width="50%" valign="top" style="padding:20px;border-right:1px solid #625fff">${label("On your Mac", "#b9b8ff")}<p style="margin:6px 0 20px;font:17px/22px ${font};letter-spacing:-.34px;color:#ffffff">Download the app.</p>${button("Download for macOS", undefined, true)}</td><td class="stack install" width="50%" valign="top" style="padding:20px">${label("On a server", "#b9b8ff")}<p style="margin:6px 0 20px;font:17px/22px ${font};letter-spacing:-.34px;color:#ffffff">Install the CLI.</p><div style="padding:10px 12px;border-radius:6px;background:#100db4;font:12px/18px ${mono};color:#ffffff;overflow-wrap:anywhere;word-break:break-word">${INSTALL}</div></td></tr>`, "table-layout:fixed;border:1px solid #625fff;background:#2e2afa")}</div></td></tr><tr><td class="gutter" style="padding:24px 40px 40px;border-top:1px solid #625fff">${label(`<a href="${SITE}/docs" style="color:#b9b8ff;text-decoration:none">Docs</a>&nbsp;&nbsp; <a href="${SITE}/changelog" style="color:#b9b8ff;text-decoration:none">Changelog</a>&nbsp;&nbsp; <a href="${REPO}" style="color:#b9b8ff;text-decoration:none">GitHub</a>&nbsp;&nbsp; <a href="{{{VIEW_ONLINE_URL}}}" style="color:#b9b8ff;text-decoration:none">View online</a>`, "#b9b8ff")}<p style="margin:12px 0;font:12px/18px ${font};color:#b9b8ff">You get this because you signed up at carbonhq.sh. One email per release train, never more than two a month. <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:#ffffff;text-decoration:underline">Unsubscribe</a></p>${label("© 2026 Carbon · Free and open source", "#b9b8ff")}</td></tr></table></td></tr>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="${theme}"><meta name="supported-color-schemes" content="${theme}"><title>Carbon newsletter</title><style>body{margin:0!important;padding:0!important}table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}a{color:inherit}img{border:0} @media only screen and (max-width:600px){.gutter{padding-left:20px!important;padding-right:20px!important}.section{padding-top:40px!important;padding-bottom:40px!important}.headline{font-size:26px!important;line-height:30px!important}.stack{display:block!important;width:auto!important}.change-label{padding:20px 0 12px!important}.change-body{padding:0 0 10px!important;border-top:0!important}.install{border-right:0!important}.install+.install{border-top:1px solid #625fff!important}}</style></head><body style="margin:0;padding:0;background:${c.surround};font-family:${font};color:${c.text}"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">0.30 is in beta, the pinned summary up close, three ways to fan out.</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.surround}"><tr><td align="center" style="padding:24px 0"><!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.bg}" style="max-width:600px;table-layout:fixed;background:${c.bg};border-collapse:collapse;border-radius:10px">${masthead}${lead}${shipped}${deepDive}${workflow}${community}${closing}</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}

async function main() {
  const directory = new URL("../emails/generated/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const templates = ["dark", "light"].map((theme) => ({
    name: `Carbon newsletter — ${theme === "dark" ? "Dark" : "Light"}`,
    alias: `carbon-newsletter-${theme}`,
    subject: "Carbon 0.30 is in beta.",
    html: newsletterHtml(theme),
    variables: [{ key: "VIEW_ONLINE_URL", type: "string" }],
  }));
  for (const template of templates) {
    await writeFile(new URL(`${template.alias}.html`, directory), template.html);
    console.log(`Generated ${template.alias}.html`);
  }
  if (!process.argv.includes("--upload")) return;
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error("Set RESEND_API_KEY in .env.local first.");
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
  const existing = [];
  let cursor;
  do {
    const page = await resend(`/templates?limit=100${cursor ? `&after=${cursor}` : ""}`);
    existing.push(...page.data);
    cursor = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (cursor);
  const saved = [];
  for (const template of templates) {
    const previous = existing.find((item) => item.alias === template.alias);
    if (previous && previous.status !== "draft") throw new Error(`Refusing to replace published template ${template.alias}.`);
    const result = await resend(previous ? `/templates/${previous.id}` : "/templates", previous ? "PATCH" : "POST", template);
    const id = previous?.id ?? result.id;
    const remote = await resend(`/templates/${id}`);
    if (remote.status !== "draft" || remote.html !== template.html) throw new Error(`Saved template verification failed: ${template.alias}.`);
    saved.push({ id, name: remote.name, alias: remote.alias, status: remote.status });
    console.log(`Verified draft: ${remote.name} (${id})`);
  }
  await writeFile(new URL("resend-templates.json", directory), `${JSON.stringify(saved, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
