import { useEffect, useMemo, useState } from "react";
import { open as openFolder } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import AgentIcon from "@/components/AgentIcon";
import CarbonIcon from "@/components/CarbonIcon";
import {
  ArrowLeftOutline12,
  CircleWarningOutline12,
  CubesGlyph18,
  DotsOutline12,
  FolderImportOutline18,
  FolderOpenOutline12,
  Globe2Outline12,
  LockOutline12,
  PenOutline12,
  PlusOutline12,
  RefreshClockwiseOutline12,
  TrashOutline12,
} from "@/components/icons/nucleo";
import {
  AGENT_NAMES,
  baseName,
  FIELD,
  FIELD_LABEL,
  GroupHeader,
  listNames,
  Picker,
  Quiet,
  tildePath,
} from "@/components/settings/agentConfig";
import SettingsHeaderAction from "@/components/settings/headerAction";
import { CancelOrConfirm } from "@/components/settings/InRowConfirm";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { inputClassName } from "@/components/ui/input";
import Spinner from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { readSkill, useSkills } from "@/hooks/useSkills";
import { cn } from "@/lib/utils";
import type { SkillDocument, SkillEntry, SkillRoot } from "@/types/events";

/// What the page is showing in place of the list.
type Mode =
  | { kind: "new" }
  | { kind: "import"; source: string }
  | { kind: "edit"; skill: SkillEntry };

/// A folder's name in a picker: where it is and who reads it.
function rootTitle(root: SkillRoot): { title: string; detail: string } {
  // The one target that is not a folder but a pair of them.
  if (root.sharedWith) return { title: root.project ? baseName(root.project) : "Global", detail: "Every agent" };
  if (root.label) return { title: root.label, detail: root.project ? `${tildePath(root.project)} · ${tildePath(root.path)}` : tildePath(root.path) };
  if (root.project) return { title: baseName(root.project), detail: tildePath(root.path) };
  return { title: "Global", detail: tildePath(root.path) };
}

/// Claude Code's rule for a name, the strictest of the agents', checked as the
/// reader types so a refusal never waits for Save.
const NAME_RULE = /^[a-z0-9-]{1,64}$/;

/// Settings → Skills: every skill each agent loads, grouped by the folder it
/// lives in, and the forms that make, import, edit and remove them.
///
/// **A folder is shared, so each group names its readers**: a skill put in
/// `~/.agents/skills` reaches Codex, pi, Grok Build and fx at once, and the
/// form says so before the reader picks one.
///
/// **No one folder reaches all five, so "Every agent" is two**: the skill is
/// kept in `.claude/skills` and linked into `.agents/skills`. It leads the
/// picker, and a skill already in either folder takes the link from its row's
/// menu. A shared skill draws in both groups, since both folders hold it.
export default function SkillsSettings() {
  const { listing, busy, error, refresh, create, save, remove, importFolder, share } = useSkills();
  const [mode, setMode] = useState<Mode | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ path: string; message: string } | null>(null);

  const groups = useMemo(
    () =>
      [...(listing?.roots ?? [])].sort((a, b) => {
        // Global, then projects, then built-in and package skills.
        const rank = (r: SkillRoot) => (!r.writable ? 2 : r.project ? 1 : 0);
        return rank(a) - rank(b) || (a.project ?? "").localeCompare(b.project ?? "");
      }),
    [listing],
  );
  const targets = listing?.targets ?? [];

  const pickFolder = async () => {
    const folder = await openFolder({ directory: true, multiple: false, title: "Choose a folder holding a SKILL.md" });
    if (typeof folder === "string") setMode({ kind: "import", source: folder });
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsHeaderAction>
        {mode ? (
          <Button variant="ghost" size="icon-sm" aria-label="Back" className="-order-1" onClick={() => setMode(null)}>
            <ArrowLeftOutline12 className="size-3.5" />
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" className="ml-auto" disabled={!targets.length} onClick={() => void pickFolder()}>
              <FolderImportOutline18 className="size-3.5" />
              Import
            </Button>
            <Button variant="secondary" size="sm" disabled={!targets.length} onClick={() => setMode({ kind: "new" })}>
              <PlusOutline12 className="size-3" />
              New skill
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Refresh" disabled={busy} onClick={() => void refresh()}>
                  {busy ? <Spinner className="size-3.5" /> : <RefreshClockwiseOutline12 className="size-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </>
        )}
      </SettingsHeaderAction>

      {error && <p className="text-ui text-destructive">{error}</p>}

      {mode?.kind === "import" ? (
        <ImportForm
          source={mode.source}
          targets={targets}
          onCancel={() => setMode(null)}
          onPickAgain={() => void pickFolder()}
          onImport={async (target) => {
            await importFolder(target.path, mode.source, !!target.sharedWith);
            setMode(null);
          }}
        />
      ) : mode ? (
        <SkillForm
          key={mode.kind === "edit" ? mode.skill.path : "new"}
          skill={mode.kind === "edit" ? mode.skill : null}
          targets={targets}
          onCancel={() => setMode(null)}
          onSave={async (target, doc) => {
            if (mode.kind === "edit") await save(mode.skill.path, doc);
            else if (target) await create(target.path, doc, !!target.sharedWith);
            setMode(null);
          }}
        />
      ) : listing === null ? (
        <div className="flex items-center gap-2 py-4 text-ui text-muted-foreground">
          <Spinner className="size-3.5" />
          Reading skill folders&hellip;
        </div>
      ) : groups.length === 0 ? (
        <p className="text-ui text-muted-foreground">No skills yet. Make one, or import a folder holding a SKILL.md.</p>
      ) : (
        groups.map((root) => {
          const { title, detail } = rootTitle(root);
          return (
            <section key={root.id} className="flex flex-col gap-1">
              <GroupHeader
                icon={
                  root.writable && !root.project ? (
                    <CarbonIcon className="size-3.5" />
                  ) : root.writable ? (
                    <CubesGlyph18 className="size-3.5" />
                  ) : (
                    <AgentIcon harness={root.readers[0]} className="size-3.5" />
                  )
                }
                title={title}
                detail={detail}
                readers={root.readers}
              />
              {root.error ? (
                <Quiet tone="error">Couldn't read this folder: {root.error}</Quiet>
              ) : root.skills.length === 0 ? (
                <Quiet>No skills here yet.</Quiet>
              ) : (
                root.skills.map((skill) => (
                  <SkillRow
                    key={skill.path}
                    skill={skill}
                    locked={skill.locked ?? (root.writable ? null : "Read-only")}
                    confirming={confirming === skill.path}
                    error={rowError?.path === skill.path ? rowError.message : null}
                    onOpen={() => {
                      setConfirming(null);
                      setMode({ kind: "edit", skill });
                    }}
                    onAskRemove={() => {
                      setRowError(null);
                      setConfirming(skill.path);
                    }}
                    onCancelRemove={() => setConfirming(null)}
                    onRemove={() => {
                      setConfirming(null);
                      remove(skill.path).catch((err) => setRowError({ path: skill.path, message: String(err) }));
                    }}
                    onShare={() => {
                      setRowError(null);
                      share(skill.path).catch((err) => setRowError({ path: skill.path, message: String(err) }));
                    }}
                  />
                ))
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function SkillRow({
  skill,
  locked,
  confirming,
  error,
  onOpen,
  onAskRemove,
  onCancelRemove,
  onRemove,
  onShare,
}: {
  skill: SkillEntry;
  locked: string | null;
  confirming: boolean;
  error: string | null;
  onOpen: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
  onShare: () => void;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2">
        {/* The whole row opens the skill — to edit, or to read where it is
            locked — since reading one is the commonest reason to be here. */}
        <button
          type="button"
          onClick={onOpen}
          className="-mx-1.5 flex min-w-0 flex-1 cursor-pointer flex-col rounded-lg px-1.5 py-1.5 text-left hover:bg-muted/50"
        >
          <span className="flex items-center gap-1.5 text-ui text-foreground">
            <span className="truncate">{skill.name}</span>
            {locked && <LockOutline12 aria-label="Read-only" className="size-3 shrink-0 text-muted-foreground" />}
            {skill.shared && <span className="shrink-0 text-muted-foreground/70">Every agent</span>}
          </span>
          {skill.description && <span className="truncate text-ui text-muted-foreground">{skill.description}</span>}
        </button>

        {confirming ? (
          <CancelOrConfirm
            verb={skill.linked ? "Remove link" : "Remove"}
            onConfirm={onRemove}
            onCancel={onCancelRemove}
            autoFocus
            className="gap-1"
          >
            <span className="text-ui text-muted-foreground">Remove {skill.name}?</span>
          </CancelOrConfirm>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`${skill.name} options`}>
                <DotsOutline12 className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem onSelect={onOpen}>
                <PenOutline12 className="size-3" />
                {locked ? "View" : "Edit"}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void revealItemInDir(skill.path)}>
                <FolderOpenOutline12 className="size-3" />
                Show in Finder
              </DropdownMenuItem>
              {!locked && skill.shareable && (
                <DropdownMenuItem onSelect={onShare}>
                  <Globe2Outline12 className="size-3" />
                  Share with every agent
                </DropdownMenuItem>
              )}
              {!locked && (
                <DropdownMenuItem variant="destructive" onSelect={onAskRemove}>
                  <TrashOutline12 className="size-3" />
                  Remove
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {error && (
        <p className="flex items-center gap-1.5 pb-1 text-ui text-destructive">
          <CircleWarningOutline12 className="size-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/// The folder picker's rows: global folders first, then each project's, each
/// with the agents that would load a skill put there.
function targetItems(targets: SkillRoot[]) {
  return targets.map((root) => {
    const { title, detail } = rootTitle(root);
    return {
      id: root.id,
      label: `${title} · ${detail}`,
      detail: root.readers.map((h) => AGENT_NAMES[h]).join(", "),
    };
  });
}

/// Where a skill goes, and the sentence saying who picks it up. Keyed on the
/// target's id, not its path: "Every agent" and `.claude/skills` share one.
function FolderPicker({
  targets,
  value,
  onPick,
}: {
  targets: SkillRoot[];
  value: string;
  onPick: (id: string) => void;
}) {
  const picked = targets.find((t) => t.id === value);
  return (
    <>
      <Picker label="Folder" value={value} items={targetItems(targets)} onPick={onPick} />
      {picked && (
        <p className="-mt-1.5 text-ui text-muted-foreground @md:pl-27">
          Loaded by {listNames(picked.readers)}.
          {picked.sharedWith &&
            ` Kept in ${tildePath(picked.path)} and linked into ${tildePath(picked.sharedWith)}.`}
        </p>
      )}
    </>
  );
}

/// Make a skill, or edit or read one. A locked skill opens read-only, with the
/// reason where the Save button would be.
function SkillForm({
  skill,
  targets,
  onCancel,
  onSave,
}: {
  skill: SkillEntry | null;
  targets: SkillRoot[];
  onCancel: () => void;
  onSave: (target: SkillRoot | undefined, doc: SkillDocument) => Promise<void>;
}) {
  const [doc, setDoc] = useState<SkillDocument | null>(skill ? null : { name: "", description: "", body: "" });
  const [root, setRoot] = useState(targets[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const locked = skill?.locked ?? null;

  useEffect(() => {
    if (!skill) return;
    let live = true;
    readSkill(skill.path)
      .then((read) => live && setDoc(read))
      .catch((err) => live && setFailure(String(err)));
    return () => {
      live = false;
    };
  }, [skill]);

  if (!doc) {
    return failure ? (
      <p className="text-ui text-destructive">{failure}</p>
    ) : (
      <div className="flex items-center gap-2 py-4 text-ui text-muted-foreground">
        <Spinner className="size-3.5" />
        Opening {skill?.name}&hellip;
      </div>
    );
  }

  const nameOk = NAME_RULE.test(doc.name.trim()) || (skill !== null && doc.name.trim() === skill.name);
  const ready = nameOk && doc.description.trim().length > 0 && (skill !== null || root !== "");

  return (
    <form
      className="@container flex flex-col gap-3 rounded-xl border border-border/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (locked || !ready || saving) return;
        setSaving(true);
        setFailure(null);
        onSave(targets.find((t) => t.id === root), doc)
          .catch((err) => setFailure(String(err)))
          .finally(() => setSaving(false));
      }}
    >
      <span className="text-ui font-medium">
        {skill ? (locked ? skill.name : `Edit ${skill.name}`) : "New skill"}
      </span>

      {skill ? (
        <p className="text-ui text-muted-foreground">{tildePath(skill.path)}</p>
      ) : (
        <FolderPicker targets={targets} value={root} onPick={setRoot} />
      )}

      <label className={FIELD}>
        <span className={FIELD_LABEL}>Name</span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            value={doc.name}
            onChange={(e) => setDoc({ ...doc, name: e.target.value })}
            placeholder="review-pr"
            readOnly={!!locked}
            aria-invalid={doc.name.length > 0 && !nameOk}
            className={cn(inputClassName, "font-mono")}
            autoComplete="off"
            spellCheck={false}
            autoFocus={!skill}
          />
          {doc.name.length > 0 && !nameOk && (
            <span className="text-ui text-destructive">Lowercase letters, numbers and hyphens.</span>
          )}
        </div>
      </label>

      <label className={FIELD}>
        <span className={FIELD_LABEL}>Description</span>
        <textarea
          value={doc.description}
          onChange={(e) => setDoc({ ...doc, description: e.target.value })}
          placeholder="What it does and when an agent should use it."
          readOnly={!!locked}
          rows={2}
          className={cn(inputClassName, "h-auto min-w-0 flex-1 resize-none py-1.5")}
        />
      </label>

      <label className={FIELD}>
        <span className={FIELD_LABEL}>Instructions</span>
        <textarea
          value={doc.body}
          onChange={(e) => setDoc({ ...doc, body: e.target.value })}
          placeholder={"# Review a pull request\n\n1. Read the diff…"}
          readOnly={!!locked}
          rows={16}
          className={cn(inputClassName, "h-auto min-h-48 min-w-0 flex-1 resize-y py-1.5 font-mono text-xs leading-relaxed")}
          spellCheck={false}
        />
      </label>

      {failure && (
        <p className="flex items-start gap-1.5 text-ui text-destructive">
          <CircleWarningOutline12 className="mt-0.5 size-3 shrink-0" />
          {failure}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {locked ? (
          <span className="mr-auto flex items-center gap-1.5 text-ui text-muted-foreground">
            <LockOutline12 className="size-3" />
            {locked}
          </span>
        ) : (
          <span className="mr-auto text-ui text-muted-foreground">New sessions pick this up.</span>
        )}
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {locked ? "Close" : "Cancel"}
        </Button>
        {!locked && (
          <Button type="submit" variant="secondary" size="sm" disabled={!ready || saving}>
            {saving && <Spinner className="size-3" />}
            {skill ? "Save" : "Create skill"}
          </Button>
        )}
      </div>
    </form>
  );
}

/// Copy a folder in. The folder is picked first, by the system's own dialog,
/// so this form only asks where it goes.
function ImportForm({
  source,
  targets,
  onCancel,
  onPickAgain,
  onImport,
}: {
  source: string;
  targets: SkillRoot[];
  onCancel: () => void;
  onPickAgain: () => void;
  onImport: (target: SkillRoot) => Promise<void>;
}) {
  const [root, setRoot] = useState(targets[0]?.id ?? "");
  const target = targets.find((t) => t.id === root);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <form
      className="@container flex flex-col gap-3 rounded-xl border border-border/60 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!target || saving) return;
        setSaving(true);
        setFailure(null);
        onImport(target)
          .catch((err) => setFailure(String(err)))
          .finally(() => setSaving(false));
      }}
    >
      <span className="text-ui font-medium">Import a skill</span>
      <div className={FIELD}>
        <span className={FIELD_LABEL}>From</span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-ui">{tildePath(source)}</span>
          <Button type="button" variant="ghost" size="sm" onClick={onPickAgain}>
            Change…
          </Button>
        </div>
      </div>
      <FolderPicker targets={targets} value={root} onPick={setRoot} />
      <p className="text-ui text-muted-foreground">
        The folder is copied, SKILL.md and everything beside it, under its own name.
      </p>
      {failure && (
        <p className="flex items-start gap-1.5 text-ui text-destructive">
          <CircleWarningOutline12 className="mt-0.5 size-3 shrink-0" />
          {failure}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" size="sm" disabled={!target || saving}>
          {saving && <Spinner className="size-3" />}
          Import
        </Button>
      </div>
    </form>
  );
}
