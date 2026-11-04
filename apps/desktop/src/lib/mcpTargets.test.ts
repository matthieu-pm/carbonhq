import { describe, expect, it } from "vitest";
import { mcpTargets } from "./mcpTargets";
import type { McpSource, Project } from "@/types/events";

const source: McpSource = { id: "pi", file: "pi_user", owner: "pi", readers: ["pi"], project: null,
  path: "/Users/me/.pi/agent/mcp.json", label: null, servers: [], error: null, transports: ["stdio", "http"] };
const project = (path: string): Project => ({ path, name: "app", space: null, lastSelected: "" });

describe("MCP destinations", () => {
  it("keeps remote projects out of the local writer's picker", () => {
    expect(mcpTargets([source], [project("/Users/me/app"), project("carbon://vps/root/app")])).toEqual([
      { file: "pi_user", project: null }, { file: "pi_project", project: "/Users/me/app" },
    ]);
  });
  it("offers all attached local projects regardless of active space", () => {
    const projects = [project("/one/app"), { ...project("/two/app"), space: "other" }];
    expect(mcpTargets([source], projects).filter((t) => t.project).map((t) => t.project)).toEqual(["/one/app", "/two/app"]);
  });
});

it("edits a Pi override's global definition while leaving its project row unchanged", async () => {
  const { mcpEditTarget } = await import("./mcpTargets");
  const definition = { name: "docs", transport: "http" as const, command: null, args: [], env: [], url: "https://example.com/mcp",
    headers: [{ name: "Authorization", value: "private" }], enabled: true, inherited: false };
  const override = { ...definition, url: null, headers: [], enabled: false, inherited: true };
  const projectSource: McpSource = { ...source, id: "project", file: "pi_project", project: "/project", servers: [override] };
  const globalSource: McpSource = { ...source, servers: [definition] };
  expect(mcpEditTarget(projectSource, override, [globalSource, projectSource])).toEqual({ target: { file: "pi_user", project: null }, server: definition });
  expect(override.headers).toEqual([]);
  expect(mcpEditTarget(projectSource, override, [projectSource])).toBeNull();
});
