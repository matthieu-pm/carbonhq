import { CodeXml } from "lucide-react";

import { DoodleOutline18 } from "@/components/icons/nucleo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const workspaces = [
  { name: "Coding", icon: CodeXml },
  { name: "Design", icon: DoodleOutline18 },
] as const;

export type Workspace = (typeof workspaces)[number]["name"];

export default function WorkspaceSwitch({ value, onChange }: {
  value: Workspace;
  onChange: (workspace: Workspace) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Workspace" data-tauri-drag-region="false" className="flex rounded-md bg-foreground/6">
      {workspaces.map(({ name, icon: Icon }) => (
        <Tooltip key={name}>
          <TooltipTrigger asChild>
            <label className="relative flex h-7 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground has-checked:bg-foreground/10 has-checked:text-foreground has-checked:ring-1 has-checked:ring-inset has-checked:ring-foreground/15 has-focus-visible:outline-2 has-focus-visible:outline-ring">
              <input type="radio" name="workspace" aria-label={`${name} workspace`}
                checked={value === name} onChange={() => onChange(name)}
                className="absolute inset-0 size-full cursor-pointer opacity-0" />
              <Icon aria-hidden className="pointer-events-none size-3.5" />
            </label>
          </TooltipTrigger>
          <TooltipContent side="bottom">{name} workspace</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
