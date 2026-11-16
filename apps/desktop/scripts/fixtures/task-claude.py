import sys, os, json, pathlib, time, threading
args = sys.argv[1:]
if '--version' in args:
    print('2.1.322')
    sys.exit()
if 'mcp' in args:
    print('{"mcpServers":{}}')
    sys.exit()

def option(name, default=None):
    return args[args.index(name) + 1] if name in args else default

id = option('--session-id', option('--resume', 'probe'))
home = pathlib.Path(os.environ['CARBON_HOME'])
if '-w' in args:
    name = option('-w')
    root = pathlib.Path(os.getcwd()) / '.claude/worktrees' / name
    if not root.exists():
        import subprocess
        subprocess.run(['git', 'worktree', 'add', '-qb', 'worktree-' + name, str(root)], check=True, stdout=subprocess.DEVNULL)
    os.chdir(root)
log = home / 'claude/projects/fixture' / f'{id}.jsonl'
lock = threading.Lock()

def emit(value):
    with lock:
        print(json.dumps(value), flush=True)

def result(text='done [artifact](report.md)', reason=None):
    emit(dict(type='result', subtype='success', session_id=id, is_error=False, result=text, duration_ms=1, duration_api_ms=1, stop_reason=reason, num_turns=1, total_cost_usd=0, modelUsage={}, usage=dict(input_tokens=0, output_tokens=0, cache_read_input_tokens=0, cache_creation_input_tokens=0)))

def release():
    path = home / f'finish-{id}'
    while not path.exists():
        time.sleep(0.02)
    path.unlink()
    result()

for line in sys.stdin:
    data = json.loads(line)
    if data['type'] == 'control_response':
        result('question answered')
        continue
    if data['type'] == 'control_request':
        emit(dict(type='control_response', response=dict(subtype='success', request_id=data['request_id'], response={})))
        if data['request']['subtype'] == 'interrupt':
            result('interrupted', 'aborted_streaming')
        continue
    if data['type'] != 'user':
        continue
    with log.open('a') as file:
        file.write(json.dumps(data) + '\n')
        file.flush()
        os.fsync(file.fileno())
    text = data['message']['content']
    with (home / 'received.jsonl').open('a') as file:
        file.write(json.dumps(dict(id=id, text=text)) + '\n')
    emit(dict(type='system', subtype='init', session_id=id, cwd=os.getcwd(), tools=[], mcp_servers=[], model='sonnet', permissionMode='plan', slash_commands=[], claude_code_version='2.1.322', agents=[], fast_mode_state='off'))
    if 'TASK_HOLD' in text and 'Delegated task ' not in text:
        threading.Thread(target=release, daemon=True).start()
    elif 'TASK_QUESTION' in text:
        emit(dict(type='control_request', request_id='question-' + id, request=dict(subtype='can_use_tool', tool_name='AskUserQuestion', input=dict(questions=[dict(question='Which target?', header='Target', options=[dict(label='Local', description='Use local data'), dict(label='Preview', description='Use preview data')], multiSelect=False)]), requires_user_interaction=True, tool_use_id='ask-' + id)))
    else:
        if 'TASK_BACKGROUND' in text:
            emit(dict(type='system', subtype='task_started', task_id='dev-server', tool_use_id='server-call', description='Unrelated dev server', is_backgrounded=True, task_type='local_bash', uuid='background-event', session_id=id))
        result()
