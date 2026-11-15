import json
import sys
import uuid
from pathlib import Path

scenario = sys.argv[1]
authenticated = False
prompt_id = None


def send(value):
    print(json.dumps({"jsonrpc": "2.0", **value}), flush=True)


def answer(request, result):
    send({"id": request["id"], "result": result})


state_path = Path.cwd() / ".carbon-fake-acp-state.json"
trace_path = Path.cwd() / ".carbon-fake-acp-trace.jsonl"
workflow_sessions = json.loads(state_path.read_text()) if scenario == "workflow" and state_path.exists() else {}
workflow_prompt = None


def save_workflow():
    state_path.write_text(json.dumps(workflow_sessions))


def workflow_options(session):
    return [
        {"id": "model", "name": "Model", "type": "select", "category": "model",
         "currentValue": session["model"], "options": [
             {"value": "fake/model-a", "name": "Model A"}, {"value": "fake/model-b", "name": "Model B"}]},
        {"id": "mode", "name": "Mode", "type": "select", "category": "mode",
         "currentValue": session["mode"], "options": [
             {"value": "code", "name": "Code"}, {"value": "plan", "name": "Plan"},
             {"value": "reject", "name": "Rejected mode"}]},
        {"id": "thought", "name": "Thinking", "type": "select", "category": "thought_level",
         "currentValue": session["thought"], "options": [
             {"value": "off", "name": "Off"}, {"value": "minimal", "name": "Minimal"},
             {"value": "adaptive", "name": "Adaptive"}]},
    ]


def workflow_update(session_id, update):
    send({"method": "session/update", "params": {"sessionId": session_id, "update": update}})


def workflow_complete(prompt, permission=False):
    session_id = prompt["sessionId"]
    if permission:
        call_id = prompt["callId"]
        workflow_update(session_id, {"sessionUpdate": "tool_call", "toolCallId": call_id,
            "title": "Update workflow.txt", "kind": "edit", "status": "pending",
            "rawInput": {"path": str(Path.cwd() / "workflow.txt")}})
        workflow_update(session_id, {"sessionUpdate": "tool_call_update", "toolCallId": call_id,
            "status": "completed", "content": [{"type": "diff", "path": str(Path.cwd() / "workflow.txt"),
                "oldText": "before", "newText": "after"}]})
    workflow_update(session_id, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "ACP_OK"}})
    send({"id": prompt["id"], "result": {"stopReason": "end_turn"}})


def workflow_request(request):
    global workflow_prompt
    with trace_path.open("a") as trace:
        trace.write(json.dumps(request) + "\n")
    method = request.get("method")
    params = request.get("params", {})
    if method == "initialize":
        answer(request, {"protocolVersion": 1, "agentInfo": {"name": "fake-workflow", "version": "1"},
            "agentCapabilities": {"loadSession": True, "sessionCapabilities": {"resume": {}}}, "authMethods": []})
    elif method == "session/new":
        session_id = "workflow-" + str(uuid.uuid4())
        workflow_sessions[session_id] = {"model": "fake/model-a", "mode": "code", "thought": "off"}
        save_workflow()
        answer(request, {"sessionId": session_id, "configOptions": workflow_options(workflow_sessions[session_id])})
    elif method in ("session/resume", "session/load"):
        session_id = params["sessionId"]
        if session_id not in workflow_sessions:
            send({"id": request["id"], "error": {"code": -32602, "message": "Unknown session"}})
            return
        if method == "session/load":
            workflow_update(session_id, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "REPLAY_MUST_NOT_DUPLICATE"}})
        answer(request, {"configOptions": workflow_options(workflow_sessions[session_id])})
    elif method in ("session/set_config_option", "session/set_mode", "session/set_model"):
        session = workflow_sessions[params["sessionId"]]
        config_id = params.get("configId", "mode" if method == "session/set_mode" else "model")
        value = params.get("value", params.get("modeId", params.get("modelId")))
        allowed = {"model": ("fake/model-a", "fake/model-b"), "mode": ("code", "plan"),
            "thought": ("off", "minimal", "adaptive")}
        if value not in allowed.get(config_id, ()):
            send({"id": request["id"], "error": {"code": -32602, "message": "The fake agent rejected that setting"}})
            return
        session[config_id] = value
        save_workflow()
        answer(request, {"configOptions": workflow_options(session)})
    elif method == "session/prompt":
        text = "".join(part.get("text", "") for part in params.get("prompt", [])).strip()
        prompt = {"id": request["id"], "sessionId": params["sessionId"], "callId": "call-" + str(request["id"])}
        if text == "hold":
            workflow_prompt = prompt
        elif text == "permission":
            workflow_prompt = prompt
            send({"id": "permission-" + str(request["id"]), "method": "session/request_permission", "params": {
                "sessionId": params["sessionId"], "toolCall": {"toolCallId": prompt["callId"],
                    "title": "Update workflow.txt", "rawInput": {"path": str(Path.cwd() / "workflow.txt")}},
                "options": [{"optionId": "allow", "name": "Allow", "kind": "allow_once"},
                    {"optionId": "deny", "name": "Deny", "kind": "reject_once"}]}})
        else:
            workflow_complete(prompt)
    elif method == "session/cancel":
        if workflow_prompt is not None:
            send({"id": workflow_prompt["id"], "result": {"stopReason": "cancelled"}})
            workflow_prompt = None
    elif method is None and str(request.get("id", "")).startswith("permission-"):
        outcome = request.get("result", {}).get("outcome", {})
        if outcome.get("outcome") == "selected" and outcome.get("optionId") == "allow":
            workflow_complete(workflow_prompt, permission=True)
        else:
            send({"id": workflow_prompt["id"], "result": {"stopReason": "cancelled"}})
        workflow_prompt = None
    elif method == "authenticate":
        answer(request, {})
    else:
        send({"id": request.get("id"), "error": {"code": -32601, "message": "Unsupported fake method"}})


for line in sys.stdin:
    request = json.loads(line)
    if scenario == "workflow":
        workflow_request(request)
        continue
    method = request.get("method")
    if method == "initialize":
        answer(request, {
            "protocolVersion": 2 if scenario == "version" else 1,
            "agentCapabilities": {"loadSession": True},
            "agentInfo": {"name": "fake-agent", "version": "1"},
            "authMethods": [{"id": "browser", "name": "Browser", "type": "agent"}],
        })
    elif method == "session/new":
        if scenario == "exit":
            sys.exit(0)
        if scenario == "auth" and not authenticated:
            send({"id": request["id"], "error": {"code": -32000, "message": "Authentication required"}})
        else:
            answer(request, {"sessionId": "fake-session", "authenticated": authenticated})
    elif method == "authenticate":
        assert request["params"]["methodId"] == "browser"
        authenticated = True
        answer(request, {})
    elif method == "session/prompt":
        prompt_id = request["id"]
        if scenario == "permission":
            send({"id": "permission-string", "method": "session/request_permission", "params": {
                "sessionId": "fake-session",
                "toolCall": {"toolCallId": "call", "title": "Write file", "rawInput": {"path": "/test"}},
                "options": [{"optionId": "allow", "name": "Allow", "kind": "allow_once"}],
            }})
    elif method == "session/cancel":
        assert prompt_id is not None
        send({"id": prompt_id, "result": {"stopReason": "cancelled"}})
        prompt_id = None
    elif method is None and request.get("id") == "permission-string":
        assert request["result"]["outcome"] == {"outcome": "selected", "optionId": "allow"}
        send({"id": prompt_id, "result": {"stopReason": "end_turn"}})
        prompt_id = None
    else:
        raise AssertionError(request)
