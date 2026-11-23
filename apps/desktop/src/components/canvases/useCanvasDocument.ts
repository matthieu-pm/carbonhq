import { useEffect, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { watchDocs } from "@/lib/servers";
import { canvasKey, canvasPath, type CanvasFile } from "@/lib/canvasFile";
import { listen, qualify, serverOfPath } from "@/lib/transport";
import { readCanvas, readCanvasWithPreview } from "./canvasWire";
import { CanvasSaveClient } from "./canvasSaveClient";
import { readDocument, type CommentPin, type Document } from "./document";

type Snapshot = { doc: Document | null; preview: Document | null; error: string; saving: boolean; conflict: boolean };
const open = new Map<string, CanvasSession>();

// Each viewer replaces its own file watch, including after a desktop restart or tab reload.
function canvasWatchScope() {
  const key = "carbon.canvas.watchScope";
  try {
    const storage = "__TAURI_INTERNALS__" in window ? window.localStorage : window.sessionStorage;
    const previous = storage.getItem(key);
    if (previous) return previous;
    const scope = `canvas-${crypto.randomUUID()}`;
    storage.setItem(key, scope);
    return scope;
  } catch {
    return `canvas-${crypto.getRandomValues(new Uint32Array(2)).join("-")}`;
  }
}

export class CanvasSession {
  private snapshot: Snapshot = { doc: null, preview: null, error: "", saving: false, conflict: false };
  private listeners = new Set<() => void>();
  private writer: CanvasSaveClient | null = null;
  private persisted: Document | null = null;
  private conflictRevision: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private group: string | Element | null = null;
  private input: Element | null = null;
  private groupedAt = 0;
  private reading: Promise<void> | null = null;
  private writing: Promise<void> | null = null;
  private refreshAgain = false;
  private history: Document[] = [];
  private future: Document[] = [];
  private loading = false;
  private discardingDraft = false;
  private pendingComments = 0;
  private archived = false;
  constructor(public file: CanvasFile) {}
  private key() {
    return (this.archived ? "archive:" : "") + canvasKey(this.file);
  }
  relocate(file: CanvasFile, archived: boolean) {
    open.delete(this.key());
    this.file = file;
    this.archived = archived;
    open.set(this.key(), this);
    if (this.reading) this.refreshAgain = true;
    if (this.snapshot.doc !== this.persisted && !this.snapshot.conflict) void this.flush();
  }
  get = () => this.snapshot;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
      queueMicrotask(() => {
        if (!this.listeners.size && this.timer) void this.flush();
        this.release();
      });
    };
  };
  private release() {
    const key = this.key();
    if (
      !this.listeners.size &&
      !this.pendingComments &&
      !this.loading &&
      !this.reading &&
      !this.writing &&
      this.snapshot.doc === this.persisted &&
      open.get(key) === this
    ) {
      open.delete(key);
      this.writer?.dispose();
    }
  }
  private update(change: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((fn) => fn());
  }
  private args() {
    const { project: projectPath, folder, name } = this.file;
    return { projectPath, folder, name, archived: this.archived };
  }
  watchFile() {
    const path = canvasPath(this.file);
    const scope = canvasWatchScope();
    let active = true;
    const refresh = () => {
      if (active && canvasPath(this.file) === path) void this.load(true);
    };
    const arm = async () => {
      if (!active) return;
      await watchDocs(scope, [path]);
      refresh();
    };
    const changed = listen<string>("doc_changed", ({ payload }) => {
      if (payload === path) refresh();
    });
    const reconnect = listen("live_state", ({ server }) => {
      if (server === serverOfPath(path)) void arm();
    });
    // Read after arming to catch a save between the initial read and watch registration.
    void Promise.all([changed, reconnect]).then(arm);
    return () => {
      active = false;
      void watchDocs(scope, []);
      void changed.then(off => off());
      void reconnect.then(off => off());
    };
  }
  async load(refresh = false): Promise<void> {
    if (this.reading) {
      if (refresh) {
        this.refreshAgain = true;
        return this.reading;
      }
      await this.reading;
      return this.load(false);
    }
    if (this.writing) {
      await this.writing;
      return this.load(refresh);
    }
    this.reading = this.read(refresh).finally(() => {
      this.reading = null;
      this.refreshIfQueued();
      this.release();
    });
    return this.reading;
  }
  reload(discardFocusedDraft: () => void) {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.discardingDraft = true;
    try {
      discardFocusedDraft();
    } finally {
      this.discardingDraft = false;
    }
    return this.load();
  }
  async synchronize() {
    if (this.snapshot.doc !== this.persisted || this.writing) await this.flush();
    while (this.reading) await this.reading;
    await this.load(true);
    if (this.snapshot.error || this.snapshot.conflict) throw Error(this.snapshot.error || "Canvas has unsaved conflicts.");
    if (this.snapshot.doc !== this.persisted) throw Error("Canvas changed during the command. Try again.");
  }
  private async read(refresh: boolean) {
    const key = this.key();
    const before = this.snapshot.doc;
    if (refresh) {
      if (before !== this.persisted || this.snapshot.conflict) return;
    } else this.loading = true;
    try {
      const result = await readCanvasWithPreview(this.args());
      const raw = result.content;
      const unchanged = refresh && before && await this.writer?.matches(raw);
      if (key !== this.key()) return;
      if (
        refresh &&
        (this.loading || this.writing || before !== this.snapshot.doc || before !== this.persisted)
      )
        return;
      const preview = result.preview ? readDocument(result.preview) : null;
      if (unchanged) {
        this.update({ preview, error: "" });
        return;
      }
      const doc = readDocument(raw);
      this.persisted = doc;
      this.writer?.dispose();
      this.writer = new CanvasSaveClient(raw, doc);
      this.history = [];
      this.future = [];
      this.group = null;
      this.conflictRevision = null;
      flushSync(() => this.update({ doc, preview, error: "", conflict: false, saving: false }));
    } catch (err) {
      if (key === this.key() && (!refresh || before === this.snapshot.doc)) this.update({ error: String(err) });
    } finally {
      if (!refresh) this.loading = false;
    }
  }
  private refreshIfQueued() {
    if (!this.refreshAgain) return;
    this.refreshAgain = false;
    void this.load(true);
  }
  async sendComment(pageId: string, pin: CommentPin, send: () => Promise<void>) {
    // A reopened tab must see the same document while delivery is outstanding.
    this.pendingComments++;
    try {
      await send();
      this.change(doc => ({
        ...doc,
        pages: doc.pages.map(page => page.id === pageId ? { ...page, comments: [...(page.comments ?? []), pin] } : page),
      }));
    } finally {
      this.pendingComments--;
      this.release();
    }
  }
  groupInput(input: Element) {
    this.input = input;
    queueMicrotask(() => {
      if (this.input === input) this.input = null;
    });
  }
  change = (apply: (doc: Document) => Document, group?: string | Element) => {
    const old = this.snapshot.doc;
    if (!old || this.loading || this.discardingDraft) return;
    const doc = apply(old);
    if (old === doc) return;
    const key = group ?? this.input;
    const now = Date.now();
    if (!key || key !== this.group || now - this.groupedAt > 500) {
      this.history.push(old);
      if (this.history.length > 80) this.history.shift();
    }
    this.group = key;
    this.groupedAt = now;
    this.future = [];
    this.replace(doc);
  };
  travel(redo: boolean) {
    if (this.loading) return;
    const next = (redo ? this.future : this.history).pop();
    if (!next || !this.snapshot.doc) return;
    this.group = null;
    (redo ? this.history : this.future).push(this.snapshot.doc);
    this.replace(next);
    return true;
  }
  private replace(doc: Document) {
    clearTimeout(this.timer);
    this.update({ doc, preview: null, saving: !this.snapshot.conflict });
    if (!this.snapshot.conflict) this.timer = setTimeout(() => void this.flush(), 250);
  }
  async keepMine() {
    if (this.writing || this.loading || !this.snapshot.conflict) return;
    if (this.conflictRevision === null) {
      this.loading = true;
      try {
        this.conflictRevision = await readCanvas(this.args());
      } catch (err) {
        this.update({ error: String(err) });
        return;
      } finally {
        this.loading = false;
      }
    }
    await this.writer?.rebase(this.conflictRevision);
    this.persisted = null;
    this.conflictRevision = null;
    this.update({ conflict: false });
    await this.flush();
  }
  async flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.writing) return this.writing;
    if (this.loading || this.snapshot.conflict) return;
    this.writing = this.saveChanges().finally(() => {
      this.writing = null;
      this.update({ saving: false });
      this.refreshIfQueued();
      this.release();
    });
    return this.writing;
  }
  private async saveChanges() {
    this.update({ saving: true, error: "" });
    try {
      while (this.snapshot.doc && this.snapshot.doc !== this.persisted) {
        const doc = this.snapshot.doc;
        const key = this.key();
        try {
          await this.writer!.save(this.args(), doc);
        } catch (err) {
          if (key !== this.key()) continue;
          throw err;
        }
        this.persisted = doc;
      }
    } catch (err) {
      const error = String(err);
      if (error.includes("Canvas changed on disk")) {
        this.conflictRevision = null;
        this.update({ error, conflict: true });
        this.conflictRevision = await readCanvas(this.args()).catch(() => null);
      } else this.update({ error });
    }
  }
}

export function relocateCanvasDocument(file: CanvasFile, destination: CanvasFile, archived: boolean, restoring = false) {
  const session = open.get((restoring ? "archive:" : "") + canvasKey(file));
  if (!session) return;
  const focused = typeof document === "undefined" ? null : document.activeElement;
  if (focused && focused instanceof HTMLElement && focused.closest<HTMLElement>("[data-canvas-key]")?.dataset.canvasKey === canvasKey(file))
    focused.blur();
  session.relocate(destination, archived);
}

export function openCanvasDocument(file: CanvasFile) {
  const key = canvasKey(file);
  const current = open.get(key) ?? new CanvasSession(file);
  open.set(key, current);
  return current;
}

export function useCanvasDocument(file: CanvasFile) {
  const [session] = useState(() => openCanvasDocument(file));
  const snapshot = useSyncExternalStore(session.subscribe, session.get);
  useEffect(() => {
    void session.load(!!session.get().doc);
    const stopWatching = session.watchFile();
    const refresh = () => {
      if (document.visibilityState === "visible") void session.load(true);
      else if (session.get().saving) void session.flush();
    };
    type Change = { project: string; folder: string; canvas?: string; command?: { group: string } };
    const onChange = ({ payload, server }: { payload: Change; server: string }) => {
      if (!["move", "archive", "restore"].includes(payload.command?.group ?? "") && session.file.project === qualify(payload.project, server) && session.file.folder === payload.folder && session.file.name === payload.canvas)
        void session.load(true);
    };
    const off = listen<Change>("canvas_changed", onChange);
    const offPreview = listen<Change>("canvas_preview_changed", onChange);
    void offPreview.then(() => session.load(true));
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopWatching();
      void off.then(remove => remove());
      void offPreview.then(remove => remove());
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [session]);
  return { ...snapshot, session };
}
