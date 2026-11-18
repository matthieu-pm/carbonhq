import { useEffect, useRef, useState } from "react";

import { CanvasFileDialog } from "@/components/canvas/CanvasDialogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { readLocalStorage } from "@/hooks/useLocalStorage";
import { pickElement } from "@/lib/browser";
import { displayPath, invoke, listen } from "@/lib/transport";
import type { CanvasList, CanvasSummary } from "@/types/events";

type Page = { projectPath: string; sessionId: string; tabId: number; url: string };
type Pick = { page: Page; canvasId: string };

export type BrowserCaptureResult = { projectPath: string; canvasId: string; frameId: string };

function samePage(a: Page | null, b: Page | null) {
  return !!a && !!b && a.sessionId === b.sessionId && a.tabId === b.tabId && a.url === b.url && a.projectPath === b.projectPath;
}

export function useBrowserCapture(page: Page | null, active: boolean, onCaptured?: (result: BrowserCaptureResult) => void) {
  const latest = useRef(page);
  latest.current = page;
  const armed = useRef<Pick | null>(null);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choose, setChoose] = useState<{ page: Page; files: CanvasSummary[]; create: boolean } | null>(null);

  const cancel = () => {
    const target = armed.current;
    armed.current = null;
    setError(null);
    setChoose(null);
    if (target && !saving) void pickElement(target.page.sessionId, false, false, target.page.tabId);
  };

  useEffect(() => {
    const target = armed.current;
    if (target && !samePage(page, target.page) && !saving) cancel();
    if (choose && !samePage(page, choose.page)) setChoose(null);
  }, [page?.sessionId, page?.tabId, page?.url, page?.projectPath, choose, saving]);

  useEffect(() => () => {
    const target = armed.current;
    if (target && !working.current) void pickElement(target.page.sessionId, false, false, target.page.tabId);
  }, []);
  const keyboardActive = !!page && active;
  useEffect(() => {
    if (!keyboardActive) return;
    const capturePage = (event: KeyboardEvent) => {
      if (!event.metaKey || event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.isComposing) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) void saveRef.current(true);
    };
    window.addEventListener("keydown", capturePage, true);
    return () => window.removeEventListener("keydown", capturePage, true);
  }, [keyboardActive]);

  const start = async (target: Page, canvasId: string) => {
    if (!samePage(latest.current, target)) return;
    armed.current = { page: target, canvasId };
    await pickElement(target.sessionId, true, true, target.tabId);
    if (samePage(latest.current, target)) setChoose(null);
    else await pickElement(target.sessionId, false, false, target.tabId);
  };

  const toggle = async () => {
    if (working.current || !page) return;
    if (active) { cancel(); return; }
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      const list = await invoke<CanvasList>("list_canvases", { projectPath: displayPath(page.projectPath) });
      if (!samePage(latest.current, page)) return;
      const remembered = readLocalStorage<string | null>(`carbon.canvas.file:${page.projectPath}`, null);
      if (remembered && list.files.some(file => file.id === remembered)) await start(page, remembered);
      else setChoose({ page, files: list.files, create: !list.files.length });
    } catch (failure) {
      if (samePage(latest.current, page)) setError(String(failure));
    } finally { working.current = false; setBusy(false); }
  };

  const submitCanvas = async (nameOrId: string) => {
    if (!choose || working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    const target = choose.page;
    try {
      const canvas = choose.create
        ? await invoke<{ id: string }>("create_canvas", { projectPath: displayPath(target.projectPath), name: nameOrId })
        : { id: nameOrId };
      await start(target, canvas.id);
    } catch (failure) {
      if (samePage(latest.current, target)) setError(String(failure));
    } finally { working.current = false; setBusy(false); }
  };

  const save = async (fullPage: boolean, sessionId?: string, tabId?: number) => {
    const target = armed.current;
    if (!target || working.current || !samePage(latest.current, target.page)) return;
    if (sessionId !== undefined && (target.page.sessionId !== sessionId || target.page.tabId !== tabId)) return;
    working.current = true;
    setSaving(true);
    setError(null);
    try {
      const frameId = await invoke<string>("browser_capture_frame", {
        sessionId: target.page.sessionId, tabId: target.page.tabId, canvasId: target.canvasId, fullPage,
      });
      if (samePage(latest.current, target.page)) {
        onCaptured?.({ projectPath: target.page.projectPath, canvasId: target.canvasId, frameId });
      }
    } catch (failure) {
      if (samePage(latest.current, target.page)) setError(String(failure));
      await pickElement(target.page.sessionId, false, false, target.page.tabId);
    } finally {
      armed.current = null;
      working.current = false;
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const off = listen<{ sessionId: string; tabId: number; fullPage: boolean }>("browser_canvas_pick", ({ payload }) => {
      void saveRef.current(payload.fullPage, payload.sessionId, payload.tabId);
    });
    return () => { void off.then(unlisten => unlisten()).catch(console.error); };
  }, []);

  const dialogs = <>
    <Dialog open={!!choose && !choose.create} onOpenChange={open => { if (!open && !busy) cancel(); }}>
      <DialogContent dismissible={!busy} showClose={!busy}>
        <DialogHeader>
          <DialogTitle>Choose a canvas</DialogTitle>
          <DialogDescription className="sr-only">Add the capture to a canvas in this project.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-64 gap-1 overflow-y-auto">
          {choose?.files.map(file => (
            <Button key={file.id} variant="ghost" className="justify-start" disabled={busy} onClick={() => void submitCanvas(file.id)}>{file.name}</Button>
          ))}
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <Button variant="secondary" disabled={busy} onClick={() => { if (choose) setChoose({ ...choose, create: true }); }}>New canvas</Button>
      </DialogContent>
    </Dialog>
    <CanvasFileDialog open={!!choose?.create} onOpenChange={open => { if (!open && !busy) cancel(); }}
      initialName="" title="New canvas" busy={busy} error={error} onSubmit={name => void submitCanvas(name)} />
  </>;

  return { toggle, cancel, save, saving, busy, error: choose ? null : error, dialogs };
}
