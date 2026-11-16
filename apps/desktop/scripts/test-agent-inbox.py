import os, json, socket, subprocess, pathlib, tempfile, time, uuid, signal, hashlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[3]
SERVER = ROOT / 'apps/desktop/src-tauri/target/debug/carbon-serve'
home = pathlib.Path(tempfile.mkdtemp(prefix='cbn101-live-'))
(home / 'bin').mkdir()
(home / 'sessions').mkdir()
(home / 'repo').mkdir()
(home / 'claude/projects/fixture').mkdir(parents=True)
subprocess.run(['git', 'init', '-q', str(home / 'repo')], check=True)
subprocess.run(['git', '-C', str(home / 'repo'), 'config', 'user.name', 'Fixture'], check=True)
subprocess.run(['git', '-C', str(home / 'repo'), 'config', 'user.email', 'fixture@example.test'], check=True)
subprocess.run(['git', '-C', str(home / 'repo'), 'commit', '--allow-empty', '-qm', 'fixture'], check=True)
ids = {name: str(uuid.uuid4()) for name in ['recipient', 'sender', 'blocked', 'delete', 'forward']}
rows = [dict(sessionId=id, harness='claude_code', cwd=str(home / 'repo'), projectPath=str(home / 'repo'), branch='main', worktreeName=None, title=name, titleLocked=True, model='sonnet', effort='high', permissionMode='plan', fast=False, status='idle', created='2026-11-16T12:00:00Z', modified='2026-11-16T12:00:00Z', archived=False, pinned=False) for (name, id) in ids.items()]
(home / 'sessions/index.json').write_text(json.dumps(rows))
fake = home / 'bin/claude'
fake.write_text(f'#!{sys.executable}\n' + (pathlib.Path(__file__).parent / 'fixtures/inbox-claude.py').read_text())
fake.chmod(0o755)
env = {**os.environ, 'CARBON_HOME': str(home), 'CARBON_NO_ANALYTICS': '1', 'CLAUDE_CONFIG_DIR': str(home / 'claude'), 'HOME': str(home), 'PATH': str(home / 'bin') + ':' + os.environ['PATH']}
server = None

def wait_for(fn, seconds=12):
    until = time.monotonic() + seconds
    last = None
    while time.monotonic() < until:
        try:
            last = fn()
            if last:
                return last
        except (OSError, ValueError, KeyError):
            pass
        time.sleep(0.05)
    raise AssertionError(f"timed out; last={last}; log={(home / 'server.log').read_text()[-3000:]}")

def request(data):
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(10)
        sock.connect(str(home / 'carbon.sock'))
        sock.sendall((json.dumps(data) + '\n').encode())
        buf = b''
        while b'\n' not in buf:
            chunk = sock.recv(65536)
            if not chunk:
                break
            buf += chunk
    return json.loads(buf)

def unwrap(data):
    while data.get('status') == 'recorded':
        data = data['response']
    return data

def start():
    global server
    server = subprocess.Popen([str(SERVER), '--port', '0'], env=env, stdout=(home / 'server.log').open('a'), stderr=subprocess.STDOUT, start_new_session=True)
    wait_for(lambda : server.poll() is None and request(dict(v=6, cmd='list_sessions', all=True)).get('status') == 'listed')

def stop():
    global server
    if server and server.poll() is None:
        os.killpg(server.pid, signal.SIGKILL)
        server.wait()
    server = None

def send(name, text, key, durable=True, **kwargs):
    return unwrap(request(dict(v=17 if durable else 6, cmd='send_message', sessionId=ids[name], prompt=text, **dict(durable=True, requestId=key) if durable else {}, **kwargs)))

def status(name, id):
    return unwrap(request(dict(v=17, cmd='delivery_status', sessionId=ids[name], messageId=id)))['delivery']

def inbox_path(id):
    return home / 'agent-inbox' / f'{hashlib.sha256(id.encode()).hexdigest()}.json'

def received():
    p = home / 'received.jsonl'
    return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

def ws(cmd, args):
    js = "const fs=require('fs');const input=JSON.parse(fs.readFileSync(0,'utf8'));const home=input.home;const port=fs.readFileSync(home+'/serve-port','utf8').trim().split(/\\s+/)[0];const token=fs.readFileSync(home+'/serve-token','utf8').trim();const ws=new WebSocket('ws://127.0.0.1:'+port);const timer=setTimeout(()=>{console.error('timeout');process.exit(1)},10000);ws.onopen=()=>ws.send(JSON.stringify({v:1,token}));ws.onmessage=(event)=>{const data=JSON.parse(event.data);if(data.v===1)ws.send(JSON.stringify({id:1,cmd:input.cmd,args:input.args}));if(data.id===1){console.log(JSON.stringify(data));clearTimeout(timer);ws.close()}};"
    result = subprocess.run(['node', '-e', js], input=json.dumps(dict(home=str(home), cmd=cmd, args=args)), text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr
    out = json.loads(result.stdout)
    assert 'err' not in out, out
    return out.get('ok')
try:
    start()
    assert send('recipient', 'HOLD', None, False)['status'] == 'sent'
    wait_for(lambda : any((r['text'] == 'HOLD' for r in received())))
    first = send('recipient', 'first persisted', 'stable-1', fromSessionId=ids['sender'])['delivery']
    second = send('recipient', 'second persisted', 'stable-2')['delivery']
    assert first['state'] == 'accepted' and second['state'] == 'accepted', (first, second)
    assert send('recipient', 'first persisted', 'stable-1', fromSessionId=ids['sender'])['delivery']['messageId'] == first['messageId']
    assert len(list((home / 'agent-inbox').glob('*.json'))) == 2
    stop()
    receipt_path = next((path for path in (home / 'orchestration-requests').rglob('*.json') if json.loads(path.read_text())['receipt']['operationId'] == first['messageId']))
    reserved = json.loads(receipt_path.read_text())
    reserved['response'] = None
    reserved['error'] = None
    receipt_path.write_text(json.dumps(reserved))
    start()
    assert send('recipient', 'first persisted', 'stable-1', fromSessionId=ids['sender'])['delivery']['messageId'] == first['messageId']
    wait_for(lambda : status('recipient', second['messageId'])['state'] == 'submitted')
    delivered = [r for r in received() if '[Carbon delivery' in r['text']]
    assert [first['messageId'] in delivered[0]['text'], second['messageId'] in delivered[1]['text']] == [True, True], delivered
    assert len(delivered) == 2, delivered
    assert 'sender' in delivered[0]['text'] and ids['sender'] in delivered[0]['text']
    spawn = json.loads((home / 'spawns.jsonl').read_text().splitlines()[-1])['args']
    assert spawn[spawn.index('--model') + 1] == 'sonnet' and spawn[spawn.index('--permission-mode') + 1] == 'plan' and (spawn[spawn.index('--effort') + 1] == 'high'), spawn
    print('PASS accepted-before-dispatch crash, FIFO, dedupe, attribution, recorded settings', flush=True)
    assert send('recipient', 'HOLD', None, False)['status'] == 'sent'
    composer = ws('send_msg', dict(sessionId=ids['recipient'], prompt='composer only', attachmentPaths=[], harness='claude_code', model='sonnet', effort='high', permissionMode='plan', fast=False, cwd=str(home / 'repo'), useWorktree=False, isNewSession=False))
    assert composer['queued']['text'] == 'composer only'
    assert ws('cancel_queued', dict(sessionId=ids['recipient']))['text'] == 'composer only'
    cancel = send('recipient', 'cancel me', 'cancel')['delivery']
    out = request(dict(v=17, cmd='cancel_delivery', sessionId=ids['recipient'], messageId=cancel['messageId']))
    assert out['delivery']['state'] == 'canceled', out
    retained = send('recipient', 'retained across stop', 'stop')['delivery']
    request(dict(v=10, cmd='stop_session', sessionId=ids['recipient']))
    wait_for(lambda : status('recipient', retained['messageId'])['state'] == 'submitted')
    assert not any((cancel['messageId'] in r['text'] for r in received()))
    print('PASS explicit cancellation and Stop retains pending deliveries', flush=True)
    send('recipient', 'DIE', None, False)
    after_exit = send('recipient', 'after child exit', 'exit')['delivery']
    wait_for(lambda : status('recipient', after_exit['messageId'])['state'] == 'submitted')
    print('PASS dead-child handling and composer cancellation remain intact', flush=True)
    stop()
    record = json.loads(inbox_path(first['messageId']).read_text())
    record['summary']['state'] = 'submitting'
    inbox_path(first['messageId']).write_text(json.dumps(record))
    before = len(received())
    start()
    assert status('recipient', first['messageId'])['state'] == 'submitted'
    assert len(received()) == before
    print('PASS native harness evidence reconciles submission without resending', flush=True)
    (home / f"block-{ids['blocked']}").touch()
    stuck = send('blocked', 'x' * 500000, 'stuck')['delivery']
    wait_for(lambda : status('blocked', stuck['messageId'])['state'] == 'submitting')
    stop()
    (home / f"block-{ids['blocked']}").unlink()
    start()
    assert status('blocked', stuck['messageId'])['state'] == 'uncertain'
    time.sleep(0.5)
    assert not any((stuck['messageId'] in r['text'] for r in received()))
    print('PASS crash during transport remains uncertain and is not retried', flush=True)
    send('delete', 'HOLD', None, False)
    deleted = send('delete', 'target deleted', 'delete')['delivery']
    ws('delete_session', dict(sessionId=ids['delete']))
    assert status('delete', deleted['messageId'])['state'] == 'canceled'
    print('PASS target deletion cancels accepted mail', flush=True)
    forward = dict(v=17, cmd='send_message', sessionId=ids['forward'], prompt='forwarded payload', durable=True, requestId='forwarded-key', fromSessionId=ids['sender'])
    args = dict(line=json.dumps(forward), requestSource=str(uuid.uuid4()), sender=dict(sessionId=ids['sender'], title='Original remote sender', machine='remote-origin'))
    one = unwrap(ws('orchestrate', args))['delivery']
    two = unwrap(ws('orchestrate', args))['delivery']
    assert one['messageId'] == two['messageId'] and one['requestId'] == 'forwarded-key'
    wait_for(lambda : status('forward', one['messageId'])['state'] == 'submitted')
    assert len([r for r in received() if one['messageId'] in r['text']]) == 1
    assert 'Original remote sender' in next((r['text'] for r in received() if one['messageId'] in r['text']))
    print('PASS machine forwarding preserves identities and sender attribution', flush=True)
    (home / 'results.json').write_text(json.dumps(dict(passed=True, home=str(home), messages=len(list((home / 'agent-inbox').glob('*.json')))), indent=2))
    print('ARTIFACT', home, flush=True)
finally:
    stop()
