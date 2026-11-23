import { CanvasSaveState, type CanvasSaveRequest } from "./canvasSave";

const state = new CanvasSaveState();
let queue = Promise.resolve();
self.onmessage = ({ data }: MessageEvent<{ id: number; request: CanvasSaveRequest }>) => {
  queue = queue.then(async () => {
    try {
      const result = await state.request(data.request);
      self.postMessage({ id: data.id, result });
    } catch (error) {
      self.postMessage({ id: data.id, error: String(error) });
    }
  });
};
