import { afterEach, expect, it, vi } from "vitest";
import { CanvasCamera, initialView, zoomAt } from "./canvasCamera";

afterEach(() => vi.unstubAllGlobals());

it("accumulates pan and anchored zoom inputs and presents once per frame", () => {
  let callback!: FrameRequestCallback;
  const request = vi.fn((fn: FrameRequestCallback) => {
    callback = fn;
    return 1;
  });
  vi.stubGlobal("requestAnimationFrame", request);
  const camera = new CanvasCamera();
  const observe = vi.fn();
  const remove = camera.subscribe(observe);
  const pan = { ...initialView, x: 90 };
  camera.move(pan);
  camera.move(zoomAt(camera.latest(), 2, 100, 200));
  expect(camera.get()).toBe(initialView);
  expect(camera.latest()).toEqual({ x: 80, y: -120, zoom: 2 });
  expect(request).toHaveBeenCalledTimes(1);
  callback(16);
  expect(camera.get()).toBe(camera.latest());
  expect(observe).toHaveBeenCalledTimes(1);
  remove();
  camera.set(initialView);
  expect(observe).toHaveBeenCalledTimes(1);
});

it("lets a page change or explicit view command supersede queued input immediately", () => {
  vi.stubGlobal("requestAnimationFrame", () => 42);
  const cancel = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancel);
  const camera = new CanvasCamera();
  camera.move({ ...initialView, y: 500 });
  camera.set(initialView);
  expect(cancel).toHaveBeenCalledWith(42);
  expect(camera.get()).toBe(initialView);
  expect(camera.latest()).toBe(initialView);
});
