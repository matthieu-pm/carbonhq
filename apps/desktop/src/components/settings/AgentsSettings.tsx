import { useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import AgentIcon from "@/components/AgentIcon";
import { DotsOutline12, PenOutline12, PlusOutline12, RefreshClockwiseOutline12, TrashOutline12 } from "@/components/icons/nucleo";
import { ServerPicker } from "@/components/settings/AccountsSettings";
import { CancelOrConfirm } from "@/components/settings/InRowConfirm";
import SettingsHeaderAction from "@/components/settings/headerAction";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import Spinner from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { loadAcpAgents, removeCustomAcpAgent, saveCustomAcpAgent, setAcpAgentEnabled, setAcpAgentExecutable, useAcpAgents, useAcpAgentStatus } from "@/lib/acpAgents";
import { useServers } from "@/lib/servers";
import { LOCAL, serverOfPath, type ServerId } from "@/lib/transport";
import type { AcpAgent, CustomAgent } from "@/types/events";

const AREA = "min-h-16 rounded-lg border border-input bg-transparent px-3 py-2 font-mono text-ui outline-none placeholder:text-muted-foreground focus-visible:border-ring";

export default function AgentsSettings({ cwd }: { cwd: string }) {
  const servers = useServers();
  const [server, setServer] = useState<ServerId>(() => serverOfPath(cwd));
  const agents = useAcpAgents(server);
  const status = useAcpAgentStatus(server);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return agents.filter((a) => `${a.name} ${a.id} ${a.description} ${a.package ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || Number(b.ready) - Number(a.ready) || a.name.localeCompare(b.name));
  }, [agents, query]);
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try { await action(); } catch (cause) { setError(String(cause)); }
  };
  const refresh = () => void run(() => loadAcpAgents(true, server));

  return (
    <div className="flex flex-col gap-4">
      <SettingsHeaderAction>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Refresh agents" className="ml-auto" disabled={status.loading} onClick={refresh}>
              {status.loading ? <Spinner className="size-3.5" /> : <RefreshClockwiseOutline12 className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh agents</TooltipContent>
        </Tooltip>
      </SettingsHeaderAction>
      {servers.length > 0 && <ServerPicker label="Agents on" value={server} options={[LOCAL, ...servers.map((s) => s.id)]} onPick={(next) => { setServer(next); setAdding(false); setError(null); }} />}
      <div className="flex items-center gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter agents" aria-label="Filter agents" className="h-8" />
        {!adding && <Button variant="outline" size="sm" onClick={() => setAdding(true)}><PlusOutline12 className="size-3.5" />Add agent</Button>}
      </div>
      {(error || status.error) && (
        <div role="alert" className="flex items-start gap-2 text-ui">
          <p className="min-w-0 flex-1 break-words text-destructive">{error ?? status.error}</p>
          <Button variant="ghost" size="sm" disabled={status.loading} onClick={refresh}>Retry</Button>
        </div>
      )}
      {adding && <CustomAgentForm key={server} agents={agents} onCancel={() => setAdding(false)} onSave={async (agent) => { await saveCustomAcpAgent(agent, server); setAdding(false); }} />}
      <div className="flex flex-col">
        {shown.map((agent) => <AgentRow key={`${server}:${agent.harness}`} agent={agent} server={server} onToggle={(on) => run(() => setAcpAgentEnabled(agent.harness, on, server))} onRemove={() => run(() => removeCustomAcpAgent(agent.id, server))} />)}
        {!shown.length && <p className="py-2 text-ui text-muted-foreground">{status.loading && !agents.length ? "Loading agents…" : agents.length ? "No agents match your search." : "No ACP agents are available on this server."}</p>}
      </div>
    </div>
  );
}

function AgentRow({ agent, server, onToggle, onRemove }: { agent: AcpAgent; server: ServerId; onToggle: (on: boolean) => Promise<void>; onRemove: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState(agent.executable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  };
  const saveExecutable = async (value: string | null) => {
    await setAcpAgentExecutable(agent.id, value, server);
    setEditing(false);
  };
  const status = !agent.supported ? "Not available for this platform" : agent.package ? agent.ready ? "Ready to download" : `${agent.runner} is missing` : agent.installed ? "Installed" : "Executable not found";

  return (
    <div className="flex flex-col border-b border-border py-2.5 last:border-b-0">
      <div className="flex items-start gap-3">
        <AgentIcon harness={agent.harness} server={server} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="flex flex-wrap items-center gap-x-2 text-ui"><span className="font-medium">{agent.name}</span><span className="text-muted-foreground">{status}</span></p>
          {agent.description && <p className="line-clamp-2 text-ui text-muted-foreground">{agent.description}</p>}
          {agent.package ? <><p className="break-words text-ui text-muted-foreground">Runs <span className="font-mono">{agent.package}</span> with {agent.runner}.</p><p className="text-ui text-muted-foreground">First launch downloads it if it is not cached.</p></> : agent.executable && <p className="truncate font-mono text-xs text-muted-foreground" title={agent.executable}>{agent.executable}</p>}
          {!agent.ready && agent.website && <button type="button" className="w-fit cursor-pointer text-ui text-foreground underline-offset-4 hover:underline" onClick={() => void openUrl(agent.website!)}>Get {agent.name}</button>}
        </div>
        {confirming ? <CancelOrConfirm verb="Remove" autoFocus onCancel={() => setConfirming(false)} onConfirm={() => void run(onRemove)} /> : <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`${agent.name} options`} disabled={busy}><DotsOutline12 className="size-3.5" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!agent.custom && <DropdownMenuItem onSelect={() => { setCommand(agent.package ? "" : agent.executable); setEditing(true); }}><PenOutline12 className="size-3" />Choose executable</DropdownMenuItem>}
              {agent.overridden && <DropdownMenuItem onSelect={() => void run(() => saveExecutable(null))}><RefreshClockwiseOutline12 className="size-3" />Use catalog command</DropdownMenuItem>}
              {agent.custom && <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}><TrashOutline12 className="size-3" />Remove</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
          <Switch aria-label={`Show ${agent.name} in the agent picker`} checked={agent.enabled} disabled={busy || (!agent.supported && !agent.enabled)} onCheckedChange={(on) => void run(() => onToggle(on))} />
        </div>}
      </div>
      {editing && <form className="mt-2 flex flex-col gap-2 pl-7" onSubmit={(event) => { event.preventDefault(); void run(() => saveExecutable(command.trim())); }}>
        <label className="flex flex-col gap-1 text-ui">Executable<Input autoFocus value={command} onChange={(event) => setCommand(event.target.value)} placeholder="/path/to/agent" className="font-mono" /></label>
        <p className="text-ui text-muted-foreground">Uses this installed executable with the agent’s ACP arguments.</p>
        <div className="flex justify-end gap-1.5"><Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button><Button type="submit" size="sm" disabled={busy || !command.trim()}>{busy ? "Saving…" : "Save"}</Button></div>
      </form>}
      {error && <p role="alert" className="mt-1 pl-7 text-ui text-destructive">{error}</p>}
    </div>
  );
}

function CustomAgentForm({ agents, onSave, onCancel }: { agents: AcpAgent[]; onSave: (agent: CustomAgent) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const collision = agents.some((agent) => agent.id === id);
  const validId = /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
  const env: Record<string, string> = {};
  let envError: string | null = null;
  for (const line of envText.split(/\r?\n/).filter((line) => line.trim())) {
    const equal = line.indexOf("=");
    const key = line.slice(0, equal).trim();
    if (equal < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { envError = "Use one KEY=value per line for environment variables."; break; }
    env[key] = line.slice(equal + 1);
  }
  const valid = name.trim() && command.trim() && validId && !collision && !envError;
  return (
    <form className="flex flex-col gap-3 rounded-xl border border-border p-3" onSubmit={async (event) => {
      event.preventDefault();
      if (!valid || saving) return;
      setSaving(true); setError(null);
      try { await onSave({ id, name: name.trim(), command: command.trim(), args: argsText.split(/\r?\n/).filter((arg) => arg.length > 0), env }); } catch (cause) { setError(String(cause)); } finally { setSaving(false); }
    }}>
      <label className="flex flex-col gap-1 text-ui">Name<Input autoFocus value={name} onChange={(event) => { const value = event.target.value; setName(value); if (!idEdited) setId(value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64)); }} placeholder="My agent" /></label>
      <label className="flex flex-col gap-1 text-ui">ID<Input value={id} onChange={(event) => { setIdEdited(true); setId(event.target.value); }} className="font-mono" placeholder="my-agent" /></label>
      {(collision || (id && !validId)) && <p className="text-ui text-destructive">{collision ? "This ID is already in use. Choose another." : "Use up to 64 lowercase letters, numbers and dashes."}</p>}
      <label className="flex flex-col gap-1 text-ui">Executable<Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="/path/to/agent" className="font-mono" /></label>
      <label className="flex flex-col gap-1 text-ui">Arguments <span className="text-muted-foreground">One argument per line. Spaces stay inside the argument.</span><textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={2} className={AREA} placeholder="--acp" /></label>
      <label className="flex flex-col gap-1 text-ui">Environment <span className="text-muted-foreground">Optional. One KEY=value per line.</span><textarea value={envText} onChange={(event) => setEnvText(event.target.value)} rows={2} className={AREA} /></label>
      {(error || envError) && <p role="alert" className="text-ui text-destructive">{error ?? envError}</p>}
      <div className="flex justify-end gap-1.5"><Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>Cancel</Button><Button type="submit" size="sm" disabled={!valid || saving}>{saving ? "Adding…" : "Add agent"}</Button></div>
    </form>
  );
}
