"use client";

import { createContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export const ReturningToCoding = createContext(false);

export function WorkspaceNavigation({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [route, setRoute] = useState({ from: "", to: pathname });
  if (route.to !== pathname) setRoute({ from: route.to, to: pathname });
  const returning = pathname === "/" && (route.from === "/design-workspace" || route.from.startsWith("/design-workspace/"));
  return <ReturningToCoding.Provider value={returning}>{children}</ReturningToCoding.Provider>;
}
