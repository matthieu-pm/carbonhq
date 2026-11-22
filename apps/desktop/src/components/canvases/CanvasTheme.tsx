import { useCanvasWindowPart } from "@/lib/canvasWindow";
import { useEffect, useRef, useState } from "react";
import { Blocks, ChevronDown, Copy, FileDown, Plus, Search, Trash2, X } from "lucide-react";
import { Popover } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { invoke } from "@/lib/transport";
import { projectLabel } from "@/lib/servers";
import type { FileBody, FileMatch, Project } from "@/types/events";
import { removeToken, tokenDefaults, uid, type Document, type Token, type TokenKind } from "./document";
import { importTokens, normalizeToken, tokenProperty } from "./importTokens";
import { Field, ToolButton } from "./EditorControls";

export type Change = (apply: (doc: Document) => Document) => void;
const kinds = Object.keys(tokenDefaults) as TokenKind[];

function ImportTheme({
  project,
  projects,
  onClose,
  onImport,
}: {
  project: string;
  projects: Project[];
  onClose: () => void;
  onImport: (tokens: Token[]) => void;
}) {
  const [source, setSource] = useState(project);
  const [paths, setPaths] = useState<string[]>([]);
  const [file, setFile] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setBusy(true);
    setPaths([]);
    setFile("");
    setError("");
    invoke<FileMatch[]>("search_files", { cwd: source, query: "design.md", limit: 500 })
      .then((result) => {
        if (!active) return;
        const paths = result.filter((f) => f.name.toLowerCase() === "design.md").map((f) => f.path);
        setPaths(paths);
        setFile(paths[0] ?? "");
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [source]);
  async function read() {
    setBusy(true);
    setError("");
    try {
      const body = await invoke<FileBody>("read_file", { path: source.replace(/\/$/, "") + "/" + file });
      if (body.kind !== "text") throw Error("Choose a text DESIGN.md file.");
      const tokens = importTokens(body.text);
      if (!tokens.length)
        throw Error(
          "No supported token definitions found. Use YAML tokens or CSS custom properties in DESIGN.md.",
        );
      onImport(tokens);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>Import from DESIGN.md</DialogTitle>
        <label className="ce-field">
          Project
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {projects.map((p) => (
              <option key={p.path} value={p.path}>
                {projectLabel(p)}
              </option>
            ))}
          </select>
        </label>
        {paths.length > 0 && (
          <label className="ce-field">
            File
            <select value={file} onChange={(e) => setFile(e.target.value)}>
              {paths.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </label>
        )}
        {!busy && !paths.length && !error && <p>No DESIGN.md found in this project.</p>}
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy || !file} onClick={() => void read()}>
          {busy ? "Reading…" : "Import tokens"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function CanvasTheme({
  doc,
  change,
  project,
  projects,
}: {
  doc: Document;
  change: Change;
  project: string;
  projects: Project[];
}) {
  const [search, setSearch] = useState<string | null>(null);
  const [open, edit] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState("");
  useCanvasWindowPart("theme", ({command}) => {
    if (command.group !== "view") throw Error("Choose a Theme view command.");
    if (command.args.op === "token-search") { setSearch(command.args.query); return; }
    if (command.args.op !== "token") throw Error("Unknown Theme action.");
    const id = command.args.id;
    if (id && !doc.tokens.some(t => t.id === id)) throw Error("Unknown token.");
    setSearch(null);
    edit(id);
  });
  const focusEditor = useRef(false);
  const create = (kind: TokenKind, original?: Token) => {
    const token = {
      id: uid(),
      kind,
      name: original ? original.name + " copy" : "Untitled",
      value: original?.value ?? tokenDefaults[kind],
    };
    change((d) => ({ ...d, tokens: [...d.tokens, token] }));
    setSearch(null);
    edit(token.id);
  };
  const menu = (empty: boolean) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {empty ? (
          <Button size="sm">Create token</Button>
        ) : (
          <button className="ce-icon" aria-label="Add token">
            <Plus />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          if (focusEditor.current) event.preventDefault();
          focusEditor.current = false;
        }}
      >
        {kinds.map((k) => (
          <DropdownMenuItem
            key={k}
            onSelect={() => {
              focusEditor.current = true;
              create(k);
            }}
          >
            {k}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => setImporting(true)}>
          <FileDown size={14} />
          Import from DESIGN.md
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const update = (id: string, patch: Partial<Token>) =>
    change((d) => ({ ...d, tokens: d.tokens.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  return (
    <>
      <div className="ce-heading">
        <span>
          {doc.tokens.length
            ? doc.tokens.length + (doc.tokens.length === 1 ? " token" : " tokens")
            : "No tokens"}
        </span>
        <ToolButton
          label="Search tokens"
          active={search !== null}
          onClick={() => setSearch(search === null ? "" : null)}
        >
          <Search />
        </ToolButton>
        {menu(false)}
      </div>
      {search !== null && (
        <input
          autoFocus
          className="ce-search"
          aria-label="Search tokens"
          placeholder="Search tokens…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}
      {notice && (
        <div className="ce-notice" role="status">
          {notice}
          <ToolButton label="Dismiss" onClick={() => setNotice("")}>
            <X />
          </ToolButton>
        </div>
      )}
      {doc.tokens.length === 0 ? (
        <div className="ce-empty">
          <Blocks size={30} strokeWidth={1.4} />
          <h3>Theme tokens</h3>
          <p>Create a token or import your project’s theme.</p>
          {menu(true)}
          <Button size="sm" variant="secondary" onClick={() => setImporting(true)}>
            Import from DESIGN.md
          </Button>
        </div>
      ) : (
        <div className="ce-scroll">
          {kinds.map((kind) => {
            const list = doc.tokens.filter(
              (t) => t.kind === kind && t.name.toLowerCase().includes((search ?? "").toLowerCase()),
            );
            return (
              list.length > 0 && (
                <details key={kind} open className="ce-group">
                  <summary>
                    <ChevronDown size={13} />
                    {kind}
                  </summary>
                  {list.map((t) => (
                    <Popover.Root
                      key={t.id}
                      open={open === t.id}
                      onOpenChange={(v) => edit((current) => (v ? t.id : current === t.id ? null : current))}
                    >
                      <Popover.Trigger asChild>
                        <button
                          className="ce-row"
                          aria-label={"Edit token " + t.name}
                          aria-pressed={open === t.id}
                        >
                          {kind === "Color" ? (
                            <i className="ce-chip" style={{ background: t.value }} />
                          ) : (
                            <Blocks size={14} />
                          )}
                          <span>{t.name}</span>
                          {kind !== "Color" && <small>{t.value}</small>}
                        </button>
                      </Popover.Trigger>
                      <Popover.Portal>
                        <Popover.Content
                          side="right"
                          align="start"
                          sideOffset={6}
                          collisionPadding={12}
                          className="ce-popover"
                          aria-label={kind + " token"}
                          onOpenAutoFocus={(event) => {
                            event.preventDefault();
                            requestAnimationFrame(() =>
                              document
                                .querySelector<HTMLInputElement>('.ce-popover input[aria-label="Name"]')
                                ?.select(),
                            );
                          }}
                        >
                          <div className="ce-heading">
                            <strong>{kind}</strong>
                            <ToolButton label="Duplicate token" onClick={() => create(kind, t)}>
                              <Copy />
                            </ToolButton>
                            <ToolButton
                              label="Delete token"
                              onClick={() => {
                                change((d) => removeToken(d, t));
                                edit(null);
                              }}
                            >
                              <Trash2 />
                            </ToolButton>
                            <ToolButton label="Close token editor" onClick={() => edit(null)}>
                              <X />
                            </ToolButton>
                          </div>
                          <div
                            className="ce-preview"
                            style={kind === "Color" ? { background: t.value } : undefined}
                          >
                            {kind !== "Color" && t.value}
                          </div>
                          <Field label="Name" value={t.name} onChange={(name) => update(t.id, { name })} />
                          <Field
                            label="Value"
                            value={t.value}
                            kinds={[kind]}
                            valid={(v) => CSS.supports(tokenProperty[kind], normalizeToken(kind, v))}
                            onChange={(v) => update(t.id, { value: normalizeToken(kind, v) })}
                          />
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover.Root>
                  ))}
                </details>
              )
            );
          })}
        </div>
      )}
      {importing && (
        <ImportTheme
          project={project}
          projects={projects}
          onClose={() => setImporting(false)}
          onImport={(incoming) => {
            const names = new Set(doc.tokens.map((t) => t.kind + "\n" + t.name));
            const added = incoming.filter((t) => {
              const key = t.kind + "\n" + t.name;
              if (names.has(key)) return false;
              names.add(key);
              return true;
            });
            if (added.length) change((d) => ({ ...d, tokens: [...d.tokens, ...added] }));
            setNotice(
              added.length
                ? `Imported ${added.length} token${added.length === 1 ? "" : "s"}.`
                : "These tokens already exist.",
            );
          }}
        />
      )}
    </>
  );
}
