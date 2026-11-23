export type View = { x: number; y: number; zoom: number };

export const initialView: View = { x: 32, y: 40, zoom: 1 };

export function zoomAt(view: View, next: number, x: number, y: number): View {
  const zoom = Math.min(8, Math.max(0.05, next)),
    ratio = zoom / view.zoom;
  return { zoom, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}

export class CanvasCamera {
  private presented = initialView;
  private pending = initialView;
  private frame: number | undefined;
  private listeners = new Set<() => void>();

  get = () => this.presented;
  latest = () => this.pending;
  percent = () => Math.round(this.presented.zoom * 100);

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(view: View) {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.pending = view;
    this.present();
  }

  move(view: View) {
    this.pending = view;
    this.frame ??= requestAnimationFrame(this.present);
  }

  private present = () => {
    this.frame = undefined;
    if (this.presented === this.pending) return;
    this.presented = this.pending;
    for (const listener of this.listeners) listener();
  };
}
