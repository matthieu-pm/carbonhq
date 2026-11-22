"use client";

import { useId } from "react";
import Link from "next/link";
import { CodeXml } from "lucide-react";

export function Doodle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" className={className} aria-hidden="true">
      <path
        d="m4.8404,2.25c-3.2556,2.6989-3.1932,6.5748-1.1928,8.1571,1.7743,1.4036,5.0348.9719,7.008-.3968,1.9472-1.3508,3.2194-3.7759,2.2117-4.9604-.9517-1.1187-3.8673-1.2374-6.5606,1.433-2.2633,2.244-3.0929,6.2074-.8698,8.113,2.1832,1.8713,7.1734,1.6167,10.3131-1.8739"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
      />
    </svg>
  );
}

export type Workspace = "Coding" | "Design";

const workspaces = [
  { name: "Coding", icon: CodeXml, href: "/" },
  { name: "Design", icon: Doodle, href: "/design-workspace" },
] as const;

export function WorkspaceSwitch({ value, onPick, navigate, size = "sm" }: {
  value: Workspace;
  onPick?: (workspace: Workspace) => void;
  navigate?: boolean;
  size?: "sm" | "lg";
}) {
  const group = useId();
  return (
    <div role={onPick ? "radiogroup" : navigate ? "group" : undefined} aria-label="Workspace" className="flex shrink-0 rounded-md bg-foreground/6">
      {workspaces.map(({ name, icon: Icon, href }) => {
        const label = name + " workspace";
        const active = name === value;
        const box = [
          "group/ws relative flex items-center justify-center rounded-md text-muted-foreground",
          size === "lg" ? "h-10 w-12" : "h-7 w-8",
          active && "bg-foreground/10 text-foreground ring-1 ring-inset ring-foreground/15",
        ].filter(Boolean).join(" ");
        const icon = <Icon className={size === "lg" ? "size-4" : "size-3.5"} />;
        const hint = <span aria-hidden className="pointer-events-none absolute top-full z-50 mt-1 hidden whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-ui text-foreground group-hover/ws:block group-focus-within/ws:block">{label}</span>;
        if (onPick) return (
          <label key={name} className={box + " cursor-pointer hover:text-foreground has-focus-visible:outline-2"}>
            <input type="radio" name={group} checked={active} aria-label={label} onChange={() => onPick(name)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
            {icon}{hint}
          </label>
        );
        if (navigate) return (
          <Link key={name} href={href} aria-label={label} aria-current={active ? "page" : undefined} className={box + " hover:text-foreground focus-visible:outline-2"}>
            {icon}{hint}
          </Link>
        );
        return <span key={name} className={box}>{icon}</span>;
      })}
    </div>
  );
}
