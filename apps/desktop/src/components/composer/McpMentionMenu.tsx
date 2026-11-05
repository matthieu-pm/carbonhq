import PickerMenu from "@/components/composer/PickerMenu";
import type { McpMention } from "@/types/events";

/// The `$` picker's rows: each server's name, and where it is configured
/// trailing it dimmed — `plugin` is the one that explains a name like
/// `plugin:figma:figma`.
///
/// Flat, like the file and session pickers. A few servers is the usual list,
/// so there is nothing for a heading to separate.
export default function McpMentionMenu({
  servers,
  activeIndex,
  onPick,
  onHover,
  bare = false,
}: {
  servers: McpMention[];
  activeIndex: number;
  onPick: (server: McpMention) => void;
  onHover: (index: number) => void;
  bare?: boolean;
}) {
  return (
    <PickerMenu
      groups={[{ label: null, items: servers }]}
      label="MCP servers"
      keyOf={(server) => server.name}
      activeIndex={activeIndex}
      onPick={onPick}
      onHover={onHover}
      bare={bare}
      renderItem={(server) => (
        <>
          <span className="min-w-0 truncate font-medium">{server.name}</span>
          {server.scope && (
            <span className="ml-auto shrink-0 text-muted-foreground">{server.scope}</span>
          )}
        </>
      )}
    />
  );
}
