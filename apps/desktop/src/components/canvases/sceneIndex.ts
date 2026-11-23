import Flatbush from "flatbush";
import type { Bounds } from "./graphicsScene";

const chunkSize = 256;

// Copy only touched chunks so old scenes remain valid during undo and interrupted renders.
export class SceneMap<K, V> {
  private constructor(
    readonly positions: ReadonlyMap<K, number>,
    readonly chunks: readonly (readonly V[])[],
  ) {}
  static from<K, V>(entries: Iterable<readonly [K, V]>): SceneMap<K, V> {
    const positions = new Map<K, number>();
    const chunks: V[][] = [];
    for (const [key, value] of entries) {
      const i = positions.size;
      positions.set(key, i);
      (chunks[Math.floor(i / chunkSize)] ??= []).push(value);
    }
    return new SceneMap(positions, chunks);
  }
  at(index: number): V {
    return this.chunks[Math.floor(index / chunkSize)][index % chunkSize];
  }
  get(key: K): V | undefined {
    const i = this.positions.get(key);
    return i === undefined ? undefined : this.at(i);
  }
  has(key: K) {
    return this.positions.has(key);
  }
  with(changes: ReadonlyMap<K, V>): SceneMap<K, V> {
    if (!changes.size) return this;
    const chunks = this.chunks.slice();
    const copied = new Set<number>();
    for (const [key, value] of changes) {
      const i = this.positions.get(key);
      if (i === undefined) throw Error("Scene structure changed");
      const chunk = Math.floor(i / chunkSize);
      if (!copied.has(chunk)) {
        chunks[chunk] = chunks[chunk].slice();
        copied.add(chunk);
      }
      (chunks[chunk] as V[])[i % chunkSize] = value;
    }
    return new SceneMap(this.positions, chunks);
  }
}

type Chunk = { index: Flatbush | null; slots: number[]; unbounded: number[]; bounds?: Bounds };
function extent(a: Bounds | undefined, b: Bounds): Bounds {
  if (!a) return b;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export class SceneIndex<K, V> {
  private readonly top: Flatbush | null;
  private readonly bounded: number[] = [];
  private readonly unbounded: number[] = [];
  private constructor(
    readonly items: SceneMap<K, V>,
    private readonly bounds: (value: V) => Bounds | null | undefined,
    private readonly chunks: readonly Chunk[],
  ) {
    chunks.forEach((chunk, i) => {
      if (chunk.bounds) this.bounded.push(i);
      if (chunk.unbounded.length) this.unbounded.push(i);
    });
    this.top = this.bounded.length ? new Flatbush(this.bounded.length) : null;
    for (const i of this.bounded) {
      const b = chunks[i].bounds!;
      this.top!.add(b.x, b.y, b.x + b.w, b.y + b.h);
    }
    this.top?.finish();
  }
  static from<K, V>(entries: Iterable<readonly [K, V]>, bounds: (value: V) => Bounds | null | undefined) {
    const items = SceneMap.from(entries);
    return new SceneIndex(
      items,
      bounds,
      items.chunks.map((chunk) => SceneIndex.chunk(chunk, bounds)),
    );
  }
  private static chunk<V>(items: readonly V[], bounds: (value: V) => Bounds | null | undefined): Chunk {
    const slots: number[] = [],
      unbounded: number[] = [];
    const boxes: Bounds[] = [];
    let area: Bounds | undefined;
    items.forEach((item, i) => {
      const b = bounds(item);
      if (b === undefined) unbounded.push(i);
      else if (b !== null) {
        slots.push(i);
        boxes.push(b);
        area = extent(area, b);
      }
    });
    const index = boxes.length ? new Flatbush(boxes.length) : null;
    for (const b of boxes) index!.add(b.x, b.y, b.x + b.w, b.y + b.h);
    index?.finish();
    return { index, slots, unbounded, bounds: area };
  }
  with(changes: ReadonlyMap<K, V>): SceneIndex<K, V> {
    if (!changes.size) return this;
    const items = this.items.with(changes),
      chunks = this.chunks.slice();
    const touched = new Set<number>();
    for (const key of changes.keys()) touched.add(Math.floor(this.items.positions.get(key)! / chunkSize));
    for (const i of touched) chunks[i] = SceneIndex.chunk(items.chunks[i], this.bounds);
    return new SceneIndex(items, this.bounds, chunks);
  }
  private candidates(area: Bounds) {
    const hits = this.top?.search(area.x, area.y, area.x + area.w, area.y + area.h) ?? [];
    return [...new Set([...hits.map((i) => this.bounded[i]), ...this.unbounded])].sort((a, b) => a - b);
  }
  visible = (area: Bounds): V[] => {
    const result: V[] = [];
    for (const i of this.candidates(area)) {
      const chunk = this.chunks[i];
      const hits = chunk.index?.search(area.x, area.y, area.x + area.w, area.y + area.h) ?? [];
      const slots = hits
        .map((j) => chunk.slots[j])
        .concat(chunk.unbounded)
        .sort((a, b) => a - b);
      for (const slot of slots) result.push(this.items.chunks[i][slot]);
    }
    return result;
  };
  ranges = (area: Bounds) => {
    const runs: { start: number; end: number }[] = [];
    for (const i of this.candidates(area)) {
      const start = i * chunkSize,
        end = start + this.items.chunks[i].length;
      const last = runs.at(-1);
      if (last?.end === start) last.end = end;
      else runs.push({ start, end });
    }
    return runs;
  };
}
