import { useMemo, useState } from "react";

import AgentIcon from "@/components/AgentIcon";
import {
  ArrowLeftOutline12,
  CircleWarningOutline12,
  DotsOutline12,
  EyeOutline18,
  EyeSlashOutline18,
  LockOutline12,
  PenOutline12,
  PlusOutline12,
  RefreshClockwiseOutline12,
  TrashOutline12,
  XmarkOutline12,
} from "@/components/icons/nucleo";
import {
  AGENT_NAMES,
  AGENT_ORDER,
  FIELD,
  FIELD_LABEL,
  GroupHeader,
  Picker,
  projectPath,
  Quiet,
  tildePath,
  baseName,
} from "@/components/settings/agentConfig";
import SettingsHeaderAction from "@/components/settings/headerAction";
import { CancelOrConfirm } from "@/components/settings/InRowConfirm";
import McpLogo from "@/components/settings/McpLogo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { inputClassName } from "@/components/ui/input";
import Spinner from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";
import { useMcpServers } from "@/hooks/useMcpServers";
import { cn } from "@/lib/utils";
import type {
  Harness,
  KeyValue,
  McpFile,
  McpServerEntry,
  McpSource,
  McpStatus,
  McpTarget,
  McpTransport,
  Project,
} from "@/types/events";

/// Which file a server is written to, in the reader's words. Claude Code's
/// two project scopes differ in who sees them, which is the whole of what the
/// reader is choosing between, so the label says that rather than the flag.
const FILE_SCOPE: Record<McpFile, string> = {
  claude_user: "Global",
  claude_local: "Just you",
  claude_project: "Shared",
  codex: "Global",
  codex_project: "Project",
  grok_user: "Global",
  grok_project: "Project",
  fx: "Global",
};

const FILE_OWNER: Record<McpFile, Harness> = {
  claude_user: "claude_code",
  claude_local: "claude_code",
  claude_project: "claude_code",
  codex: "codex",
  codex_project: "codex",
  grok_user: "grok",
  grok_project: "grok",
  fx: "fx",
};

const PER_PROJECT: McpFile[] = ["claude_local", "claude_project", "codex_project", "grok_project"];

/// Mirrors `McpFile::transports`: Codex and grok have no SSE spelling.
function transportsOf(file: McpFile): McpTransport[] {
  return file === "codex" || file === "codex_project" || file === "grok_user" || file === "grok_project"
    ? ["stdio", "http"]
    : ["stdio", "http", "sse"];
}

const TRANSPORT_LABEL: Record<McpTransport, string> = {
  stdio: "Local",
  http: "HTTP",
  sse: "SSE",
};

/// Green, yellow, red and grey — the sidebar rail's pair plus the two this
/// page needs, so a dot here reads the way the Accounts tab's already do.
const STATUS: Record<McpStatus, { label: string; dot: string; hint?: string }> = {
  connected: { label: "Connected", dot: "bg-accent-add" },
  needs_auth: {
    label: "Needs sign-in",
    dot: "bg-accent-command",
    hint: "Sign in from the agent itself, with /mcp in Claude Code or its own mcp login command.",
  },
  failed: { label: "Failed to connect", dot: "bg-destructive" },
  disabled: { label: "Off", dot: "bg-muted-foreground/40" },
};

function statusKey(owner: Harness, project: string | null, name: string) {
  return `${owner}\n${project ?? ""}\n${name}`;
}

/// What a group is called: the agent, then where the file is.
function describe(source: McpSource): { title: string; detail: string } {
  const title = AGENT_NAMES[source.owner];
  if (!source.file) return { title, detail: source.label ?? "" };
  const scope = FILE_SCOPE[source.file];
  if (source.project) {
    return {
      title,
      detail: `${baseName(source.project)} · ${scope.toLowerCase()} · ${projectPath(source.path, source.project)}`,
    };
  }
  return { title, detail: `${scope} · ${tildePath(source.path)}` };
}

/// Where a write goes, as one key for a picker.
function targetKey(target: McpTarget) {
  return `${target.file}\n${target.project ?? ""}`;
}

function blankServer(transport: McpTransport): McpServerEntry {
  return { name: "", transport, command: "", args: [], env: [], url: "", headers: [], enabled: true };
}

/// Settings → MCP: every server each agent loads, grouped by the file it is
/// written in, and a form that adds, edits and removes them.
///
/// **Status is a second, slower read.** The list comes off the files and is
/// on screen at once; Claude Code's own `mcp list` connects to every server to
/// say which work, which takes seconds, so the dots fill in after it.
export default function McpSettings({ projects }: { projects: Project[] }) {
  const { sources, status, busy, checking, error, refresh, save, remove } = useMcpServers();
  const availability = useAgentAvailability();
  const [editing, setEditing] = useState<{ target: McpTarget; server: McpServerEntry | null } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const statuses = useMemo(() => {
    const map = new Map<string, McpStatus>();
    for (const row of status?.statuses ?? []) map.set(statusKey(row.owner, row.project, row.name), row.status);
    return map;
  }, [status]);

  const groups = useMemo(() => {
    const all = [...(sources ?? []), ...(status?.extras ?? [])];
    return all.sort((a, b) => {
      const byAgent = AGENT_ORDER.indexOf(a.owner) - AGENT_ORDER.indexOf(b.owner);
      if (byAgent) return byAgent;
      // Files before plugins, global before projects.
      const rank = (s: McpSource) => (!s.file ? 2 : s.project ? 1 : 0);
      return rank(a) - rank(b) || (a.project ?? "").localeCompare(b.project ?? "");
    });
  }, [sources, status]);

  /// Every file the form can write to: each global file listed, and every
  /// project-scoped kind for every attached project whose agent is here.
  const targets = useMemo(() => {
    const owners = new Set((sources ?? []).map((s) => s.owner));
    const out: McpTarget[] = [];
    for (const source of sources ?? []) {
      if (source.file && !PER_PROJECT.includes(source.file)) out.push({ file: source.file, project: null });
    }
    for (const file of PER_PROJECT) {
      if (!owners.has(FILE_OWNER[file])) continue;
      for (const project of projects) out.push({ file, project: project.path });
    }
    return out;
  }, [sources, projects]);

  const piInstalled = availability?.some((a) => a.harness === "pi" && a.available) ?? false;
  const statusError = (owner: Harness) => status?.errors.find((e) => e.harness === owner)?.error;

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeaderAction>
        {editing ? (
          <Button variant="ghost" size="icon-sm" aria-label="Back" className="-order-1" onClick={() => setEditing(null)}>
            <ArrowLeftOutline12 className="size-3.5" />
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto"
              disabled={targets.length === 0}
              onClick={() => {
                setConfirming(null);
                setEditing({ target: targets[0], server: null });
              }}
            >
              <PlusOutline12 className="size-3" />
              Add server
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh"
                  disabled={busy || checking}
                  onClick={refresh}
                >
                  {busy || checking ? (
                    <Spinner className="size-3.5" />
                  ) : (
                    <RefreshClockwiseOutline12 className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{checking ? "Checking connections…" : "Refresh"}</TooltipContent>
            </Tooltip>
          </>
        )}
      </SettingsHeaderAction>

      {error && <p className="text-ui text-destructive">{error}</p>}

      {editing ? (
        <ServerForm
          targets={targets}
          initialTarget={editing.target}
          server={editing.server}
          projects={projects}
          onCancel={() => setEditing(null)}
          onSave={async (target, server) => {
            await save(target, editing.server?.name ?? null, server);
            setEditing(null);
          }}
        />
      ) : sources === null ? (
        <div className="flex items-center gap-2 py-4 text-ui text-muted-foreground">
          <Spinner className="size-3.5" />
          Reading each agent's config&hellip;
        </div>
      ) : (
        <>
          {groups.map((source) => {
            const { title, detail } = describe(source);
            const readOnly = !source.file;
            const target: McpTarget | null = source.file ? { file: source.file, project: source.project } : null;
            const failed = statusError(source.owner);
            return (
              <section key={source.id} className="flex flex-col gap-1">
                <GroupHeader
                  icon={<AgentIcon harness={source.owner} className="size-4" />}
                  title={title}
                  detail={detail}
                  readers={source.readers.length > 1 ? source.readers : undefined}
                  trailing={
                    readOnly && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground" aria-label="Read-only">
                            <LockOutline12 className="size-3" />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {AGENT_NAMES[source.owner]} reports these; change them where they come from.
                        </TooltipContent>
                      </Tooltip>
                    )
                  }
                />
                {source.error ? (
                  <Quiet tone="error">Couldn't read this file: {source.error}</Quiet>
                ) : source.servers.length === 0 ? (
                  <Quiet>No servers yet.</Quiet>
                ) : (
                  source.servers.map((server) => {
                    const id = `${source.id}\n${server.name}`;
                    const projectKey = source.file && PER_PROJECT.includes(source.file) ? source.project : null;
                    const state = statuses.get(statusKey(source.owner, projectKey, server.name))
                      ?? (server.enabled ? undefined : "disabled");
                    return (
                      <ServerRow
                        key={id}
                        server={server}
                        status={state}
                        checking={checking && !status}
                        readOnly={readOnly}
                        confirming={confirming === id}
                        error={rowError?.id === id ? rowError.message : null}
                        onEdit={() => target && setEditing({ target, server })}
                        onAskRemove={() => {
                          setRowError(null);
                          setConfirming(id);
                        }}
                        onCancelRemove={() => setConfirming(null)}
                        onRemove={() => {
                          setConfirming(null);
                          if (!target) return;
                          remove(target, server.name).catch((err) => setRowError({ id, message: String(err) }));
                        }}
                      />
                    );
                  })
                )}
                {failed && source.file && !source.project && (
                  <Quiet>Couldn't ask {AGENT_NAMES[source.owner]} for status: {failed}</Quiet>
                )}
              </section>
            );
          })}

          {/* Disabled rather than missing, the settings page's rule: a reader
              who runs pi should learn here why it has no group. */}
          {piInstalled && (
            <section className="flex flex-col gap-1">
              <GroupHeader icon={<AgentIcon harness="pi" className="size-4" />} title="pi" />
              <Quiet>pi doesn't support MCP servers. It uses extensions instead.</Quiet>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/// One server: its mark, name and status, and what it runs or where it points.
function ServerRow({
  server,
  status,
  checking,
  readOnly,
  confirming,
  error,
  onEdit,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: {
  server: McpServerEntry;
  status: McpStatus | undefined;
  checking: boolean;
  readOnly: boolean;
  confirming: boolean;
  error: string | null;
  onEdit: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
}) {
  const target =
    server.transport === "stdio" ? [server.command, ...server.args].filter(Boolean).join(" ") : server.url ?? "";
  const shown = status ? STATUS[status] : null;

  return (
    <div className="flex flex-col">
      <div className="group/row flex items-center gap-2.5 rounded-lg py-1.5">
        <span className={cn("text-muted-foreground", !server.enabled && "opacity-50")}>
          <McpLogo server={server} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-ui">
            <span className={cn("truncate text-foreground", !server.enabled && "text-muted-foreground")}>
              {server.name}
            </span>
            {shown ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
                    <span aria-hidden className={cn("size-1.5 rounded-full", shown.dot)} />
                    {shown.label}
                  </span>
                </TooltipTrigger>
                {shown.hint && <TooltipContent className="max-w-64">{shown.hint}</TooltipContent>}
              </Tooltip>
            ) : (
              checking && <Spinner className="size-3 text-muted-foreground" />
            )}
          </p>
          <p className="truncate text-ui text-muted-foreground">
            {TRANSPORT_LABEL[server.transport]}
            {target && ` · ${tildePath(target)}`}
          </p>
        </div>

        {confirming ? (
          <CancelOrConfirm verb="Remove" onConfirm={onRemove} onCancel={onCancelRemove} autoFocus className="gap-1">
            <span className="text-ui text-muted-foreground">Remove {server.name}?</span>
          </CancelOrConfirm>
        ) : (
          !readOnly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${server.name} options`}>
                  <DotsOutline12 className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-36">
                <DropdownMenuItem onSelect={onEdit}>
                  <PenOutline12 className="size-3" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={onAskRemove}>
                  <TrashOutline12 className="size-3" />
                  Remove
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        )}
      </div>
      {error && (
        <p className="flex items-center gap-1.5 pb-1 pl-6.5 text-ui text-destructive">
          <CircleWarningOutline12 className="size-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/// Add or edit one server. The file is fixed once a server exists — moving it
/// between agents is an add in one and a remove in the other, which is two
/// decisions and not one edit.
function ServerForm({
  targets,
  initialTarget,
  server,
  projects,
  onCancel,
  onSave,
}: {
  targets: McpTarget[];
  initialTarget: McpTarget;
  server: McpServerEntry | null;
  projects: Project[];
  onCancel: () => void;
  onSave: (target: McpTarget, server: McpServerEntry) => Promise<void>;
}) {
  const [target, setTarget] = useState<McpTarget>(initialTarget);
  const [draft, setDraft] = useState<McpServerEntry>(() => server ?? blankServer("stdio"));
  const [argsText, setArgsText] = useState(() => (server?.args ?? []).join("\n"));
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const transports = transportsOf(target.file);
  const transport = transports.includes(draft.transport) ? draft.transport : "stdio";
  const local = transport === "stdio";
  const ready =
    draft.name.trim().length > 0 &&
    (local ? (draft.command ?? "").trim().length > 0 : /^https?:\/\/\S+$/.test((draft.url ?? "").trim()));

  const projectName = (path: string | null) =>
    path ? (projects.find((p) => p.path === path)?.name ?? baseName(path)) : null;
  const items = targets.map((t) => ({
    id: targetKey(t),
    label: AGENT_NAMES[FILE_OWNER[t.file]],
    detail: [projectName(t.project), FILE_SCOPE[t.file]].filter(Boolean).join(" · "),
    icon: <AgentIcon harness={FILE_OWNER[t.file]} className="size-3.5 text-muted-foreground" />,
  }));

  return (
    <form
      className="@container flex flex-col gap-3 rounded-xl border border-border/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || saving) return;
        setSaving(true);
        setFailure(null);
        const args = argsText.split("\n").filter((a) => a.length > 0);
        const clean = (list: KeyValue[]) => list.filter((kv) => kv.name.trim()).map((kv) => ({ ...kv, name: kv.name.trim() }));
        onSave(target, {
          ...draft,
          transport,
          args: local ? args : [],
          command: local ? (draft.command ?? "").trim() : null,
          url: local ? null : (draft.url ?? "").trim(),
          env: local ? clean(draft.env) : [],
          headers: local ? [] : clean(draft.headers),
        })
          .catch((err) => setFailure(String(err)))
          .finally(() => setSaving(false));
      }}
    >
      <span className="text-ui font-medium">{server ? `Edit ${server.name}` : "Add an MCP server"}</span>

      <Picker
        label="Agent"
        value={targetKey(target)}
        items={items}
        disabled={server !== null}
        onPick={(key) => {
          const next = targets.find((t) => targetKey(t) === key);
          if (next) setTarget(next);
        }}
      />
      <p className="-mt-1.5 text-ui text-muted-foreground @md:pl-27">{whereItGoes(target)}</p>

      <label className={FIELD}>
        <span className={FIELD_LABEL}>Name</span>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="linear"
          className={cn(inputClassName, "min-w-0 flex-1")}
          autoComplete="off"
          spellCheck={false}
          autoFocus={!server}
        />
      </label>

      <div className={FIELD}>
        <span className={FIELD_LABEL}>Type</span>
        <div role="radiogroup" aria-label="Transport" className="flex gap-1">
          {transports.map((t) => (
            <Button
              key={t}
              type="button"
              role="radio"
              aria-checked={t === transport}
              variant={t === transport ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setDraft({ ...draft, transport: t })}
            >
              {t === "stdio" ? "Local command" : t === "http" ? "HTTP" : "SSE"}
            </Button>
          ))}
        </div>
      </div>

      {local ? (
        <>
          <label className={FIELD}>
            <span className={FIELD_LABEL}>Command</span>
            <input
              value={draft.command ?? ""}
              onChange={(e) => setDraft({ ...draft, command: e.target.value })}
              placeholder="npx"
              className={cn(inputClassName, "min-w-0 flex-1 font-mono")}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className={FIELD}>
            <span className={FIELD_LABEL}>Arguments</span>
            <textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              placeholder={"-y\n@modelcontextprotocol/server-filesystem\n~/Documents"}
              rows={Math.min(6, Math.max(2, argsText.split("\n").length))}
              className={cn(inputClassName, "h-auto min-w-0 flex-1 resize-none py-1.5 font-mono")}
              spellCheck={false}
            />
          </label>
          <p className="-mt-1.5 text-ui text-muted-foreground @md:pl-27">One per line.</p>
          <PairsField
            label="Environment"
            noun="variable"
            pairs={draft.env}
            onChange={(env) => setDraft({ ...draft, env })}
          />
        </>
      ) : (
        <>
          <label className={FIELD}>
            <span className={FIELD_LABEL}>URL</span>
            <input
              value={draft.url ?? ""}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              placeholder="https://mcp.example.com/mcp"
              className={cn(inputClassName, "min-w-0 flex-1 font-mono")}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <PairsField
            label="Headers"
            noun="header"
            pairs={draft.headers}
            onChange={(headers) => setDraft({ ...draft, headers })}
          />
        </>
      )}

      {failure && (
        <p className="flex items-start gap-1.5 text-ui text-destructive">
          <CircleWarningOutline12 className="mt-0.5 size-3 shrink-0" />
          {failure}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto text-ui text-muted-foreground">New sessions pick this up.</span>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" size="sm" disabled={!ready || saving}>
          {saving && <Spinner className="size-3" />}
          {server ? "Save" : "Add server"}
        </Button>
      </div>
    </form>
  );
}

/// The sentence under the agent picker: which file, and who else reads it.
function whereItGoes(target: McpTarget): string {
  switch (target.file) {
    case "claude_user":
      return "Written to ~/.claude.json, for every project. Grok Build loads it too.";
    case "claude_local":
      return "Written to ~/.claude.json under this project, for you alone.";
    case "claude_project":
      return "Written to the project's .mcp.json, which teammates get with the repo. Grok Build loads it too.";
    case "codex":
      return "Written to ~/.codex/config.toml.";
    case "codex_project":
      return "Written to the project's .codex/config.toml. Codex loads it when the project is trusted.";
    case "grok_user":
      return "Written to ~/.grok/config.toml.";
    case "grok_project":
      return "Written to the project's .grok/config.toml.";
    case "fx":
      return "Written to ~/.fx/mcp.json, the list Carbon hands fx.";
  }
}

/// Env vars or headers: a name and a value per row, the value masked until
/// the reader asks to see it, since these are where tokens live.
function PairsField({
  label,
  noun,
  pairs,
  onChange,
}: {
  label: string;
  noun: string;
  pairs: KeyValue[];
  onChange: (pairs: KeyValue[]) => void;
}) {
  const set = (i: number, next: Partial<KeyValue>) =>
    onChange(pairs.map((kv, j) => (j === i ? { ...kv, ...next } : kv)));

  return (
    <div className={FIELD}>
      <span className={FIELD_LABEL}>{label}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {pairs.map((kv, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={kv.name}
              onChange={(e) => set(i, { name: e.target.value })}
              placeholder={noun === "header" ? "Authorization" : "API_KEY"}
              aria-label={`${noun} name`}
              className={cn(inputClassName, "w-2/5 font-mono")}
              autoComplete="off"
              spellCheck={false}
            />
            <SecretInput value={kv.value} onChange={(value) => set(i, { value })} label={`${noun} value`} />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${noun}`}
              className="text-muted-foreground hover:text-foreground"
              onClick={() => onChange(pairs.filter((_, j) => j !== i))}
            >
              <XmarkOutline12 className="size-3" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          onClick={() => onChange([...pairs, { name: "", value: "" }])}
        >
          <PlusOutline12 className="size-3" />
          Add {noun}
        </Button>
      </div>
    </div>
  );
}

function SecretInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative min-w-0 flex-1">
      <input
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(inputClassName, "pr-8 font-mono")}
        autoComplete="off"
        spellCheck={false}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={shown ? "Hide value" : "Show value"}
            onClick={() => setShown(!shown)}
            className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            {shown ? <EyeSlashOutline18 className="size-3.5" /> : <EyeOutline18 className="size-3.5" />}
          </button>
        </TooltipTrigger>
        <TooltipContent>{shown ? "Hide" : "Show"}</TooltipContent>
      </Tooltip>
    </div>
  );
}
