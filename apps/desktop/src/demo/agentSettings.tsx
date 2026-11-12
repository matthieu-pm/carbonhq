import { mockIPC } from "@tauri-apps/api/mocks";
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import McpSettings from "@/components/settings/McpSettings";
import SkillsSettings from "@/components/settings/SkillsSettings";
import { SettingsHeaderSlot } from "@/components/settings/headerAction";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import DemoThemeBar from "@/demo/ThemeBar";
import type { Harness, McpServerEntry, McpSource, McpTarget, SkillDocument, SkillEntry, SkillRoot, SkillsListing } from "@/types/events";
import "../App.css";

const project = "/Users/demo/Projects/carbon";
const root = "/Users/demo/.agents/skills";
const server: McpServerEntry = {
  name: "linear", transport: "http", url: "https://mcp.linear.app/mcp", command: null,
  args: [], env: [], headers: [{ name: "Authorization", value: "Bearer fixture-token" }], enabled: true, inherited: false,
};
const sources: McpSource[] = [
  { id: "claude", file: "claude_user", owner: "claude_code", readers: ["claude_code", "grok"], project: null,
    path: "/Users/demo/.claude.json", label: null, servers: [server], error: null, transports: ["stdio", "http", "sse"] },
  { id: "codex", file: "codex", owner: "codex", readers: ["codex"], project: null,
    path: "/Users/demo/.codex/config.toml", label: null, servers: [], error: null, transports: ["stdio", "http"] },
  { id: "project", file: "codex_project", owner: "codex", readers: ["codex"], project,
    path: `${project}/.codex/config.toml`, label: null, servers: [{ ...server, name: "docs", headers: [] }], error: null, transports: ["stdio", "http"] },
  { id: "grok", file: "grok_user", owner: "grok", readers: ["grok"], project: null,
    path: "/Users/demo/.grok/config.toml", label: null, servers: [], error: "Invalid TOML at line 4", transports: ["stdio", "http"] },
  { id: "pi", file: "pi_user", owner: "pi", readers: ["pi"], project: null,
    path: "/Users/demo/.pi/agent/mcp.json", label: null, servers: [{ ...server, name: "pi-docs", headers: [] }], error: null, transports: ["stdio", "http"] },
  { id: "pi-project", file: "pi_project", owner: "pi", readers: ["pi"], project,
    path: `${project}/.pi/mcp.json`, label: null, servers: [{ ...server, name: "pi-docs", url: null, headers: [], enabled: false, inherited: true }], error: null, transports: ["stdio", "http"] },
  { id: "fx", file: "fx", owner: "fx", readers: ["fx"], project: null,
    path: "/Users/demo/.fx/mcp.json", label: null, servers: [{ ...server, name: "filesystem", transport: "stdio", command: "npx", args: ["-y", "server-filesystem"], url: null, headers: [], env: [{ name: "API_KEY", value: "fixture-key" }] }], error: null, transports: ["stdio", "http", "sse"] },
];
const claudeRoot = "/Users/demo/.claude/skills";
const entry = (folder: string, name: string, description: string, over: Partial<SkillEntry> = {}): SkillEntry => ({
  name, description, path: `${folder}/${name}`, locked: null, linked: false, shared: false, shareable: false, ...over,
});
const folder = (path: string, readers: Harness[], skills: SkillEntry[]): SkillRoot => ({
  id: path, path, project: null, readers, label: null, error: null, writable: true, sharedWith: null, skills,
});
// One shared skill drawn in both groups, one that can still be shared, and one
// Carbon owns.
const listing: SkillsListing = { roots: [
  folder(claudeRoot, ["claude_code", "grok", "fx"], [
    entry(claudeRoot, "release-notes", "Write release notes from merged pull requests.", { shared: true }),
  ]),
  folder(root, ["codex", "pi", "grok", "fx"], [
    entry(root, "carbon", "Manage Carbon sessions and drive the browser.", { locked: "Managed by Carbon. Every launch rewrites it." }),
    entry(root, "release-notes", "Write release notes from merged pull requests.", { shared: true, linked: true }),
    entry(root, "review-pr", "Review a pull request and check its behavior.", { shareable: true }),
  ]),
], targets: [] };
listing.targets = [
  { ...folder(claudeRoot, ["claude_code", "codex", "grok", "fx", "pi"], []), id: `everyone:${claudeRoot}`, sharedWith: root },
  ...listing.roots.map((r) => ({ ...r, skills: [] })),
];
const documents = new Map<string, SkillDocument>(listing.roots.flatMap((r) => r.skills).map((s) => [s.path, { name: s.name, description: s.description, body: "# Instructions\n\nRead the changes and verify the result.\n" }]));
const other = (path: string) => (path === root ? claudeRoot : root);
/// What `link_into_partner` does: the same skill, drawn in the other folder too.
function linkInto(from: string, name: string) {
  const row = listing.roots.find((r) => r.path === from)!.skills.find((s) => s.name === name)!;
  Object.assign(row, { shared: true, shareable: false });
  const to = other(from);
  listing.roots.find((r) => r.path === to)!.skills.push({ ...row, path: `${to}/${name}`, linked: true });
  documents.set(`${to}/${name}`, documents.get(row.path)!);
}
function addSkill(to: string, doc: SkillDocument, shared: boolean) {
  const path = `${to}/${doc.name}`;
  if (documents.has(path) || (shared && documents.has(`${other(to)}/${doc.name}`))) throw "A skill with that name already exists.";
  listing.roots.find((r) => r.path === to)!.skills.push(entry(to, doc.name, doc.description, { shareable: !shared }));
  documents.set(path, doc);
  if (shared) linkInto(to, doc.name);
  return path;
}

// Only the bridge is faked; the forms, hooks and header portal are shipping code.
mockIPC(async (command, payload) => {
  if (command === "plugin:dialog|open") return "/tmp/imported-skill";
  if (command === "plugin:opener|reveal_item_in_dir") return;
  const request = payload as { cmd: string; args: Record<string, unknown> };
  const { cmd, args } = command === "server_invoke" ? request : { cmd: command, args: payload as Record<string, unknown> };
  switch (cmd) {
    case "agent_availability": return (["claude_code", "codex", "grok", "fx", "pi"] as Harness[]).map((harness) => ({ harness, available: true }));
    case "list_mcp_servers": return structuredClone(sources);
    case "mcp_server_status": return { statuses: [{ owner: "claude_code", project: null, name: "linear", status: "connected" }], extras: [], errors: [] };
    case "save_mcp_server": {
      const target = args.target as McpTarget;
      const entry = args.server as McpServerEntry;
      let source = sources.find((s) => s.file === target.file && s.project === target.project);
      if (!source) {
        source = { ...sources[0], id: `${target.file}:${target.project}`, file: target.file, project: target.project, servers: [] };
        sources.push(source);
      }
      if (source.servers.some((s) => s.name === entry.name && s.name !== args.original)) throw "A server with that name already exists.";
      source.servers = source.servers.filter((s) => s.name !== args.original);
      source.servers.push(entry);
      return;
    }
    case "remove_mcp_server": {
      const target = args.target as McpTarget;
      const source = sources.find((s) => s.file === target.file && s.project === target.project)!;
      source.servers = source.servers.filter((s) => s.name !== args.name);
      return;
    }
    case "list_skills": {
      if (args.discoverPi && new URLSearchParams(location.search).has("slowPi")) {
        await new Promise((resolve) => setTimeout(resolve, 15_000));
      }
      return structuredClone(listing);
    }
    case "read_skill": return documents.get(String(args.path));
    case "create_skill": return addSkill(String(args.root), args.skill as SkillDocument, !!args.shared);
    case "share_skill": {
      const path = String(args.path);
      return linkInto(path.slice(0, path.lastIndexOf("/")), path.slice(path.lastIndexOf("/") + 1));
    }
    case "save_skill": {
      const old = String(args.path);
      const doc = args.skill as SkillDocument;
      const next = documents.get(old)?.name === doc.name ? old : `${old.slice(0, old.lastIndexOf("/"))}/${doc.name}`;
      if (next !== old && documents.has(next)) throw "A skill with that name already exists.";
      Object.assign(listing.roots.flatMap((r) => r.skills).find((s) => s.path === old)!, doc, { path: next });
      documents.delete(old);
      documents.set(next, doc);
      return next;
    }
    case "remove_skill": {
      for (const r of listing.roots) r.skills = r.skills.filter((s) => s.path !== args.path);
      documents.delete(String(args.path));
      return;
    }
    case "import_skill": return addSkill(String(args.root), { name: "imported-skill", description: "Imported folder and support files.", body: "# Imported" }, !!args.shared);
    default: return null;
  }
});

function Demo() {
  const [tab, setTab] = useState<"mcp" | "skills">("mcp");
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  return (
    <TooltipProvider>
      <DemoThemeBar />
      <main className="mx-auto flex max-w-176 flex-col gap-6 p-6 pb-48">
        <nav className="flex gap-2" aria-label="Settings tabs">
          <Button variant={tab === "mcp" ? "secondary" : "ghost"} onClick={() => setTab("mcp")}>MCP</Button>
          <Button variant={tab === "skills" ? "secondary" : "ghost"} onClick={() => setTab("skills")}>Skills</Button>
          <Button variant="ghost" onClick={() => addSkill(root, { name: `external-${documents.size}`, description: "Added outside Settings. Reopen the tab to read it.", body: "# External" }, false)}>Add external skill</Button>
        </nav>
        <header className="flex items-center gap-2"><h1 className="text-lg font-medium">{tab === "mcp" ? "MCP" : "Skills"}</h1><div ref={setSlot} className="contents" /></header>
        <p className="text-ui text-muted-foreground">Fixture data. Changes stay in this demo.</p>
        <SettingsHeaderSlot.Provider value={slot}>
          {tab === "mcp" ? <McpSettings projects={[{ path: project, name: "Carbon", space: null, lastSelected: "2026-11-04T15:00:00Z" }, { path: "carbon://vps/root/remote-only", name: "Remote only", space: null, lastSelected: "" }]} /> : <SkillsSettings />}
        </SettingsHeaderSlot.Provider>
      </main>
    </TooltipProvider>
  );
}
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><Demo /></React.StrictMode>);
