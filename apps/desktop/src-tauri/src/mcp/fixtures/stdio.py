import json
import os
import sys

value = None
for line in sys.stdin:
    message = json.loads(line)
    method = message.get("method")
    if method == "initialize":
        result = {
            "protocolVersion": "2025-06-18",
            "capabilities": {"tools": {}, "resources": {}, "prompts": {}},
            "serverInfo": {"name": "fixture", "version": "1"},
            "instructions": "Keep this server's instructions verbatim.\nSecond line.",
            "_meta": {"fixture": True},
        }
    elif method == "tools/list":
        result = {"tools": [{"name": "state", "description": "Read or write this session's value.", "inputSchema": {"type": "object", "properties": {"value": {"type": "string"}}}}]}
    elif method == "tools/call":
        arguments = message["params"].get("arguments", {})
        value = arguments.get("value", value)
        if value == "exit":
            sys.exit(1)
        result = {"content": [{"type": "text", "text": json.dumps({"value": value, "pid": os.getpid()})}]}
    elif method in ("resources/list", "resources/templates/list", "prompts/list"):
        result = {"resources": [], "resourceTemplates": [], "prompts": []}
    elif method == "fixture/notify":
        print(json.dumps({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"}), flush=True)
        result = {}
    elif method and method.startswith("notifications/"):
        continue
    else:
        result = {}
    if "id" in message:
        print(json.dumps({"jsonrpc": "2.0", "id": message["id"], "result": result}), flush=True)
