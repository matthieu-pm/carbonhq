import sys, os, json, pathlib, time
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
log = home / 'claude/projects/fixture' / f'{id}.jsonl'
log.touch(exist_ok=True)
with (home / 'spawns.jsonl').open('a') as file:
    file.write(json.dumps(dict(id=id, args=args)) + '\n')

def emit(v):
    print(json.dumps(v), flush=True)

def result():
    emit(dict(type='result', subtype='success', session_id=id, is_error=False, result='done', duration_ms=1, duration_api_ms=1, num_turns=1, total_cost_usd=0, modelUsage={}, usage=dict(input_tokens=0, output_tokens=0, cache_read_input_tokens=0, cache_creation_input_tokens=0)))
while (home / f'block-{id}').exists():
    time.sleep(0.05)
for line in sys.stdin:
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        continue
    if data['type'] == 'control_request':
        request = data['request']
        emit(dict(type='control_response', response=dict(subtype='success', request_id=data['request_id'], response={})))
        if request['subtype'] == 'interrupt':
            result()
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
    if text == 'DIE':
        sys.exit(0)
    if text != 'HOLD':
        result()
