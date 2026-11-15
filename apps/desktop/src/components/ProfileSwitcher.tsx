import { useLayoutEffect, useRef, useState } from "react";
import { EllipsisHorizontalIcon, Square3Stack3DIcon } from "@heroicons/react/20/solid";
import ProfileIcon from "@/components/ProfileIcon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { profileAppearance, type ProfileAppearances } from "@/lib/profileAppearance";
import { cn } from "@/lib/utils";

/// Keeps overflow in a menu so the session list never loses room to wrapped icons.
export default function ProfileSwitcher({ profiles, appearances, value, onChange }: {
  profiles: string[];
  appearances: ProfileAppearances;
  value: string | null;
  onChange: (name: string | null) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    setWidth(node.clientWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const capacity = Math.max(1, Math.floor((width - 65) / 32));
  const count = profiles.length <= capacity ? profiles.length : Math.max(0, capacity - 1);
  const visible = profiles.slice(0, count);
  const hidden = profiles.slice(count);
  const entries = [null, ...visible];
  const index = entries.indexOf(value);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const focused = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (focused < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (focused + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };
  return (
    <div ref={list} role="toolbar" aria-label="Profiles" onKeyDown={onKeyDown} className="flex shrink-0 items-center gap-1 border-t border-hairline px-3 py-1.5">
      <div className="flex items-center gap-1">
        {entries.map((name, i) => (
          <Tooltip key={name === null ? "all" : `profile:${name}`}>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm"
                aria-label={name ?? "All Profiles"} aria-pressed={value === name} tabIndex={i === index ? 0 : -1}
                onClick={() => { if (value !== name) onChange(name); }}
                className={cn("size-7 shrink-0 text-muted-foreground transition-none active:not-aria-[haspopup]:translate-y-0 hover:bg-sidebar-accent/50 dark:hover:bg-sidebar-accent/50",
                  value === name && "bg-sidebar-accent text-foreground hover:bg-sidebar-accent dark:hover:bg-sidebar-accent")}>
                {name === null ? <Square3Stack3DIcon aria-hidden="true" className="size-4" /> : <ProfileIcon appearance={profileAppearance(appearances, name)} className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">{name ?? "All Profiles"}</TooltipContent>
            {i === 0 && <span aria-hidden="true" className="mx-1 h-4 w-px bg-hairline" />}
          </Tooltip>
        ))}
      </div>
      {hidden.length > 0 && (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" tabIndex={index < 0 ? 0 : -1} aria-label={index < 0 ? `More profiles, current: ${value}` : "More profiles"} className={cn("size-7 shrink-0 text-muted-foreground", index < 0 && "bg-sidebar-accent text-foreground")}>
                  <EllipsisHorizontalIcon aria-hidden="true" className="size-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">{index < 0 ? value : "More profiles"}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" side="top" className="max-h-72 w-auto min-w-44 max-w-64 overflow-y-auto">
            <DropdownMenuRadioGroup value={value ?? ""} onValueChange={(name) => { if (name !== value) onChange(name); }}>
              {hidden.map((name) => (
                <DropdownMenuRadioItem key={name} value={name} className="gap-2">
                  <ProfileIcon appearance={profileAppearance(appearances, name)} className="size-4" />
                  <span className="min-w-0 truncate">{name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
