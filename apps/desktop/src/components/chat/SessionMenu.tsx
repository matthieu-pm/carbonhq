import { useState, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Copy,
  GitBranchPlus,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";

import AppIcon from "@/components/AppIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { useOpenApps } from "@/hooks/useOpenApps";
import { LOCAL, serverOfPath } from "@/lib/transport";
import type { SessionIndexItem } from "@/types/events";

export type SessionActions = {
  onRename: () => void;
  onSetFlags: (flags: { archived?: boolean; pinned?: boolean }) => void;
  onFork: (worktree: boolean) => void;
  onDelete: () => void;
};

/// The floating composer's session menu: Codex's chat menu mapped onto what a
/// Carbon session can do. R, P and A act from the open menu, as there.
export default function SessionMenu({
  item,
  busy,
  actions,
  children,
}: {
  item: SessionIndexItem;
  /// A fork reads the transcript the live child is appending to, so it waits
  /// for the turn — the sidebar's rule.
  busy: boolean;
  actions: SessionActions;
  /// The trigger.
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const pinned = !!item.pinned;
  const settled = !!item.archived;
  const local = serverOfPath(item.cwd) === LOCAL;

  const act = (run: () => void) => {
    setOpen(false);
    run();
  };
  const keys: Record<string, () => void> = {
    r: actions.onRename,
    p: () => actions.onSetFlags({ pinned: !pinned }),
    a: () => actions.onSetFlags(settled ? { archived: false } : { archived: true, pinned: false }),
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setConfirming(false);
      }}
    >
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52"
        // Rename moves focus into the title field; handing it back to the
        // trigger would blur that field the moment it opened.
        onCloseAutoFocus={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          const run = !confirming && !e.metaKey && !e.ctrlKey && !e.altKey && keys[e.key.toLowerCase()];
          if (!run) return;
          // Held back from Radix's typeahead, which would read it as a search.
          e.preventDefault();
          act(run);
        }}
      >
        {confirming ? (
          <>
            <p className="px-1.5 py-1 text-ui text-muted-foreground">Delete this task?</p>
            <div className="mt-1 flex gap-1">
              <DropdownMenuItem className="flex-1 justify-center text-ui">Cancel</DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onSelect={actions.onDelete}
                className="flex-1 justify-center bg-destructive/10 text-ui"
              >
                Delete
              </DropdownMenuItem>
            </div>
          </>
        ) : (
          <>
            <DropdownMenuItem className="text-ui" onSelect={actions.onRename}>
              <Pencil />
              Rename
              <Kbd className="ml-auto">R</Kbd>
            </DropdownMenuItem>
            <DropdownMenuItem className="text-ui" onSelect={keys.p}>
              {pinned ? <PinOff /> : <Pin />}
              {pinned ? "Unpin" : "Pin"}
              <Kbd className="ml-auto">P</Kbd>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger disabled={busy} className="text-ui">
                <GitBranchPlus />
                Fork
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem className="text-ui" onSelect={() => actions.onFork(true)}>
                  Fork in new worktree
                </DropdownMenuItem>
                <DropdownMenuItem className="text-ui" onSelect={() => actions.onFork(false)}>
                  Fork here
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-ui">
                <Copy />
                Copy
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <CopyItem label="Session ID" text={item.sessionId} />
                <CopyItem label="Working directory" text={item.cwd} />
                {item.branch && <CopyItem label="Branch name" text={item.branch} />}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {/* No apps here can open a folder that lives on another server. */}
            {local && open && <OpenInSub path={item.cwd} />}
            <DropdownMenuItem className="text-ui" onSelect={keys.a}>
              {settled ? <ArchiveRestore /> : <Archive />}
              {settled ? "Unsettle" : "Settle"}
              <Kbd className="ml-auto">A</Kbd>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {/* `preventDefault` holds the menu open for the confirm step. */}
            <DropdownMenuItem
              variant="destructive"
              className="text-ui"
              onSelect={(e) => {
                e.preventDefault();
                setConfirming(true);
              }}
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CopyItem({ label, text }: { label: string; text: string }) {
  return (
    <DropdownMenuItem className="text-ui" onSelect={() => void navigator.clipboard.writeText(text)}>
      {label}
    </DropdownMenuItem>
  );
}

/// Mounted only while the menu is open, so the app scan runs when it can be
/// seen and not once per tab switch.
function OpenInSub({ path }: { path: string }) {
  const { apps, open } = useOpenApps();
  if (apps.length === 0) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="text-ui">
        <ArrowUpRight />
        Open in
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-44">
        {apps.map((app) => (
          <DropdownMenuItem key={app.path} className="text-ui" onSelect={() => void open(app, path)}>
            <AppIcon app={app} className="size-4" />
            <span className="flex-1 truncate">{app.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
