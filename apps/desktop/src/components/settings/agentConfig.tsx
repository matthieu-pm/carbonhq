import type { ReactNode } from "react";

import AgentIcon from "@/components/AgentIcon";
import { CheckOutline12, ChevronDownOutline12 } from "@/components/icons/nucleo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Harness } from "@/types/events";

/// Shared by the MCP and Skills tabs, which both list what an agent loads
/// grouped by the file or folder it lives in.

/// The agents' names as Rust's `Harness::label` gives them.
export const AGENT_NAMES: Record<Harness, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  pi: "pi",
  fx: "fx",
  grok: "Grok Build",
};

/// The order groups are drawn in: the agents the most readers run first.
export const AGENT_ORDER: Harness[] = ["claude_code", "codex", "grok", "fx", "pi"];

/// "a, b and c", for a sentence naming agents.
export function listNames(harnesses: Harness[]): string {
  const names = harnesses.map((h) => AGENT_NAMES[h]);
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/// `~` for the home directory, which is the part of every path here that says
/// nothing. Read off the path's own shape, since the frontend is never told
/// the home directory.
export function tildePath(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~");
}

/// A path inside a project, said from the project: `carbonhq/.mcp.json`.
export function projectPath(path: string, project: string): string {
  const name = baseName(project);
  return path.startsWith(`${project}/`) ? `${name}/${path.slice(project.length + 1)}` : tildePath(path);
}

export function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/// Every agent that loads a file or folder, as their marks, with the sentence
/// in a tooltip. Marks rather than names, since a group is often read by three
/// or four agents and their names would push the path off the line.
export function Readers({ harnesses }: { harnesses: Harness[] }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground" aria-label={`Loaded by ${listNames(harnesses)}`}>
          {harnesses.map((h) => (
            <AgentIcon key={h} harness={h} className="size-3.5" />
          ))}
        </span>
      </TooltipTrigger>
      <TooltipContent>Loaded by {listNames(harnesses)}</TooltipContent>
    </Tooltip>
  );
}

/// One group's heading: what it is, where it lives, and who reads it.
export function GroupHeader({
  icon,
  title,
  detail,
  readers,
  trailing,
}: {
  icon: ReactNode;
  title: string;
  detail?: string;
  readers?: Harness[];
  trailing?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="shrink-0 text-ui font-medium">{title}</span>
      {detail && <span className="min-w-0 truncate text-ui text-muted-foreground">{detail}</span>}
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {trailing}
        {readers && readers.length > 0 && <Readers harnesses={readers} />}
      </span>
    </div>
  );
}

export const FIELD = "flex flex-col gap-1.5 @md:flex-row @md:gap-3";
export const FIELD_LABEL = "text-ui text-muted-foreground @md:w-24 @md:shrink-0 @md:pt-1.5";

/// A dropdown standing in for a select, with a mark on the current pick.
export function Picker<T extends string>({
  label,
  value,
  items,
  onPick,
  disabled,
  placeholder = "Pick one",
}: {
  label: string;
  value: T | null;
  items: { id: T; label: string; detail?: string; icon?: ReactNode }[];
  onPick: (id: T) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const current = items.find((item) => item.id === value);
  return (
    <div className={FIELD}>
      <span className={FIELD_LABEL}>{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            aria-label={label}
            className="min-w-0 flex-1 justify-between font-normal"
          >
            <span className={cn("flex min-w-0 items-center gap-1.5", !current && "text-muted-foreground")}>
              {current?.icon}
              <span className="truncate">{current?.label ?? placeholder}</span>
              {current?.detail && <span className="truncate text-muted-foreground">{current.detail}</span>}
            </span>
            <ChevronDownOutline12 className="size-3 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 w-auto min-w-(--radix-dropdown-menu-trigger-width) overflow-y-auto"
        >
          {items.map((item) => (
            <DropdownMenuItem key={item.id} onSelect={() => onPick(item.id)} className="cursor-pointer">
              {item.icon}
              <span className="truncate">{item.label}</span>
              {item.detail && <span className="truncate text-muted-foreground">{item.detail}</span>}
              {item.id === value && <CheckOutline12 className="ml-auto size-3 shrink-0" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/// A placeholder row for a group with nothing in it, or a sentence about why.
export function Quiet({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" }) {
  return (
    <p className={cn("py-1 pl-6 text-ui", tone === "error" ? "text-destructive" : "text-muted-foreground")}>
      {children}
    </p>
  );
}
