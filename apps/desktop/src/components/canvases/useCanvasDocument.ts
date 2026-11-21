import { useEffect, useState, useSyncExternalStore } from "react";
import { canvasKey, type CanvasFile } from "@/hooks/useCanvasLibrary";
import { invoke } from "@/lib/transport";
import { readDocument, type CommentPin, type Document } from "./document";

type Snapshot = { doc: Document | null; error: string; saving: boolean; conflict: boolean };
const open = new Map<string, CanvasSession>();

export class CanvasSession {
  private snapshot: Snapshot = { doc: null, error: "", saving: false, conflict: false };
  private listeners = new Set<() => void>();
  private saved = "";
  private persisted: Document | null = null;
  private conflictRevision: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private group: string | Element | null = null;
  private input: Element | null = null;
  private groupedAt = 0;
  private refreshing = false;
  private writing = false;
  private history: Document[] = [];
  private future: Document[] = [];
  private loading = false;
  private pendingComments = 0;
  constructor(readonly file: CanvasFile) {}
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
    const key = canvasKey(this.file);
    if (
      !this.listeners.size &&
      !this.pendingComments &&
      !this.loading &&
      !this.writing &&
      this.snapshot.doc === this.persisted &&
      open.get(key) === this
    )
      open.delete(key);
  }
  private update(change: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((fn) => fn());
  }
  private args() {
    const { project: projectPath, folder, name } = this.file;
    return { projectPath, folder, name };
  }
  async load(refresh = false) {
    if (this.loading || this.writing) return;
    const before = this.snapshot.doc;
    if (refresh) {
      if (this.refreshing || before !== this.persisted || this.snapshot.conflict) return;
      this.refreshing = true;
    } else this.loading = true;
    try {
      const raw = await invoke<string>("read_canvas_document", this.args());
      if (
        refresh &&
        (this.loading || this.writing || before !== this.snapshot.doc || before !== this.persisted)
      )
        return;
      if (refresh && before && raw === this.saved) {
        this.update({ error: "" });
        return;
      }
      const doc = readDocument(raw);
      this.persisted = doc;
      this.saved = raw;
      this.history = [];
      this.future = [];
      this.group = null;
      this.conflictRevision = null;
      this.update({ doc, error: "", conflict: false, saving: false });
    } catch (err) {
      if (!refresh || before === this.snapshot.doc) this.update({ error: String(err) });
    } finally {
      if (refresh) this.refreshing = false;
      else this.loading = false;
      this.release();
    }
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
    if (!old || this.loading) return;
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
  }
  private replace(doc: Document) {
    clearTimeout(this.timer);
    this.update({ doc, saving: !this.snapshot.conflict });
    if (!this.snapshot.conflict) this.timer = setTimeout(() => void this.flush(), 250);
  }
  async keepMine() {
    if (this.writing || this.loading || !this.snapshot.conflict) return;
    if (this.conflictRevision === null) {
      this.loading = true;
      try {
        this.conflictRevision = await invoke<string>("read_canvas_document", this.args());
      } catch (err) {
        this.update({ error: String(err) });
        return;
      } finally {
        this.loading = false;
      }
    }
    this.saved = this.conflictRevision;
    this.persisted = null;
    this.conflictRevision = null;
    this.update({ conflict: false });
    await this.flush();
  }
  async flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.writing || this.loading || this.snapshot.conflict) return;
    this.writing = true;
    this.update({ saving: true, error: "" });
    try {
      while (this.snapshot.doc && this.snapshot.doc !== this.persisted) {
        const doc = this.snapshot.doc;
        const content = JSON.stringify(doc, null, 2) + "\n";
        await invoke("save_canvas_document", { ...this.args(), previous: this.saved, content });
        this.saved = content;
        this.persisted = doc;
      }
    } catch (err) {
      const error = String(err);
      if (error.includes("Canvas changed on disk")) {
        this.conflictRevision = null;
        this.update({ error, conflict: true });
        this.conflictRevision = await invoke<string>("read_canvas_document", this.args()).catch(() => null);
      } else this.update({ error });
    } finally {
      this.writing = false;
      this.update({ saving: false });
      this.release();
    }
  }
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
    const refresh = () => {
      if (document.visibilityState === "visible") void session.load(true);
      else if (session.get().saving) void session.flush();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [session]);
  return { ...snapshot, session };
}
