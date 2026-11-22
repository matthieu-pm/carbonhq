"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const designPath = "/design-workspace";

export function SiteLinks() {
  const pathname = usePathname();
  const onDesignPage = pathname === designPath || pathname.startsWith(designPath + "/");

  return (
    <>
      <Link href={onDesignPage ? "/" : designPath}>
        {onDesignPage ? "Coding workspace" : "Design workspace"}
      </Link>
      <a href="/docs">Docs</a>
      <a href="/changelog">Changelog</a>
    </>
  );
}
