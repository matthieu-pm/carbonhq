#!/usr/bin/env python3
import json
import sys
import uuid

state = ""
identity = str(uuid.uuid4())
held = None

def send(value):
    print(json.dumps(value), flush=True)

def answer(request_id, result):
    send({"jsonrpc": "2.0", "id": request_id, "result": result})

for line in sys.stdin:
    message = json.loads(line)
    method = message.get("method")
    request_id = message.get("id")
    params = message.get("params", {})
    if not method:
        if held is not None:
            answer(held, {"content": [{"type": "text", "text": message["result"]["action"]}]})
            held = None
        continue
    if request_id is None:
        continue
    if method == "initialize":
        answer(request_id, {})
    elif method == "config/read":
        answer(request_id, {"config": {"mcp_servers": {"unrelated": {"url": "https://unrelated.example/mcp"}}}})
    elif method == "thread/start":
        assert params["config"]["mcp_servers"]["unrelated"]["enabled"] is False
        answer(request_id, {"thread": {"id": identity}})
    elif method == "mcpServerStatus/list":
        answer(request_id, {"data": [{"name": "fixture", "runtimeStatus": "connected", "authStatus": "oAuth",
            "serverInfo": {"name": "fixture", "version": "1", "icons": None}, "tools": {
                name: {"name": name, "description": name, "title": None, "inputSchema": {"type": "object", "properties": {"nullable": {"type": ["string", "null"], "default": None}}}} for name in ("echo", "state", "ask", "fail", "slow")},
            "resources": [{"uri": "fixture://read", "name": "read"}], "resourceTemplates": []}]})
    elif method == "mcpServer/tool/call":
        tool = params["tool"]
        args = params.get("arguments", {})
        if tool == "slow":
            send({"jsonrpc": "2.0", "method": "fixture/slow-started", "params": {}})
            continue
        if tool == "ask":
            held = request_id
            send({"jsonrpc": "2.0", "id": "native-ask", "method": "mcpServer/elicitation/request", "params": {
                "threadId": identity, "serverName": "fixture", "mode": "form", "message": "Fixture approval",
                "requestedSchema": {"type": "object", "properties": {}}}})
            continue
        if tool == "state":
            state = args.get("value", state)
            text = json.dumps({"identity": identity, "value": state})
        else:
            text = args.get("value", "fixture-error" if tool == "fail" else "")
        answer(request_id, {"content": [{"type": "text", "text": text}], "isError": tool == "fail", "structuredContent": {"retained": True}})
    elif method == "mcpServer/resource/read":
        answer(request_id, {"contents": [{"uri": params["uri"], "text": "resource-ok"}]})
    else:
        send({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "unsupported fixture request"}})
