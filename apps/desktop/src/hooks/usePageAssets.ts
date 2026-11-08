import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, listen } from "@/lib/transport";
import type { PageAsset, PageTarget } from "@/lib/pages";

const CHUNK = 256 * 1024;
const MAX_FILE = 20 * 1024 * 1024;

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

/// Chunking keeps large attachments within the same framing limit the CLI uses.
export async function uploadPageAsset(target: PageTarget, file: File, progress: (value: number) => void): Promise<PageAsset> {
  if (file.size > MAX_FILE) throw new Error("Attach a file of 20 MiB or smaller.");
  const assetId = crypto.randomUUID();
  let offset = 0;
  do {
    const bytes = new Uint8Array(await file.slice(offset, offset + CHUNK).arrayBuffer());
    const complete = offset + bytes.length >= file.size;
    const args = { id: target.id, name: file.name, assetId, offset, data: base64(bytes), complete };
    let response: { written: number; asset: PageAsset | null };
    try { response = await invoke("write_page_asset", args, target.server); }
    catch { response = await invoke("write_page_asset", args, target.server); }
    if (response.written !== offset + bytes.length) throw new Error("The attachment could not be uploaded completely. Try again.");
    offset = response.written;
    progress(file.size ? offset / file.size : 1);
    if (complete && response.asset) return response.asset;
    if (complete || bytes.length === 0) throw new Error("The attachment did not finish saving. Try again.");
  } while (offset <= file.size);
  throw new Error("The attachment could not be uploaded.");
}

export function usePageAssets(target: PageTarget, active: boolean) {
  const generation = useRef(0);
  const [assets, setAssets] = useState<PageAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const seq = ++generation.current;
    try {
      const next = await invoke<PageAsset[]>("list_page_assets", { id: target.id }, target.server);
      if (seq === generation.current) { setAssets(next); setError(null); }
    } catch (reason) { if (seq === generation.current) setError(String(reason)); }
  }, [target.id, target.server]);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const reload = () => { if (!stopped) void refresh(); };
    const off = listen<{ id: string }>("page_assets_changed", ({ payload, server }) => { if (server === target.server && payload.id === target.id) reload(); });
    const reconnect = listen("live_state", ({ server }) => { if (server === target.server) reload(); });
    reload();
    return () => { stopped = true; generation.current++; void off.then((fn) => fn()); void reconnect.then((fn) => fn()); };
  }, [active, refresh, target.id, target.server]);
  return { assets, error, refresh };
}
