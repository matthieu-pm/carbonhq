import { LOCAL, serverOfPath } from "@/lib/transport";
import type { Harness, McpFile, McpServerEntry, McpSource, McpTarget, Project } from "@/types/events";

export const MCP_FILE_OWNERS: Record<McpFile, Harness> = {
  claude_user: "claude_code", claude_local: "claude_code", claude_project: "claude_code",
  codex: "codex", codex_project: "codex", grok_user: "grok", grok_project: "grok", fx: "fx",
  pi_user: "pi", pi_project: "pi",
};
export const MCP_PROJECT_FILES: McpFile[] = ["claude_local", "claude_project", "codex_project", "grok_project", "pi_project"];

/// These settings write on This Mac; merged remote projects are not local destinations.
export function mcpTargets(sources: McpSource[], projects: Project[]): McpTarget[] {
  const owners = new Set(sources.map((source) => source.owner));
  const targets: McpTarget[] = sources.flatMap((source) => source.file && !MCP_PROJECT_FILES.includes(source.file)
    ? [{ file: source.file, project: null }] : []);
  for (const file of MCP_PROJECT_FILES) {
    if (!owners.has(MCP_FILE_OWNERS[file])) continue;
    for (const project of projects) {
      if (serverOfPath(project.path) === LOCAL) targets.push({ file, project: project.path });
    }
  }
  return targets;
}

/// Pi state-only overrides edit their user definition, without copying credentials into project config.
export function mcpEditTarget(source: McpSource, server: McpServerEntry, sources: McpSource[]): { target: McpTarget; server: McpServerEntry } | null {
  if (server.inherited) {
    const global = sources.find((item) => item.file === "pi_user");
    const definition = global?.servers.find((entry) => entry.name === server.name);
    return definition ? { target: { file: "pi_user", project: null }, server: definition } : null;
  }
  return source.file ? { target: { file: source.file, project: source.project }, server } : null;
}
