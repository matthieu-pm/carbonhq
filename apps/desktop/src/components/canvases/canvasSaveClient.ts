import type { Document } from "./document";
import {
  canvasContent,
  canvasPatch,
  inflateCanvasGzip,
  prepareCanvasSave,
  type CanvasSavePayload,
  type CanvasSaveReply,
  type CanvasSaveRequest,
} from "./canvasSave";
import { saveCanvas, type CanvasLocation } from "./canvasWire";

function needsWorker(doc: Document, rawLength = 0) {
  if (rawLength >= 1 << 19 || doc.elements.length >= 1000) return true;
  let remaining = 1 << 18;
  const pending: unknown[] = [doc];
  while (pending.length && remaining > 0) {
    const value = pending.pop();
    if (typeof value === "string") remaining -= value.length;
    else if (value && typeof value === "object") {
      if (Array.isArray(value) && value.length >= 1000) return true;
      for (const child of Object.values(value)) {
        remaining -= 8;
        pending.push(child);
      }
    }
  }
  return remaining <= 0;
}

export class CanvasSaveClient {
  private worker?: Worker;
  private ready: Promise<unknown> = Promise.resolve();
  private nextId = 0;
  private pending = new Map<
    number,
    { resolve: (value: CanvasSaveReply) => void; reject: (error: Error) => void }
  >();
  private failure?: Error;
  private disabled = false;
  private backup: string | CanvasSavePayload;
  constructor(
    private previous: string,
    private mirrored: Document,
  ) {
    this.backup = previous;
    if (needsWorker(mirrored, previous.length)) this.startWorker();
  }
  private startWorker() {
    if (typeof Worker === "undefined") {
      this.disabled = true;
      return;
    }
    try {
      this.worker = new Worker(new URL("./canvasSave.worker.ts", import.meta.url), { type: "module" });
    } catch {
      this.disabled = true;
      return;
    }
    this.worker.onmessage = ({ data }) => {
      const call = this.pending.get(data.id);
      if (data.error) this.fail(Error(data.error));
      else {
        this.pending.delete(data.id);
        call?.resolve(data.result);
      }
    };
    this.worker.onerror = () => this.fail(Error("Canvas save worker stopped. Your changes are still open."));
    this.worker.onmessageerror = () => this.fail(Error("Canvas save worker could not read its response."));
    this.ready = this.request({ type: "reset", raw: this.previous })
      .then(() => {
        this.previous = "";
      })
      .catch(() => {
        // A blocked worker must retain the ordinary save path on older WebViews.
        this.dispose();
        this.failure = undefined;
      });
  }
  private fail(error: Error) {
    this.failure = error;
    for (const call of this.pending.values()) call.reject(error);
    this.pending.clear();
  }
  private request(request: CanvasSaveRequest): Promise<CanvasSaveReply> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      try {
        this.worker!.postMessage({ id, request });
      } catch (error) {
        this.fail(error instanceof Error ? error : Error(String(error)));
      }
    });
  }
  private async fallback() {
    this.disabled = true;
    this.worker?.terminate();
    this.worker = undefined;
    this.previous =
      typeof this.backup === "string"
        ? this.backup
        : this.backup.gzip
          ? await inflateCanvasGzip(this.backup.content)
          : this.backup.content;
    this.failure = undefined;
  }
  async matches(raw: string): Promise<boolean> {
    await this.ready;
    try {
      return this.worker
        ? ((await this.request({ type: "matches", raw })) as boolean)
        : raw === this.previous;
    } catch (error) {
      if (!this.failure) throw error;
      await this.fallback();
      return raw === this.previous;
    }
  }
  async rebase(raw: string) {
    await this.ready;
    if (this.failure) await this.fallback();
    try {
      if (this.worker) await this.request({ type: "previous", raw });
      else this.previous = raw;
    } catch (error) {
      if (!this.failure) throw error;
      await this.fallback();
      this.previous = raw;
    }
    this.backup = raw;
  }
  async save(args: CanvasLocation, doc: Document): Promise<void> {
    if (!this.worker && !this.disabled && needsWorker(doc, this.previous.length)) this.startWorker();
    await this.ready;
    if (this.failure) await this.fallback();
    if (!this.worker) {
      const content = canvasContent(doc);
      await saveCanvas(args, await prepareCanvasSave(this.previous, content), async () => ({
        previous: this.previous,
        content,
      }));
      this.previous = content;
      this.backup = content;
      this.mirrored = doc;
      return;
    }
    const patch = canvasPatch(this.mirrored, doc);
    const preparing = this.request({ type: "prepare", patch });
    // The worker has applied the patch even if encoding or the disk write later fails.
    this.mirrored = doc;
    let payload: CanvasSavePayload;
    try {
      payload = (await preparing) as CanvasSavePayload;
    } catch (error) {
      if (!this.failure) throw error;
      await this.fallback();
      return this.save(args, doc);
    }
    await saveCanvas(args, payload, () => this.request({ type: "plain" }) as Promise<CanvasSavePayload>);
    this.backup = payload;
    try {
      await this.request({ type: "commit" });
    } catch (error) {
      if (!this.failure) throw error;
    }
  }
  dispose() {
    this.disabled = true;
    this.worker?.terminate();
    this.worker = undefined;
    this.fail(Error("Canvas save worker closed."));
  }
}
