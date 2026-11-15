import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgentOptions, usePendingAgentOptions, pickAgentOption, clearAgentOptions } from "@/lib/agentOptions";
import { invoke, type ServerId } from "@/lib/transport";
import type { Harness } from "@/types/events";

export default function AgentModeSelector({ server, harness, sessionId, locked = false }: {
  server: ServerId; harness: Harness; sessionId: string | null; locked?: boolean;
}) {
  const { options, error: readError } = useAgentOptions(server, harness, sessionId);
  const pending = usePendingAgentOptions(server, harness);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const categories = ["model", "mode", "thought_level"];
  const shown = options.filter((option) => categories.includes(option.category ?? "") && option.options.length > 1)
    .sort((a, b) => categories.indexOf(a.category!) - categories.indexOf(b.category!));
  const choose = async (id: string, value: string) => {
    if (locked || saving) return;
    setError(null);
    if (!sessionId) { pickAgentOption(server, harness, id, value); return; }
    setSaving(true);
    try { await invoke("set_agent_option", { sessionId, configId: id, value }, server); }
    catch (failure) { setError(String(failure)); }
    finally { setSaving(false); }
  };
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-center gap-0.5">
        {shown.map((option) => {
          const value = (!sessionId ? pending[option.id] : null) ?? option.currentValue ?? "";
          const selected = option.options.find((choice) => choice.value === value);
          return (
            <DropdownMenu key={option.id} open={openId === option.id && !locked} onOpenChange={(open) => setOpenId(open && !locked && !saving ? option.id : null)}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="px-1.5 text-ui text-muted-foreground" aria-disabled={locked || saving} aria-label={option.name}>
                      {selected?.name ?? selected?.value ?? option.name}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>{locked ? "Agent settings cannot change during a turn" : `${option.name}${!sessionId ? " · Last seen; confirmed when the session opens" : ""}`}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="start" className="max-w-72">
                <DropdownMenuRadioGroup value={value} onValueChange={(next) => void choose(option.id, next)}>
                  {option.options.map((choice) => (
                    <DropdownMenuRadioItem key={choice.value} value={choice.value} className="text-ui">
                      <span className="flex flex-col">{choice.name ?? choice.value}{choice.description && <span className="text-xs text-muted-foreground">{choice.description}</span>}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
        {!sessionId && Object.keys(pending).length > 0 && <Button variant="ghost" size="sm" onClick={() => clearAgentOptions(server, harness)}>Use agent default</Button>}
      </div>
      {(error || readError) && <p role="alert" className="text-xs text-destructive">{error ?? readError}</p>}
    </div>
  );
}
