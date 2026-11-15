import { useLayoutEffect, useRef } from "react";
import { ChevronLeftIcon, ChevronRightIcon, Square3Stack3DIcon } from "@heroicons/react/20/solid";
import ProfileIcon from "@/components/ProfileIcon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { profileAppearance, type ProfileAppearances } from "@/lib/profileAppearance";
import { cn } from "@/lib/utils";

/// Fades only edges with hidden icons, leaving a short list clear.
function fade(track: HTMLDivElement) {
  const left = track.scrollLeft > 1;
  const right = track.scrollWidth - track.clientWidth - track.scrollLeft > 1;
  track.style.maskImage = `linear-gradient(to right, ${left ? "transparent, black 12px" : "black, black 12px"}, ${right ? "black calc(100% - 12px), transparent" : "black calc(100% - 12px), black"})`;
}

/// Scrolls only the icon strip, and only when the reached icon is clipped.
function reveal(track: HTMLDivElement, button: HTMLElement, smooth = false) {
  const viewport = track.getBoundingClientRect();
  const tile = button.getBoundingClientRect();
  const delta = tile.left < viewport.left + 12 ? tile.left - viewport.left - 12
    : tile.right > viewport.right - 12 ? tile.right - viewport.right + 12 : 0;
  if (delta) track.scrollTo({ left: track.scrollLeft + delta, behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "instant" });
  fade(track);
}

/// The chevrons switch profiles; the strip follows the current icon.
export default function ProfileSwitcher({ profiles, appearances, value, onChange }: {
  profiles: string[];
  appearances: ProfileAppearances;
  value: string | null;
  onChange: (name: string | null) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const animate = useRef(false);
  const entries = [null, ...profiles];
  const index = Math.max(0, entries.indexOf(value));
  const profileKey = JSON.stringify(profiles);

  useLayoutEffect(() => {
    const node = track.current;
    const current = node?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (node && current) reveal(node, current, animate.current);
    animate.current = false;
  }, [value, profileKey]);

  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    let width = node.clientWidth;
    const observer = new ResizeObserver(() => {
      if (node.clientWidth === width) return;
      width = node.clientWidth;
      const current = node.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (current) reveal(node, current);
      else fade(node);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const pick = (name: string | null, pointer: boolean) => {
    if (value === name) return;
    animate.current = pointer && Math.abs(entries.indexOf(name) - index) === 1;
    onChange(name);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
    const focused = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (focused < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (focused + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    const button = buttons[next];
    button?.focus({ preventScroll: true });
    if (track.current && button && track.current.contains(button)) reveal(track.current, button);
  };
  return (
    <div role="toolbar" aria-label="Profiles" onKeyDown={onKeyDown} className="flex min-w-0 shrink-0 items-center gap-1 px-2 py-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" tabIndex={-1} aria-label="Previous profile" disabled={entries.length < 2}
            onClick={(event) => pick(entries[(index - 1 + entries.length) % entries.length], event.detail > 0)}
            className="shrink-0 text-muted-foreground transition-none hover:text-foreground active:not-aria-[haspopup]:translate-y-0">
            <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Previous profile</TooltipContent>
      </Tooltip>
      <div ref={track} onScroll={(event) => fade(event.currentTarget)} className="scrollbar-none min-w-0 flex-1 overflow-x-auto overscroll-x-contain py-0.5">
        <div className="flex w-max min-w-full items-center justify-center gap-1 px-1">
          {entries.map((name, i) => (
            <Tooltip key={name === null ? "all" : `profile:${name}`}>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={name ?? "All Profiles"} aria-pressed={i === index}
                  tabIndex={i === index ? 0 : -1} onClick={(event) => pick(name, event.detail > 0)}
                  className={cn("shrink-0 text-muted-foreground transition-none active:not-aria-[haspopup]:translate-y-0 hover:bg-sidebar-accent/50 dark:hover:bg-sidebar-accent/50",
                    i === index && "bg-sidebar-accent text-foreground hover:bg-sidebar-accent dark:hover:bg-sidebar-accent")}>
                  {name === null ? <Square3Stack3DIcon aria-hidden="true" className="size-4" /> : <ProfileIcon appearance={profileAppearance(appearances, name)} className="size-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">{name ?? "All Profiles"}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" tabIndex={-1} aria-label="Next profile" disabled={entries.length < 2}
            onClick={(event) => pick(entries[(index + 1) % entries.length], event.detail > 0)}
            className="shrink-0 text-muted-foreground transition-none hover:text-foreground active:not-aria-[haspopup]:translate-y-0">
            <ChevronRightIcon aria-hidden="true" className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top">Next profile</TooltipContent>
      </Tooltip>
      <span className="sr-only" aria-live="polite" aria-atomic="true">{value === null ? "All Profiles" : `Profile: ${value}`}</span>
    </div>
  );
}
