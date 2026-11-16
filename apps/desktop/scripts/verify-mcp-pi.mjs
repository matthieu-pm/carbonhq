import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";

async function loadExtension(servers) {
  const source = (await readFile(new URL("../src-tauri/src/mcp/pi.mjs", import.meta.url), "utf8"))
    .replace("/* CARBON_SERVERS */", JSON.stringify(servers));
  const extension = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const tools = new Map();
  const events = new Map();
  await extension.default({ registerTool: (tool) => tools.set(tool.name, tool), on: (name, fn) => events.set(name, fn) });
  return { tools, events };
}

test("Pi keeps server names, instructions, concurrent responses and tool errors", async () => {
  const calls = [];
  const server = createServer(async (request, response) => {
    if (request.method === "DELETE") return response.end();
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks));
    calls.push(message);
    if (!message.id) { response.writeHead(202); return response.end(); }
    let result;
    if (message.method === "initialize") result = {
      protocolVersion: "2025-06-18", capabilities: { tools: {} },
      serverInfo: { name: "fixture", version: "1" }, instructions: "Exact instructions.\nKeep this line.",
    };
    if (message.method === "tools/list") result = { tools: ["echo", "fail"].map((name) => ({
      name, description: name, inputSchema: { type: "object", properties: { value: { type: "string" } } },
    })) };
    if (message.method === "tools/call") {
      if (message.params.arguments.value === "slow") await new Promise((resolve) => setTimeout(resolve, 20));
      result = { content: [{ type: "text", text: message.params.arguments.value }], isError: message.params.name === "fail" };
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const url = `http://127.0.0.1:${server.address().port}/mcp`;
    const { tools, events } = await loadExtension({ docs: url });
    assert.deepEqual([...tools.keys()], ["mcp__docs__echo", "mcp__docs__fail"]);
    assert.equal(events.get("before_agent_start")({ systemPrompt: "Base" }).systemPrompt, "Base\n\nExact instructions.\nKeep this line.");
    const echo = tools.get("mcp__docs__echo");
    const [slow, fast] = await Promise.all([echo.execute("a", { value: "slow" }), echo.execute("b", { value: "fast" })]);
    assert.equal(slow.content[0].text, "slow");
    assert.equal(fast.content[0].text, "fast");
    await assert.rejects(tools.get("mcp__docs__fail").execute("c", { value: "tool refused" }), /tool refused/);
    assert.equal(calls.filter((call) => call.method === "initialize").length, 1);
    await events.get("session_shutdown")();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("Pi retains instructions from a resource-only server", async () => {
  const methods = [];
  const server = createServer(async (request, response) => {
    if (request.method === "DELETE") return response.end();
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks));
    methods.push(message.method);
    if (!message.id) { response.writeHead(202); return response.end(); }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {
      protocolVersion: "2025-06-18", capabilities: { resources: {} },
      serverInfo: { name: "resources", version: "1" }, instructions: "Keep resource instructions.",
    } }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { tools, events } = await loadExtension({ resources: `http://127.0.0.1:${server.address().port}/mcp` });
    assert.equal(tools.size, 0);
    assert.equal(events.get("before_agent_start")({ systemPrompt: "Base" }).systemPrompt, "Base\n\nKeep resource instructions.");
    assert.deepEqual(methods, ["initialize", "notifications/initialized"]);
    await events.get("session_shutdown")();
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("Pi consumes a matching SSE reply while the server keeps its stream open", async () => {
  const server = createServer(async (request, response) => {
    if (request.method === "DELETE") return response.end();
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks));
    if (!message.id) { response.writeHead(202); return response.end(); }
    const result = message.method === "initialize" ? {
      protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "stream", version: "1" },
    } : message.method === "tools/list" ? {
      tools: [{ name: "echo", inputSchema: { type: "object" } }],
    } : { content: [{ type: "text", text: "réponse" }] };
    response.setHeader("content-type", "text/event-stream");
    const frame = Buffer.from(`event: message\r\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\r\n\r\n`);
    const split = frame.indexOf(Buffer.from("é"));
    response.write(frame.subarray(0, split > 0 ? split + 1 : frame.length - 1));
    setTimeout(() => response.write(frame.subarray(split > 0 ? split + 1 : frame.length - 1)), 10);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const deadline = AbortSignal.timeout(2000);
  try {
    const run = async () => {
      const { tools, events } = await loadExtension({ stream: `http://127.0.0.1:${server.address().port}/mcp` });
      const result = await tools.get("mcp__stream__echo").execute("call", {}, deadline);
      assert.equal(result.content[0].text, "réponse");
      await events.get("session_shutdown")();
    };
    await Promise.race([run(), new Promise((_, reject) => deadline.addEventListener("abort", () => reject(new Error("SSE response waited for EOF")), { once: true }))]);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
