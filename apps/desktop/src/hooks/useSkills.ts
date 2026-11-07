import { useCallback, useEffect, useState } from "react";

import { invoke, LOCAL } from "@/lib/transport";
import type { SkillDocument, SkillsListing } from "@/types/events";

/// The last answer, for the life of the process, drawn while a fresh one runs.
let lastRead: SkillsListing | null = null;
let generation = 0;

/// Every skill the agents load, read off their skill folders, and the writes
/// that change them. Read on every mount, for `useMcpServers`' reason.
export function useSkills() {
  const [listing, setListing] = useState<SkillsListing | null>(lastRead);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const mine = ++generation;
    setBusy(true);
    try {
      const next = await invoke<SkillsListing>("list_skills", {}, LOCAL);
      if (mine === generation) {
        lastRead = next;
        setListing(next);
        setError(null);
        // pi starts a CLI for every project; show the folders while it reads
        // configured and package skills, and let writes finish after that read.
        void invoke<SkillsListing>("list_skills", { discoverPi: true }, LOCAL)
          .then((discovered) => {
            if (mine !== generation) return;
            lastRead = discovered;
            setListing(discovered);
          })
          .catch((err) => {
            if (mine === generation) setError(String(err));
          })
          .finally(() => {
            if (mine === generation) setBusy(false);
          });
      }
    } catch (err) {
      if (mine === generation) {
        setError(String(err));
        setBusy(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { ++generation; };
  }, [refresh]);

  /// Each write re-reads afterwards and answers the skill's folder, which a
  /// rename moves.
  const create = useCallback(
    async (root: string, skill: SkillDocument) => {
      const path = await invoke<string>("create_skill", { root, skill }, LOCAL);
      await refresh();
      return path;
    },
    [refresh],
  );

  const save = useCallback(
    async (path: string, skill: SkillDocument) => {
      const next = await invoke<string>("save_skill", { path, skill }, LOCAL);
      await refresh();
      return next;
    },
    [refresh],
  );

  const remove = useCallback(
    async (path: string) => {
      await invoke("remove_skill", { path }, LOCAL);
      await refresh();
    },
    [refresh],
  );

  const importFolder = useCallback(
    async (root: string, source: string) => {
      const path = await invoke<string>("import_skill", { root, source }, LOCAL);
      await refresh();
      return path;
    },
    [refresh],
  );

  return { listing, busy, error, refresh, create, save, remove, importFolder };
}

/// One skill whole, for the editor.
export function readSkill(path: string): Promise<SkillDocument> {
  return invoke<SkillDocument>("read_skill", { path }, LOCAL);
}
