import type { Ref } from "react";
import { Search } from "lucide-react";

import ShortcutKeys from "@/components/ShortcutKeys";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

export const sidebarRow = "w-full justify-start px-1.5 text-ui text-sidebar-foreground/80 transition-none hover:bg-sidebar-accent/50 hover:text-sidebar-foreground/80 active:not-aria-[haspopup]:translate-y-0 dark:hover:bg-sidebar-accent/50";

export function SidebarSearch({ open, onOpenChange, value, onChange, label, id, inputRef }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onChange: (value: string) => void;
  label: string;
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  if (!open) return (
    <Button variant="ghost" size="sm" onClick={() => onOpenChange(true)} className={sidebarRow} aria-label={label}>
      <Search />Search
      <ShortcutKeys ids={["search"]} className="ml-auto" />
    </Button>
  );
  return (
    <div className="group flex h-7 w-full items-center gap-1 border border-transparent px-1.5 text-ui">
      <Search className="size-3.5 shrink-0" />
      <input ref={inputRef} autoFocus id={id} type="text" value={value} placeholder="Search" aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onOpenChange(false);
          onChange("");
        }}
        onBlur={() => { if (!value) onOpenChange(false); }}
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
      />
      {value && <Kbd className="hidden group-focus-within:inline-flex">Esc</Kbd>}
      <ShortcutKeys ids={["search"]} className="group-focus-within:hidden" />
    </div>
  );
}
