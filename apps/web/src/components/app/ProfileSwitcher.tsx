"use client";

import { BriefcaseIcon, ChevronLeftIcon, ChevronRightIcon, HomeIcon, Square3Stack3DIcon } from "@heroicons/react/20/solid";
import type { KeyboardEvent, ReactNode } from "react";

const profiles = [
  { name: "All Profiles", icon: Square3Stack3DIcon, color: "" },
  { name: "Work", icon: BriefcaseIcon, color: "text-[#159de0] light:text-[#0e8fd0]" },
  { name: "Personal", icon: HomeIcon, color: "text-[#e83f91]" },
] as const;

export type PreviewProfile = typeof profiles[number]["name"];

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
  const current = buttons.indexOf(event.target as HTMLButtonElement);
  if (current < 0) return;
  let next: number;
  switch (event.key) {
    case "ArrowLeft": next = (current + buttons.length - 1) % buttons.length; break;
    case "ArrowRight": next = (current + 1) % buttons.length; break;
    case "Home": next = 0; break;
    case "End": next = buttons.length - 1; break;
    default: return;
  }
  event.preventDefault();
  buttons[next].focus({ preventScroll: true });
}

export function ProfileSwitcher({ value = "All Profiles", onChange }: {
  value?: PreviewProfile;
  onChange?: (profile: PreviewProfile) => void;
}) {
  const index = profiles.findIndex(profile => profile.name === value);
  function control(label: string, icon: ReactNode, pick: PreviewProfile, selected?: boolean) {
    const look = "group/profile relative grid size-7 shrink-0 place-items-center rounded-md " +
      (selected ? "bg-sidebar-accent text-foreground" : "text-muted-foreground");
    if (!onChange) return <span key={label} className={look}>{icon}</span>;
    return (
      <button key={label} type="button" aria-label={label} aria-pressed={selected} tabIndex={selected ? 0 : -1}
        onClick={() => onChange?.(pick)} className={look + " hover:bg-sidebar-accent/50 focus-visible:outline-2"}>
        {icon}
        <span aria-hidden className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-ui text-foreground group-hover/profile:block group-focus-visible/profile:block">{label}</span>
      </button>
    );
  }

  return (
    <div role={onChange ? "toolbar" : undefined} aria-label={onChange ? "Profiles" : undefined} onKeyDown={onChange ? moveFocus : undefined}
      className="mt-auto flex h-10 shrink-0 items-center justify-between gap-1 px-2">
      {control("Previous profile", <ChevronLeftIcon className="size-3.5" />, profiles[(index + profiles.length - 1) % profiles.length].name)}
      <div className="flex items-center gap-1">
        {profiles.map(({ name, icon: Icon, color }) => control(name, <Icon className={"size-4 " + color} />, name, value === name))}
      </div>
      {control("Next profile", <ChevronRightIcon className="size-3.5" />, profiles[(index + 1) % profiles.length].name)}
      {onChange && <span className="sr-only" aria-live="polite">{value}</span>}
    </div>
  );
}
