import { useEffect, useState } from "react";
import { invoke, listen, LOCAL } from "@/lib/transport";

import type { FeatureFlags } from "@/types/events";

/// The local server reports feature availability; older servers can still withhold Spaces.
export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>({ pagesEnabled: false });
  useEffect(() => {
    let stopped = false;
    let sequence = 0;
    const refresh = async () => {
      const seq = ++sequence;
      try {
        const next = await invoke<FeatureFlags>("get_feature_flags", {}, LOCAL);
        if (!stopped && seq === sequence) setFlags({ pagesEnabled: next.pagesEnabled === true });
      } catch { if (!stopped && seq === sequence) setFlags({ pagesEnabled: false }); }
    };
    const off = listen("live_state", ({ server }) => { if (server === LOCAL) void refresh(); });
    void refresh();
    return () => { stopped = true; void off.then((fn) => fn()); };
  }, []);
  return flags;
}
