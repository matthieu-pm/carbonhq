import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const binary = process.argv[2] ?? fileURLToPath(new URL("../src-tauri/target/debug/carbon-serve", import.meta.url));
const home = await mkdtemp(join(tmpdir(), "carbon-reconnect-"));
const sessions = join(home, "sessions");
await mkdir(sessions);
const count = 32;
const now = new Date().toISOString();
const index = Array.from({ length: count }, (_, i) => ({
  sessionId: `measure-${i}`, harness: "claude_code", cwd: home, projectPath: home,
  title: `Reconnect ${i}`, created: now, modified: now, archived: false, pinned: false, tokens: 0,
}));
await writeFile(join(sessions, "index.json"), JSON.stringify(index));
for (const item of index) {
  const log = Array.from({ length: 1024 }, (_, seq) => JSON.stringify({
    id: `e${seq}`, sessionId: item.sessionId, harness: "claude_code", seq, ts: now,
    turnId: null, subagent: null, payload: { type: "assistant_text", text: "x".repeat(16 * 1024) },
  }) + "\n").join("");
  await writeFile(join(sessions, `${item.sessionId}.jsonl`), log);
}

const child = spawn(binary, ["--port", "0"], {
  env: { ...process.env, CARBON_HOME: home, CARBON_NO_ANALYTICS: "1" },
  stdio: ["ignore", "ignore", "pipe"],
});
const rss = () => Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8" }).trim()) * 1024;
let ws;
try {
  await new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error("server did not start")), 30_000);
    child.once("error", reject);
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${log}`)); });
    child.stderr.on("data", (chunk) => {
      log += chunk;
      if (log.includes("carbon-serve listening on")) { clearTimeout(timer); resolve(); }
    });
  });
  const port = (await readFile(join(home, "serve-port"), "utf8")).split("\n")[0];
  const token = (await readFile(join(home, "serve-token"), "utf8")).trim();
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const waiting = new Map();
  let next = 0;
  let payloadBytes = 0;
  const live = new Promise((resolve) => {
    ws.addEventListener("message", ({ data }) => {
      const frame = JSON.parse(data);
      if (frame.event === "live_state") resolve(frame.payload);
      if (frame.id != null) {
        payloadBytes += Buffer.byteLength(data);
        const call = waiting.get(frame.id);
        waiting.delete(frame.id);
        if (frame.err != null) call?.reject(new Error(String(frame.err)));
        else call?.resolve(frame.ok);
      }
    });
  });
  ws.addEventListener("close", () => {
    for (const call of waiting.values()) call.reject(new Error("socket closed"));
    waiting.clear();
  });
  await once(ws, "open");
  ws.send(JSON.stringify({ v: 1, token }));
  assert.ok(await live);
  const call = (cmd, args) => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, cmd, args }));
  });
  const startRss = rss();
  let peakRss = startRss;
  const timer = setInterval(() => { peakRss = Math.max(peakRss, rss()); }, 50);
  const start = performance.now();
  let recovered;
  try {
    recovered = await Promise.all(index.map(({ sessionId }) => call("get_session_recovery", { sessionId, after: ["e0"] })));
  } finally { clearInterval(timer); }
  const elapsedMs = performance.now() - start;
  assert.ok(recovered.every((r) => r.reset && r.events.length <= 512 && r.olderBefore != null));
  const reconnectBytes = payloadBytes;
  const events = [...recovered[0].events];
  let before = recovered[0].olderBefore;
  while (before != null) {
    const page = await call("get_session_page", { sessionId: index[0].sessionId, before, turns: 16 });
    assert.ok(page.olderBefore == null || page.olderBefore < before);
    events.unshift(...page.events);
    before = page.olderBefore;
  }
  assert.deepEqual(events.map((e) => e.id), Array.from({ length: 1024 }, (_, i) => `e${i}`));
  const resumed = await call("get_session_recovery", { sessionId: index[0].sessionId, after: ["e1020", "unlogged"] });
  assert.equal(resumed.reset, false);
  assert.deepEqual(resumed.events.map((e) => e.id), ["e1021", "e1022", "e1023"]);
  console.log(JSON.stringify({ sessions: count, reconnectBytes, elapsedMs, startRss, peakRss, historyEvents: events.length }));
} finally {
  ws?.close();
  if (child.exitCode == null && child.signalCode == null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
  await rm(home, { recursive: true, force: true });
}
