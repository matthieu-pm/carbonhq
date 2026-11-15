import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentOptions, usePendingAgentOptions, pickAgentOption, clearAgentOptions, resetAgentOption, useAgentOptionNotice } from "@/lib/agentOptions";
import { invoke, type ServerId } from "@/lib/transport";
import type { Harness } from "@/types/events";

export default function AgentModeSelector({ server, harness, sessionId, locked = false }: {
  server: ServerId; harness: Harness; sessionId: string | null; locked?: boolean;
}) {
  const { options, error: readError, retry } = useAgentOptions(server, harness, sessionId);
  const notice = useAgentOptionNotice(server, harness);
  const pending = usePendingAgentOptions(server, harness);
  const [error, setError] = useState<string | null>(null);
  const [failedPick, setFailedPick] = useState<{ id: string; value: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const categories = ["model", "mode", "thought_level"];
  const categoryOrder = (category: string | null) => categories.includes(category ?? "") ? categories.indexOf(category!) : categories.length;
  const shown = options.filter((option) => option.pendingValue != null || (categories.includes(option.category ?? "") && option.options.length > 0))
    .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category));
  const choose = async (id: string, value: string) => {
    if (locked || saving) return;
    setError(null);
    setFailedPick(null);
    if (!sessionId) { pickAgentOption(server, harness, id, value); return; }
    setSaving(true);
    try { await invoke("set_agent_option", { sessionId, configId: id, value }, server); }
    catch (failure) { setError(String(failure)); setFailedPick({ id, value }); }
    finally { setSaving(false); }
  };
  const reset = async (configId: string) => {
    if (!sessionId || locked || saving) return;
    setSaving(true);
    try { await invoke("reset_agent_options", { sessionId, configId }, server); setError(null); setFailedPick(null); retry(); }
    catch (failure) { setError(String(failure)); }
    finally { setSaving(false); }
  };
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-0.5">
        {shown.map((option) => {
          const value = (!sessionId ? pending[option.id] : null) ?? option.pendingValue ?? option.currentValue ?? "";
          const selected = option.options.find((choice) => choice.value === value);
          return (
            <div key={option.id} className="flex min-w-0 flex-col">
            <DropdownMenu open={openId === option.id && !locked} onOpenChange={(open) => setOpenId(open && !locked && !saving ? option.id : null)}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className={`px-1.5 text-ui text-muted-foreground ${locked || saving ? "opacity-50" : ""}`} aria-disabled={locked || saving} disabled={option.options.length < 2 && option.pendingValue == null} aria-label={option.name}>
                      {selected?.name ?? selected?.value ?? (value || option.name)}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{locked ? "Agent settings cannot change during a turn" : option.pendingValue != null ? `${option.name} · Not applied` : `${option.name}${!sessionId ? " · Last seen; confirmed when the session opens" : ""}`}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="max-w-72">
                {!sessionId && pending[option.id] !== undefined && <DropdownMenuItem onSelect={() => resetAgentOption(server, harness, option.id)}>Use agent default</DropdownMenuItem>}
                {sessionId && option.pendingValue != null && <DropdownMenuItem onSelect={() => void reset(option.id)} disabled={locked || saving}>Discard pick</DropdownMenuItem>}
                <DropdownMenuRadioGroup value={value} onValueChange={(next) => void choose(option.id, next)}>
                  {option.options.map((choice) => (
                    <DropdownMenuRadioItem key={choice.value} value={choice.value} className="text-ui">
                      <span className="flex flex-col">{choice.name ?? choice.value}{choice.description && <span className="text-xs text-muted-foreground">{choice.description}</span>}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {option.rejection && <p role="alert" className="max-w-72 text-xs text-destructive">{option.rejection}</p>}
            </div>
          );
        })}
        {!sessionId && Object.keys(pending).length > 0 && <Button variant="ghost" size="sm" onClick={() => clearAgentOptions(server, harness)}>Use agent default</Button>}
      </div>
      {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
      {!sessionId && Object.entries(pending).filter(([id, value]) => !options.some((option) => option.id === id && option.options.some((choice) => choice.value === value))).map(([id, value]) => <div key={id} className="flex items-center gap-1 text-xs text-destructive"><span>{value}{options.length ? " is no longer offered." : " selected; confirmed when the session opens."}</span><Button variant="ghost" size="sm" onClick={() => resetAgentOption(server, harness, id)}>Use agent default</Button></div>)}
      {(error || readError) && <div role="alert" className="flex items-center gap-1 text-xs text-destructive"><span>{error ?? readError}</span><Button variant="ghost" size="sm" disabled={locked || saving} onClick={() => failedPick ? void choose(failedPick.id, failedPick.value) : retry()}>Retry</Button></div>}
    </div>
  );
}
