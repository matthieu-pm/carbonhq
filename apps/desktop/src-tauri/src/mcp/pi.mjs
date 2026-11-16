const servers = /* CARBON_SERVERS */;

export default async function (pi) {
  const connections = [];
  let nextId = 0;

  async function request(connection, method, params, signal) {
    const id = ++nextId;
    const response = await fetch(connection.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...(connection.session ? { "Mcp-Session-Id": connection.session } : {}),
        ...(connection.version ? { "Mcp-Protocol-Version": connection.version } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(300_000)]) : AbortSignal.timeout(300_000),
    });
    if (!response.ok) throw new Error(`MCP server ${connection.name} is unavailable. Check Settings → MCP.`);
    connection.session = response.headers.get("mcp-session-id") ?? connection.session;
    const text = await response.text();
    const messages = response.headers.get("content-type")?.startsWith("text/event-stream")
      ? text.split(/\r?\n\r?\n/).flatMap((event) => {
          const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          return data ? [JSON.parse(data)] : [];
        })
      : [JSON.parse(text)];
    const answer = messages.find((message) => message.id === id);
    if (answer?.error) throw new Error(answer.error.message);
    if (!answer) throw new Error(`MCP server ${connection.name} returned no response.`);
    return answer.result;
  }

  for (const [name, url] of Object.entries(servers)) {
    const connection = { name, url };
    try {
      const initialized = await request(connection, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "carbon", version: "1" },
      });
      connection.version = initialized.protocolVersion;
      connection.instructions = initialized.instructions;
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Mcp-Protocol-Version": connection.version,
          ...(connection.session ? { "Mcp-Session-Id": connection.session } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
      let cursor;
      do {
        const page = await request(connection, "tools/list", cursor ? { cursor } : {});
        for (const tool of page.tools ?? []) {
          pi.registerTool({
            name: `mcp__${name}__${tool.name}`,
            label: `${name} · ${tool.title ?? tool.name}`,
            description: tool.description ?? tool.name,
            parameters: tool.inputSchema,
            async execute(_id, args, signal) {
              const result = await request(connection, "tools/call", { name: tool.name, arguments: args }, signal);
              if (result.isError) throw new Error(result.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") || `${name} couldn't run ${tool.name}.`);
              return { content: result.content ?? [], details: result };
            },
          });
        }
        cursor = page.nextCursor;
      } while (cursor);
      connections.push(connection);
    } catch (error) {
      pi.on("session_start", (_event, context) => context.ui.notify(String(error.message), "error"));
    }
  }

  pi.on("before_agent_start", (event) => ({
    systemPrompt: event.systemPrompt + connections.filter((c) => c.instructions).map((c) => `\n\n${c.instructions}`).join(""),
  }));
  pi.on("session_shutdown", async () => {
    await Promise.allSettled(connections.map((connection) => fetch(connection.url, {
      method: "DELETE",
      headers: connection.session ? { "Mcp-Session-Id": connection.session } : {},
    })));
  });
}
