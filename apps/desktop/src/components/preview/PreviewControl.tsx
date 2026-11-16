import { FileText, Play, Settings2, Square } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { HeaderIconButton } from "@/components/layout/IssueTabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import Spinner from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { previewLogs, previewSetup, previewUrl, startPreview, stopPreview, usePreview, type PreviewConfig } from "@/lib/preview";
import { displayPath, serverOfSession } from "@/lib/transport";
import { serverName } from "@/lib/servers";

/// Preview belongs to the session's server; leaving the dialog never stops its process.
export default function PreviewControl({ sessionId, cwd, disabled = false, onOpen }: {
  sessionId: string;
  cwd: string;
  disabled?: boolean;
  onOpen: (sessionId: string, url: string) => Promise<void>;
}) {
  const state = usePreview(sessionId);
  const [dialog, setDialog] = useState<"setup" | "logs" | null>(null);
  const [config, setConfig] = useState<PreviewConfig>({ directory: ".", command: "" });
  const [loading, setLoading] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const opening = useRef(false);
  const configReads = useRef(0);
  const commandEdited = useRef(false);
  const lastFolder = useRef(".");
  const latestConfig = useRef(config);
  const suggestion = useRef<Promise<void> | null>(null);
  const submitting = useRef(false);
  const live = state?.status === "starting" || state?.status === "running";

  const editConfig = (next: PreviewConfig) => {
    latestConfig.current = next;
    setConfig(next);
  };

  const closeDialog = () => {
    configReads.current++;
    suggestion.current = null;
    setLoading(false);
    setSuggesting(false);
    setDialog(null);
  };

  useEffect(() => {
    if (!opening.current || state?.status !== "running") return;
    opening.current = false;
    void previewUrl(state).then((url) => onOpen(sessionId, url)).catch((e: unknown) => {
      setError(String(e));
      setDialog("logs");
    });
  }, [state, sessionId, onOpen]);

  useEffect(() => {
    if (state?.status !== "failed" || !opening.current) return;
    opening.current = false;
    setDialog("logs");
  }, [state?.status]);

  useEffect(() => {
    if (dialog !== "logs") return;
    let disposed = false;
    const read = () => void previewLogs(sessionId).then((text) => {
      if (!disposed) setLogs(text);
    }, (e: unknown) => { if (!disposed) setError(String(e)); });
    read();
    const interval = window.setInterval(read, 1000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [dialog, sessionId]);

  const run = async (next?: PreviewConfig) => {
    if (acting) return;
    setActing(true);
    setError(null);
    opening.current = true;
    try {
      const result = await startPreview(sessionId, next);
      setDialog(null);
      if (result?.status === "running" && opening.current) {
        opening.current = false;
        await onOpen(sessionId, await previewUrl(result));
      }
    } catch (e) {
      opening.current = false;
      setError(String(e));
      setDialog(next ? "setup" : "logs");
    } finally {
      setActing(false);
    }
  };

  const setup = async () => {
    setDialog("setup");
    setLoading(true);
    setSuggesting(false);
    setError(null);
    const read = ++configReads.current;
    try {
      const result = await previewSetup(sessionId);
      if (configReads.current === read) {
        const next = result.config ?? { directory: ".", command: result.suggestedCommand };
        commandEdited.current = !!result.config;
        lastFolder.current = next.directory;
        editConfig(next);
      }
    } catch (e) {
      if (configReads.current === read) setError(String(e));
    } finally {
      if (configReads.current === read) setLoading(false);
    }
  };

  const suggest = (): Promise<void> => {
    const directory = latestConfig.current.directory;
    if (directory === lastFolder.current) return suggestion.current ?? Promise.resolve();
    lastFolder.current = directory;
    const read = ++configReads.current;
    setSuggesting(true);
    const pending = previewSetup(sessionId, directory).then((result) => {
      if (configReads.current === read && !commandEdited.current && result.suggestedCommand) editConfig({ ...latestConfig.current, command: result.suggestedCommand });
    }).catch((e: unknown) => {
      if (configReads.current === read) setError(String(e));
    }).finally(() => {
      if (suggestion.current === pending) {
        suggestion.current = null;
        setSuggesting(false);
      }
    });
    suggestion.current = pending;
    return pending;
  };

  const toggle = async () => {
    if (acting || disabled) return;
    setError(null);
    if (live) {
      opening.current = false;
      setActing(true);
      try { await stopPreview(sessionId); }
      catch (e) { setError(String(e)); setDialog("logs"); }
      finally { setActing(false); }
      return;
    }
    setActing(true);
    setSuggesting(false);
    try {
      const result = await previewSetup(sessionId);
      if (result.config) {
        setActing(false);
        await run();
      } else {
        editConfig({ directory: ".", command: result.suggestedCommand });
        lastFolder.current = ".";
        commandEdited.current = false;
        setDialog("setup");
      }
    } catch (e) { setError(String(e)); setDialog("setup"); }
    finally { setActing(false); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (loading || acting || submitting.current) return;
    submitting.current = true;
    try {
      const pending = suggest();
      const generation = configReads.current;
      await pending;
      if (generation !== configReads.current) return;
      if (latestConfig.current.command.trim()) await run(latestConfig.current);
    } finally {
      submitting.current = false;
    }
  };
  const label = live ? "Stop preview" : "Start preview";
  const status = state?.status === "starting" ? "Starting preview…" : state?.status === "running" ? "Preview running" : state?.status === "failed" ? "Preview failed" : "Preview stopped";

  return <>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} disabled={disabled || acting} onClick={() => void toggle()}
          className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground">
          {acting || state?.status === "starting" ? <Spinner className="size-3.5" /> : live ? <Square className="size-3.5 fill-current text-accent-add" /> : <Play className="size-3.5 translate-x-px" />}
          <span>{state?.status === "starting" ? "Starting…" : live ? "Stop preview" : state?.status === "failed" ? "Preview failed" : state?.status === "stopped" ? "Preview stopped" : "Preview"}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
    {state && <HeaderIconButton label="Preview details and logs" onClick={() => { setError(null); setDialog("logs"); }}>
      <FileText className="size-3.5" />
    </HeaderIconButton>}

    <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) closeDialog(); }}>
      <DialogContent className="max-w-lg min-w-0">
        <DialogHeader>
          <DialogTitle>{dialog === "setup" ? "Set up preview" : status}</DialogTitle>
          <DialogDescription>{dialog === "setup" ? "Choose how to run this app. Saved for this project." : `Runs on ${serverName(serverOfSession(sessionId))}. Stops when this session is settled.`}</DialogDescription>
        </DialogHeader>
        {dialog === "setup" ? <form onSubmit={submit} className="grid min-w-0 gap-4">
          <div className="grid gap-1.5">
            <label htmlFor="preview-directory" className="text-sm font-medium">App folder</label>
            <Input id="preview-directory" value={config.directory} disabled={loading || acting} placeholder="."
              onChange={(e) => { configReads.current++; setSuggesting(false); editConfig({ ...config, directory: e.target.value }); }} onBlur={() => void suggest()} />
            <p className="truncate font-mono text-xs text-muted-foreground" title={displayPath(cwd)}>Relative to {displayPath(cwd)}</p>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor="preview-command" className="text-sm font-medium">Dev command</label>
            <Input id="preview-command" className="font-mono" value={config.command} disabled={loading || acting} placeholder="pnpm dev --port {port}"
              onChange={(e) => { commandEdited.current = !!e.target.value.trim(); editConfig({ ...config, command: e.target.value }); }} />
            <p className="text-xs text-muted-foreground">Carbon picks a free port. Use <code className="font-mono">{"{port}"}</code> where your command needs it, or read <code className="font-mono">PORT</code>.</p>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeDialog}>Cancel</Button>
            <Button type="submit" disabled={loading || acting || (!config.command.trim() && !suggesting && config.directory === lastFolder.current)}>{loading || suggesting || acting ? <Spinner className="size-4" /> : <Play className="size-4" />}Start preview</Button>
          </div>
        </form> : <div className="grid min-w-0 gap-3">
          {(error || state?.message) && <p role="status" className="text-sm text-muted-foreground">{error ?? state?.message}</p>}
          {state && <p className="truncate font-mono text-xs text-muted-foreground">{state.config.directory} · {state.config.command}</p>}
          <pre aria-label="Preview log" className="max-h-72 min-h-24 overflow-auto rounded-lg bg-surface-well p-3 font-mono text-xs whitespace-pre-wrap break-words">{logs || "No output yet."}</pre>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={acting} onClick={() => void setup()}><Settings2 className="size-4" />Edit setup</Button>
            {state?.status === "running" && <Button variant="outline" onClick={() => void previewUrl(state).then((url) => onOpen(sessionId, url)).then(() => setDialog(null)).catch((e: unknown) => setError(String(e)))}>Open preview</Button>}
            <Button disabled={acting || disabled} onClick={() => void toggle()}>{live ? "Stop preview" : "Start preview"}</Button>
          </div>
        </div>}
      </DialogContent>
    </Dialog>
  </>;
}
