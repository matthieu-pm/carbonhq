import { memo } from "react";

import FileIcon from "@/components/FileIcon";
import Counts from "@/components/changes/Counts";
import { splitPath } from "@/lib/changes";
import { cn } from "@/lib/utils";
import type { ChangedFile } from "@/types/events";

/// A list of changed files, with the selected one leading to the diff pane.
///
/// One component for both sub-tabs: the working tree's files and a commit's
/// read the same and are picked from the same way, so a second version would
/// only be a chance for the two to drift apart.
export default function FileList({
  files,
  selected,
  onSelect,
  className,
  indent = false,
}: {
  files: readonly ChangedFile[];
  selected: string | null;
  onSelect: (path: string) => void;
  className?: string;
  /// Set under an expanded commit, where the rows belong to the row above them
  /// and the step in is what says so.
  indent?: boolean;
}) {
  return (
    <div className={className}>
      {files.map((file) => (
        <Row
          key={file.path}
          file={file}
          selected={file.path === selected}
          onSelect={onSelect}
          indent={indent}
        />
      ))}
    </div>
  );
}

/// `splitPath` keeps the separator on the directory, which reads as a dangling
/// slash once the directory is drawn *after* the name.
const trimSlash = (dir: string) => dir.replace(/\/$/, "");

/// Memoized for [ChangesPanel]'s reason: the view re-renders on every session
/// event, while a row's props only move when a read finds different trees.
const Row = memo(function Row({
  file,
  selected,
  onSelect,
  indent,
}: {
  file: ChangedFile;
  selected: boolean;
  onSelect: (path: string) => void;
  indent: boolean;
}) {
  const { dir, name } = splitPath(file.path);

  return (
    <button
      type="button"
      onClick={() => onSelect(file.path)}
      title={file.path}
      className={cn(
        "flex w-full items-center gap-2 py-1.5 pr-3 text-left text-ui",
        indent ? "pl-6" : "pl-3",
        selected ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
      )}
    >
      <FileIcon path={file.path} />

      {/* Name first, directory after it. The directory gives up its width
          first; the name truncates only once that is gone, since a name that
          never shrinks spills over the counts in a narrow pane. One span
          holding `dir + name` would clip from the end, which is the filename. */}
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="min-w-0 truncate text-sidebar-foreground">{name}</span>
        {dir && (
          <span className="min-w-0 shrink-[1000] truncate text-muted-foreground">
            {trimSlash(dir)}
          </span>
        )}
        {file.oldPath && (
          <span className="min-w-0 truncate text-muted-foreground">
            ← {splitPath(file.oldPath).name}
          </span>
        )}
      </span>

      {file.binary ? (
        <span className="shrink-0 text-muted-foreground">binary</span>
      ) : (
        <Counts added={file.added} removed={file.removed} className="shrink-0" />
      )}
    </button>
  );
});
