import { useEffect, useState, useSyncExternalStore } from "react";
import { canvasKey, type CanvasFile } from "@/hooks/useCanvasLibrary";
import { invoke } from "@/lib/transport";
import { readDocument, type Document } from "./document";

type Snapshot = { doc: Document | null; error: string; saving: boolean };
const open = new Map<string, CanvasSession>();

class CanvasSession {
  private snapshot: Snapshot = { doc: null, error: "", saving: false };
  private listeners = new Set<() => void>();
  private saved = "";
  private latest = "";
  private writing = false;
  private history: Document[] = [];
  private future: Document[] = [];
  private loading = false;
  constructor(readonly file: CanvasFile) {}
  get = () => this.snapshot;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
      queueMicrotask(() => this.release());
    };
  };
  private release() {
    const key = canvasKey(this.file);
    if (
      !this.listeners.size &&
      !this.loading &&
      !this.writing &&
      this.latest === this.saved &&
      open.get(key) === this
    )
      open.delete(key);
  }
  private update(change: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((fn) => fn());
  }
  async load() {
    if (this.loading || this.writing) return;
    this.loading = true;
    const { project: projectPath, folder, name } = this.file;
    try {
      const raw = await invoke<string>("read_canvas_document", { projectPath, folder, name });
      const doc = readDocument(raw);
      this.saved = this.latest = raw;
      this.history = [];
      this.future = [];
      this.update({ doc, error: "" });
    } catch (err) {
      this.update({ error: String(err) });
    } finally {
      this.loading = false;
      this.release();
    }
  }
  change = (apply: (doc: Document) => Document) => {
    const old = this.snapshot.doc;
    if (!old || this.loading) return;
    const doc = apply(old);
    if (old === doc) return;
    this.history.push(old);
    if (this.history.length > 80) this.history.shift();
    this.future = [];
    this.replace(doc);
  };
  travel(redo: boolean) {
    const next = (redo ? this.future : this.history).pop();
    if (!next || !this.snapshot.doc) return;
    (redo ? this.history : this.future).push(this.snapshot.doc);
    this.replace(next);
  }
  private replace(doc: Document) {
    this.latest = JSON.stringify(doc, null, 2) + "\n";
    this.update({ doc });
    void this.flush();
  }
  async flush() {
    if (this.writing || this.latest === this.saved) return;
    this.writing = true;
    this.update({ saving: true, error: "" });
    const { project: projectPath, folder, name } = this.file;
    try {
      while (this.latest !== this.saved) {
        const content = this.latest;
        await invoke("save_canvas_document", { projectPath, folder, name, previous: this.saved, content });
        this.saved = content;
      }
    } catch (err) {
      this.update({ error: String(err) });
    } finally {
      this.writing = false;
      this.update({ saving: false });
      this.release();
    }
  }
}

export function useCanvasDocument(file: CanvasFile) {
  // The tab is keyed by file. A closing tab can finish saving while another is active.
  const [session] = useState(() => {
    const key = canvasKey(file);
    const current = open.get(key) ?? new CanvasSession(file);
    open.set(key, current);
    return current;
  });
  const snapshot = useSyncExternalStore(session.subscribe, session.get);
  useEffect(() => {
    if (!session.get().doc) void session.load();
  }, [session]);
  return { ...snapshot, session };
}
