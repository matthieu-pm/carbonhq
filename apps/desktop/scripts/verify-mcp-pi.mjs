import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";

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
    const source = (await readFile(new URL("../src-tauri/src/mcp/pi.mjs", import.meta.url), "utf8"))
      .replace("/* CARBON_SERVERS */", JSON.stringify({ docs: url }));
    const extension = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
    const tools = new Map();
    const events = new Map();
    await extension.default({ registerTool: (tool) => tools.set(tool.name, tool), on: (name, fn) => events.set(name, fn) });
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
