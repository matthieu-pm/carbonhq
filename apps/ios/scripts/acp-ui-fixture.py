import asyncio
import copy
import json
from pathlib import Path

import websockets

sessions = {}
logs = Path("/tmp/carbon-cbn60-ios-fixture.jsonl")
options = [
    {
        "id": "model",
        "name": "Model",
        "category": "model",
        "currentValue": "fixture/default",
        "options": [{"value": "fixture/default", "name": "Fixture model"}],
    },
    {
        "id": "mode",
        "name": "Mode",
        "category": "mode",
        "currentValue": "code",
        "options": [
            {"value": "code", "name": "Code"},
            {"value": "plan", "name": "Plan"},
            {"value": "reject", "name": "Unavailable mode"},
        ],
    },
    {
        "id": "thinking",
        "name": "Thinking",
        "category": "thought_level",
        "currentValue": "off",
        "options": [
            {"value": "off", "name": "Off"},
            {"value": "minimal", "name": "Minimal"},
            {"value": "adaptive", "name": "Adaptive"},
        ],
    },
]
picks = {}
seq = 0


async def serve(ws):
    global seq
    await ws.recv()
    await ws.send(json.dumps({"v": 1, "dictation": False}))
    await ws.send(
        json.dumps(
            {"event": "live_state", "payload": {"asks": [], "tasks": [], "queued": []}}
        )
    )

    async def event(name, payload):
        await ws.send(json.dumps({"event": name, "payload": payload}))

    def opts(sid):
        result = copy.deepcopy(options)
        for option in result:
            option["currentValue"] = picks.get(sid, {}).get(
                option["id"], option["currentValue"]
            )
        return result

    def agent_event(sid, payload):
        global seq
        seq += 1
        e = {"id": str(seq), "sessionId": sid, "payload": payload}
        sessions[sid]["events"].append(e)
        return e

    async for raw in ws:
        req = json.loads(raw)
        if "cmd" not in req:
            continue
        cmd, args = req["cmd"], req.get("args", {})
        sid = args.get("sessionId")
        with logs.open("a") as log:
            log.write(json.dumps(req) + "\n")
        ok = None
        err = None
        if cmd == "list_session_index_items":
            ok = list(sessions.values())
        elif cmd == "list_projects":
            ok = [
                {
                    "path": "/tmp/cbn60-ios-repo",
                    "name": "ACP fixture",
                    "lastSelected": "2026-11-15T00:00:00Z",
                }
            ]
        elif cmd == "agent_availability":
            ok = [
                {
                    "harness": "acp:ios-fixture",
                    "available": True,
                    "label": "Fixture ACP",
                    "reason": "",
                }
            ]
        elif cmd == "agent_options":
            ok = opts(sid)
        elif cmd == "list_models":
            ok = []
        elif cmd == "list_branches":
            ok = {
                "current": "main",
                "branches": ["main"],
                "defaultBase": "main",
                "dirty": 0,
            }
        elif cmd == "pr_marks":
            ok = []
        elif cmd == "list_local_servers":
            ok = []
        elif cmd == "set_agent_option":
            if args["value"] == "reject":
                err = "Mode refused by fixture"
            elif sid in sessions and sessions[sid]["status"] == "in_progress":
                err = "Agent settings cannot change during a turn"
            else:
                picks.setdefault(sid, {})[args["configId"]] = args["value"]
                await event("models_changed", {"harness": "acp:ios-fixture"})
        elif cmd == "get_session_by_id":
            ok = sessions.get(sid)
        elif cmd == "send_msg":
            new = sid not in sessions
            if new:
                sessions[sid] = {
                    "sessionId": sid,
                    "harness": "acp:ios-fixture",
                    "cwd": "/tmp/cbn60-ios-repo",
                    "projectPath": "/tmp/cbn60-ios-repo",
                    "title": "ACP iOS fixture",
                    "model": "fixture/default",
                    "permissionMode": "bypassPermissions",
                    "status": "completed",
                    "modified": "2026-11-15T00:00:00Z",
                    "events": [],
                }
            entry = sessions[sid]
            e = agent_event(sid, {"type": "user_message", "text": args["prompt"]})
            await event("agent_event", e)
            if args["prompt"] == "HOLD":
                entry["status"] = "in_progress"
                await event(
                    "session_status",
                    {
                        "sessionId": sid,
                        "status": "in_progress",
                        "modified": "2026-11-15T00:00:01Z",
                    },
                )
            else:
                e = agent_event(sid, {"type": "assistant_text", "text": "ACP_READY"})
                await event("agent_event", e)
                e = agent_event(
                    sid,
                    {
                        "type": "turn_completed",
                        "status": "success",
                        "finalText": "ACP_READY",
                    },
                )
                await event("agent_event", e)
            ok = {"snapshot": entry if new else None, "queued": None}
        elif cmd == "interrupt_session":
            sessions[sid]["status"] = "completed"
            await event(
                "session_status",
                {
                    "sessionId": sid,
                    "status": "completed",
                    "modified": "2026-11-15T00:00:02Z",
                },
            )
        await ws.send(
            json.dumps(
                {"id": req["id"], "err": err} if err else {"id": req["id"], "ok": ok}
            )
        )


async def client(ws):
    try:
        await serve(ws)
    except websockets.ConnectionClosed:
        pass


async def main():
    async with websockets.serve(client, "127.0.0.1", 7438):
        print("ready: ws://127.0.0.1:7438", flush=True)
        await asyncio.Future()


try:
    asyncio.run(main())
except KeyboardInterrupt:
    pass
