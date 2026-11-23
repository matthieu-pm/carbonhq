// node scripts/canvas-graphics-fixture.mjs path/to/canvases/benchmark.canvas.json
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { newLayer } from "../src/components/canvases/model.js";

const path = process.argv[2];
if (!path?.endsWith(".canvas.json"))
  throw Error("Choose a new .canvas.json file in a project's canvases folder.");
const file = createWriteStream(path, { flags: "wx" });
await once(file, "open");
file.write(
  '{"version":1,"pages":[{"id":"bench","name":"Benchmark","background":"#202020"}],"tokens":[],"elements":[',
);
let count = 0;
async function append(layer) {
  const row = (count++ ? ",\n" : "\n") + JSON.stringify(layer);
  if (!file.write(row)) await once(file, "drain");
}
const palette = ["#5fc2ad", "#b6a2e2", "#dfab81", "#e2cd80", "#78a8ce"];
for (let i = 0; i < 1000; i++) {
  const frame = newLayer("Frame", "bench", null, (i % 40) * 620, Math.floor(i / 40) * 530);
  frame.id = "frame-" + i;
  frame.name = "Frame " + (i + 1);
  Object.assign(frame.style, { width: "584px", height: "484px" });
  frame.effects[0].fields.color = "#323338";
  await append(frame);
  for (let j = 0; j < 99; j++) {
    const layer = newLayer("Rectangle", "bench", frame.id, 12 + (j % 11) * 51, 12 + Math.floor(j / 11) * 51);
    layer.id = i + "-" + j;
    layer.name = "Swatch " + (j + 1);
    Object.assign(layer.style, { width: "44px", height: "44px" });
    layer.effects[0].fields.color = palette[(i + j) % palette.length];
    await append(layer);
  }
}
file.end("\n]}\n");
await finished(file);
console.log(`Wrote ${count.toLocaleString()} layers to ${path}`);
