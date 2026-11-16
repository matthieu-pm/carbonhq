import { useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { channel } from "@/lib/channel";
import { invoke, LOCAL } from "@/lib/transport";
import type { LoginStatus, McpLogin, McpTarget } from "@/types/events";

type Login = { pending: boolean; error: string | null };
let logins: Record<string, Login> = {};
const changed = channel<void>();
export const mcpSignedIn = channel<void>();

function update(key: string, value: Login) {
  logins = { ...logins, [key]: value };
  changed.emit();
}

async function signIn(key: string, target: McpTarget, name: string) {
  if (logins[key]?.pending) return;
  update(key, { pending: true, error: null });
  try {
    const login = await invoke<McpLogin>("start_mcp_login", { target, name }, LOCAL);
    await openUrl(login.url);
    for (;;) {
      const result = await invoke<LoginStatus>("mcp_login_status", { id: login.id }, LOCAL);
      if (result.status === "failed") throw new Error(result.message);
      if (result.status === "complete") break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    update(key, { pending: false, error: null });
    mcpSignedIn.emit();
  } catch (error) {
    update(key, { pending: false, error: String(error) });
  }
}

/// A browser sign-in survives leaving Settings while its callback is pending.
export function useMcpLogin() {
  const states = useSyncExternalStore(changed.subscribe, () => logins);
  return { states, signIn };
}
