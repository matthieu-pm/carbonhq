import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const cli =
  process.env.CANVAS_TEST_CLI ?? fileURLToPath(new URL("../../cli/target/debug/carbon", import.meta.url));
const server =
  process.env.CANVAS_TEST_SERVER ??
  fileURLToPath(new URL("../src-tauri/target/debug/carbon-serve", import.meta.url));
await Promise.all([access(cli), access(server)]);
const home = await realpath(await mkdtemp(path.join(tmpdir(), "canvas-")));
const project = path.join(home, "project");
await mkdir(project);
const env = {
  ...process.env,
  CARBON_HOME: home,
  CARBON_ENDPOINT: path.join(home, "carbon.sock"),
  CARBON_NO_ANALYTICS: "1",
  CARBON_SESSION_ID: "canvas-preview-test",
};
const child = spawn(server, ["--port", "0"], { env, stdio: "ignore" });
const exited = new Promise((resolve) => child.once("exit", resolve));
let canvas;
let count = 0;
function run(args, expectedError) {
  const options = ["canvas", "--project", project, ...(canvas ? ["--canvas", canvas] : [])];
  const result = spawnSync(cli, [...options, ...args], { env, encoding: "utf8", timeout: 10000 });
  if (result.error) throw result.error;
  if (expectedError) {
    assert.notEqual(result.status, 0, args.join(" "));
    assert.match(result.stderr, expectedError);
  } else {
    assert.equal(result.status, 0, args.join(" ") + "\n" + result.stderr);
  }
  count++;
  if (!expectedError) return JSON.parse(result.stdout);
}

try {
  for (let i = 0; ; i++) {
    try {
      await access(env.CARBON_ENDPOINT);
      break;
    } catch (err) {
      if (i > 200 || child.exitCode !== null) throw err;
      await delay(50);
    }
  }
  assert.deepEqual(run(["projects"]), []);
  run(["--revision", "stale", "attach"], /revision applies to document/i);
  run(["attach"]);
  assert.equal(run(["projects"])[0].path, project);
  run(["folder", "designs"]);
  canvas = run(["create"]).name;
  assert.equal(run(["search", canvas]).canvases[0].name, canvas);
  const first = run(["read"]);
  assert.equal(first.data.pages[0].id, "page-1");
  const id = (...args) => run(args).data.id;
  const page = id("page", "add", "Checkout");
  run(["--revision", first.revision, "page", "rename", page, "Stale"], /revision changed/i);
  run(["page", "rename", page, "Cart"]);
  const frame = id("layer", "add", "Frame", page);
  assert.deepEqual(run(["layer", "presets"]).data.Phone["iPhone 16"], [393, 852]);
  run(["layer", "preset", frame, "iPhone 16"]);
  const text = id("layer", "add", "Text", page, "--parent", frame);
  const beforePreview = run(["read"]);
  const heading = id("preview", "layer", "add", "Text", page, "--parent", frame);
  run(["preview", "layer", "text", heading, "Payment"]);
  run(["preview", "effect", "add", heading, "Fill"]);
  assert.equal(run(["preview", "read"]).data.elements.find(l => l.id === heading).text, "Payment");
  assert.deepEqual(run(["read"]), beforePreview);
  run(["preview", "--session", "another-agent", "cancel"], /another agent/i);
  run(["preview", "save"]);
  assert.equal(run(["read"]).data.elements.find(l => l.id === heading).text, "Payment");
  run(["undo"]);
  assert.deepEqual(run(["read"]), beforePreview);
  run(["preview", "layer", "rename", frame, "Unsaved"]);
  run(["preview", "cancel"]);
  assert.deepEqual(run(["read"]), beforePreview);
  run(["preview", "layer", "rename", frame, "Agent"]);
  run(["layer", "rename", frame, "User"]);
  run(["preview", "save"], /changed during preview/i);
  run(["preview", "cancel"]);
  assert.equal(run(["read"]).data.elements.find(l => l.id === frame).name, "User");
  run(["layer", "rename", text, "Label"]);
  run(["layer", "text", text, "Continue"]);
  run(["layer", "parent", text]);
  run(["layer", "parent", text, frame]);
  run(["layer", "replace-color", frame, "#202020", "#111111"]);
  const temporary = id("layer", "add", "Rectangle", page);
  run(["layer", "remove", temporary]);
  run(["layer", "move", frame, "-5", "2"]);
  run(["layer", "nudge", frame, "3", "-2"]);
  run(["layer", "resize", frame, "375px", "812px"]);
  run(["layer", "parent", frame, frame], /hierarchy/i);
  const token = id("token", "add", "Radius", "Card", "12");
  run(["token", "rename", token, "Corner"]);
  const copy = id("token", "duplicate", token);
  assert.equal(run(["token", "list", "--query", "Corner"]).data.length, 2);
  run(["token", "remove", copy]);
  run(["token", "apply", token, frame, "borderRadius"]);
  run(["token", "set", token, "24"]);
  run(["token", "remove", token]);
  const effect = id("effect", "add", frame, "Fill");
  const file = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
  await writeFile(path.join(project, "fill.png"), file);
  run(["effect", "image", frame, effect, "fill.png"]);
  assert.equal(run(["effect", "list", frame]).data[0].fields.image, "data:image/png;base64," + file.toString("base64"));
  run(["effect", "set", frame, effect, "type", "Linear"]);
  const stop = id("effect", "add-stop", frame, effect, "#abc", "50%");
  const earlier = id("effect", "add-stop", frame, effect, "#fff", "20%");
  const stops = () => run(["effect", "list", frame]).data.find(e => e.id === effect).stops.map(s => s.id);
  assert.deepEqual(stops(), [earlier, stop]);
  run(["effect", "set-stop", frame, effect, stop, "#fff", "10%"]);
  assert.deepEqual(stops(), [stop, earlier]);
  run(["effect", "disable", frame, effect]);
  run(["effect", "enable", frame, effect]);
  run(["effect", "move", frame, effect, "1"]);
  run(["effect", "remove-stop", frame, effect, stop]);
  run(["effect", "remove", frame, effect]);
  run(["page", "paint", page, "#dedede", "--opacity", "80%"]);
  const temporaryPage = id("page", "add", "Temporary");
  run(["page", "remove", temporaryPage]);
  assert.equal(run(["page", "list"]).data.length, 2);
  await writeFile(path.join(project, "DESIGN.md"), "---\ncolors:\n  primary: '#667788'\n---\n");
  assert.equal(run(["token", "import", "DESIGN.md"]).data.ids.length, 1);
  assert.equal(run(["token", "import", "DESIGN.md"]).data.ids.length, 0);
  run(["token", "import", "../projects.json"], /attached project/i);
  const stroke = id("stroke", "draw", page, "[[1,2],[3,4]]");
  run(["stroke", "draw", page, "[[]]"], /unsupported/i);
  assert.deepEqual(run(["stroke", "list", page]).data[0].points, [[1,2], [3,4]]);
  run(["stroke", "erase", page, stroke]);
  const pin = id("comment", "add", page, "2", "3", "Align this");
  run(["comment", "edit", page, pin, "Move this"]);
  run(["comment", "remove", page, pin]);
  run(["undo"]);
  assert.equal(run(["comment", "list", page]).data[0].text, "Move this");
  run(["redo"]);
  assert.deepEqual(run(["comment", "list", page]).data, []);
  const layers = run(["layer", "list", "--page", page]).data;
  assert.equal(layers.find((l) => l.id === frame).style.borderRadius, "24px");
  run(["layer", "style", frame, "madeUpStyle", "12px"], /unsupported/i);
  run(["view", "open"], /desktop window/i);
  run(["preview", "layer", "rename", frame, "Before move"]);
  run(["move", "designs"]);
  run(["preview", "save"], /unavailable|No such file/i);
  run(["--folder", "designs", "preview", "save"], /no pending preview/i);
  run(["--folder", "designs", "archive"]);
  assert.equal(run(["list", "--archived"]).canvases[0].name, canvas);
  run(["--folder", "designs", "restore"]);
  assert.equal(run(["--folder", "designs", "read"]).data.elements.length, 2);
  console.log(count + " Canvas CLI calls passed on an isolated server.");
} finally {
  child.kill();
  await exited;
  await rm(home, { recursive: true, force: true });
}
