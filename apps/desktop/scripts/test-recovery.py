import concurrent.futures
import hashlib
import json
import os
import pathlib
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[3]
SERVER = ROOT / 'apps/desktop/src-tauri/target/debug/carbon-serve'
home = pathlib.Path(tempfile.mkdtemp(prefix='cbn103-recovery-'))
for directory in ['bin', 'sessions', 'repo', 'claude/projects/fixture']:
    (home / directory).mkdir(parents=True, exist_ok=True)
for args in [['init', '-q'], ['config', 'user.name', 'Fixture'], ['config', 'user.email', 'fixture@example.test'], ['commit', '--allow-empty', '-qm', 'fixture']]:
    subprocess.run(['git', '-C', str(home / 'repo'), *args], check=True)
ids = {name: str(uuid.uuid4()) for name in ['active', 'approval', 'parent', 'child', 'unread', 'queued', 'uncertain', 'retry', 'fx']}
rows = [dict(sessionId=id, harness='claude_code', cwd=str(home / 'repo'), projectPath=str(home / 'repo'), branch='main', worktreeName=None, title=name, titleLocked=True, model='sonnet', effort='high', permissionMode='plan', fast=False, status='completed' if name == 'unread' else 'idle', created='2026-11-16T12:00:00Z', modified='2026-11-16T12:00:00Z', archived=False, pinned=False) for name, id in ids.items()]
for item in rows:
    if item['sessionId'] == ids['fx']:
        item.update(harness='fx', model='', effort=None, threadId=ids['fx'])
(home / 'sessions/index.json').write_text(json.dumps(rows))
fixture = pathlib.Path(__file__).parent / 'fixtures/task-claude.py'
(home / 'bin/claude').write_text(f'#!{sys.executable}\n' + fixture.read_text())
(home / 'bin/claude').chmod(0o755)
(home / 'bin/fx').write_text(f'#!{sys.executable}\n' + (pathlib.Path(__file__).parent / 'fixtures/recovery-fx.py').read_text())
(home / 'bin/fx').chmod(0o755)
env = {**os.environ, 'CARBON_HOME': str(home), 'CARBON_NO_ANALYTICS': '1', 'CLAUDE_CONFIG_DIR': str(home / 'claude'), 'PATH': str(home / 'bin') + ':' + os.environ['PATH']}
server = None
preview = '--preview' in sys.argv
damage = sys.argv[sys.argv.index('--startup-damage') + 1] if '--startup-damage' in sys.argv else None


def wait_for(fn, seconds=15):
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
    raise AssertionError(f'timed out: {last}; {(home / "server.log").read_text()[-2000:]}')


def request(**data):
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
    result = json.loads(buf)
    while result.get('status') == 'recorded':
        result = result['response']
    return result


def start():
    global server
    server = subprocess.Popen([str(SERVER), '--port', '0'], env=env, stdout=(home / 'server.log').open('a'), stderr=subprocess.STDOUT, start_new_session=True)
    wait_for(lambda: server.poll() is None and request(v=6, cmd='list_sessions', all=True).get('status') == 'listed')


def stop():
    global server
    if server and server.poll() is None:
        os.killpg(server.pid, signal.SIGKILL)
        server.wait()
    server = None


def ws(cmd, args):
    js = "const fs=require('fs'),i=JSON.parse(fs.readFileSync(0,'utf8')),p=fs.readFileSync(i.home+'/serve-port','utf8').trim().split(/\\s+/)[0],t=fs.readFileSync(i.home+'/serve-token','utf8').trim(),s=new WebSocket('ws://127.0.0.1:'+p);const timer=setTimeout(()=>process.exit(1),10000);s.onopen=()=>s.send(JSON.stringify({v:1,token:t}));s.onmessage=e=>{const v=JSON.parse(e.data);if(v.v===1)s.send(JSON.stringify({id:1,cmd:i.cmd,args:i.args}));if(v.id===1){console.log(JSON.stringify(v));clearTimeout(timer);s.close()}}"
    result = subprocess.run(['node', '-e', js], input=json.dumps(dict(home=str(home), cmd=cmd, args=args)), text=True, capture_output=True, check=True, timeout=15)
    return json.loads(result.stdout)


def send(name, text, key=None, task=False):
    args = dict(v=19 if task else 18 if key else 6, cmd='send_message', sessionId=ids[name], prompt=text)
    if key:
        args.update(durable=True, requestId=key)
    if task:
        args.update(fromSessionId=ids['parent'], task=dict(awaited=False))
    result = request(**args)
    assert result['status'] != 'error', result
    return result


def recovery(name=None):
    result = request(v=21, cmd='recovery', action='list', sessionId=ids[name] if name else None)
    assert result['status'] == 'recovery', result
    return result['value']


def task_status(task):
    return request(v=19, cmd='task', action='status', taskId=task['taskId'])['task']


def received():
    path = home / 'received.jsonl'
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def delivery_path(id):
    return home / 'agent-inbox' / (hashlib.sha256(id.encode()).hexdigest() + '.json')


def row(name):
    return next(row for row in json.loads((home / 'sessions/index.json').read_text()) if row['sessionId'] == ids[name])


def delivery_state(name, id):
    return request(v=18, cmd='delivery_status', sessionId=ids[name], messageId=id)['delivery']['state']


if damage in ['partial', 'unknown']:
    rows[0]['status'] = 'in_progress'
    (home / 'sessions/index.json').write_text(json.dumps(rows))
    (home / 'sessions' / (ids['active'] + '.jsonl')).write_text('{"id":' if damage == 'partial' else json.dumps(dict(id='future', sessionId=ids['active'], harness='claude_code', seq=0, ts='2026-11-16T12:00:00Z', payload=dict(type='future_event'))))
if damage in ['inbox', 'receipt']:
    directory = home / ('agent-inbox' if damage == 'inbox' else 'orchestration-requests/scope')
    directory.mkdir(parents=True)
    (directory / 'broken.json').write_text('{')
    (directory / 'future.json').write_text(json.dumps(dict(version=999)))
if damage in ['registry', 'registry-record', 'registry-version']:
    directory = home / 'delegated-tasks'
    directory.mkdir()
    (directory / (hashlib.sha256(b'registry').hexdigest() + '.json')).write_text('{' if damage == 'registry' else json.dumps(dict(version=999, tasks={}) if damage == 'registry-version' else dict(version=1, tasks=dict(opaque=dict(future='keep me')))))

try:
    start()
    if damage:
        assert request(v=6, cmd='list_sessions', all=True)['status'] == 'listed'
        assert ws('list_work_recovery', {}).get('err') is None
        print('PASS startup damage isolation', damage, home, flush=True)
        sys.exit(0)
    send('active', 'TASK_HOLD')
    send('approval', 'TASK_QUESTION')
    send('queued', 'TASK_HOLD')
    wait_for(lambda: len(received()) >= 3)
    asks = ws('live_state', {})['ok']['asks']
    old_ask = next(ask['payload']['requestId'] for ask in asks if ask['sessionId'] == ids['approval'])
    queued = send('queued', 'accepted before restart', 'queued')['delivery']
    active_task = send('child', 'TASK_HOLD', 'task', task=True)['task']
    wait_for(lambda: task_status(active_task)['state'] == 'running')
    follow = send('child', 'accepted task follow-up', 'follow')['delivery']
    stop()

    reserved_request = dict(cmd='create_session', prompt='must never auto-run', projectPath=str(home / 'repo'), requestId='reserved', issues=[], hidden=False)
    payload = {key: value for key, value in reserved_request.items() if key != 'requestId'}
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    receipt = dict(requestId='reserved', operationId=str(uuid.uuid4()), sessionId=ids['active'], worktreeName='reserved-tree')
    scope = hashlib.sha256(b'["local",null]').hexdigest()
    registry_path = next((home / 'delegated-tasks').glob('*.json'))
    registry = json.loads(registry_path.read_text())
    registry['tasks']['opaque'] = dict(future='keep me')
    registry_path.write_text(json.dumps(registry))
    directory = home / 'orchestration-requests' / scope
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (hashlib.sha256(b'reserved').hexdigest() + '.json')
    path.write_text(json.dumps(dict(version=1, fingerprint=fingerprint, receipt=receipt, response=None, error=None)))
    start()
    active = next(item for item in recovery('active') if item['kind'] == 'session')
    assert active['action'] == 'resume' and active['details']['reason'] == 'server_restart'
    assert row('unread')['status'] == 'completed' and 'interruption' not in row('unread')
    assert len([r for r in received() if r['id'] == ids['active']]) == 1
    assert ws('live_state', {})['ok']['asks'] == []
    denied = ws('answer_questions', dict(sessionId=ids['approval'], requestId=old_ask, answers={'Which target?': 'Local'}))
    assert 'err' in denied, denied
    wait_for(lambda: delivery_state('queued', queued['messageId']) == 'submitted')
    wait_for(lambda: task_status(active_task)['result'])
    assert task_status(active_task)['state'] == 'succeeded', task_status(active_task)
    assert json.loads(registry_path.read_text())['tasks']['opaque'] == dict(future='keep me')
    assert task_status(active_task)['result']['text'].startswith('done')
    operation = next(item for item in recovery() if item['id'] == receipt['operationId'])
    assert operation['action'] == 'inspect' and operation['kind'] == 'operation' and operation['sessionExists']
    assert request(v=21, cmd='recovery', action='dismiss', sessionId=ids['active'], id=operation['id'])['value'] is True
    assert not any(item['id'] == operation['id'] for item in recovery())
    assert request(v=16, **reserved_request)['status'] == 'uncertain'
    reserved_response = request(v=16, **reserved_request)
    assert reserved_response['status'] == 'uncertain', reserved_response
    print('PASS startup barrier, unread preservation, expired callback, reservation inspection and pending task follow-up', flush=True)

    stop()
    start()
    assert next(item for item in recovery('active') if item['kind'] == 'session')['id'] == active['id']
    assert not any(item['id'] == receipt['operationId'] for item in recovery())
    assert len([r for r in received() if queued['messageId'] in r['text']]) == 1
    assert len([r for r in received() if follow['messageId'] in r['text']]) == 1
    assert task_status(active_task)['state'] == 'succeeded'
    args = dict(v=21, cmd='recovery', action='resume', sessionId=ids['active'], id=active['id'])
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda _: request(**args), range(6)))
    assert all(result['status'] == 'recovery' for result in results), results
    assert len({result['value']['messageId'] for result in results}) == 1
    message = results[0]['value']['messageId']
    wait_for(lambda: delivery_state('active', message) == 'submitted')
    wait_for(lambda: any(message in record['text'] for record in received()))
    assert len([record for record in received() if message in record['text']]) == 1
    assert row('active')['interruption']['resumedAt']
    assert row('active')['interruption']['id'] == active['id']
    assert ws('recover_work', dict(sessionId=ids['active'], id=active['id'], action='resume'))['ok']['messageId'] == message
    print('PASS repeatable recovery, concurrent Resume deduplication, immediate continuation and WebSocket parity', flush=True)

    send('uncertain', 'TASK_HOLD')
    ambiguous = send('uncertain', 'must not silently replay', 'ambiguous')['delivery']
    send('retry', 'TASK_HOLD')
    retry = send('retry', 'safe explicit retry', 'retry')['delivery']
    stop()
    for summary, state in [(ambiguous, 'submitting'), (retry, 'failed')]:
        path = delivery_path(summary['messageId'])
        record = json.loads(path.read_text())
        record['summary']['state'] = state
        record['summary']['detail'] = 'Failed before submission.' if state == 'failed' else None
        path.write_text(json.dumps(record))
    start()
    assert delivery_state('uncertain', ambiguous['messageId']) == 'uncertain'
    uncertain_items = recovery('uncertain')
    assert next(item for item in uncertain_items if item['kind'] == 'delivery')['action'] == 'inspect'
    uncertain_session = next(item for item in uncertain_items if item['kind'] == 'session')
    assert uncertain_session['action'] == 'inspect'
    assert request(v=21, cmd='recovery', action='resume', sessionId=ids['uncertain'], id=uncertain_session['id'])['status'] == 'error'
    assert request(v=21, cmd='recovery', action='retry', sessionId=ids['uncertain'], id=ambiguous['messageId'])['status'] == 'error'
    assert request(v=21, cmd='recovery', action='dismiss', sessionId=ids['uncertain'], id=ambiguous['messageId'])['value'] is True
    assert next(item for item in recovery('uncertain') if item['kind'] == 'session')['action'] == 'resume'
    assert not any(ambiguous['messageId'] in record['text'] for record in received())
    assert next(item for item in recovery('retry') if item['kind'] == 'delivery')['action'] == 'retry'
    assert request(v=21, cmd='recovery', action='retry', sessionId=ids['retry'], id=retry['messageId'])['value']['state'] == 'accepted'
    wait_for(lambda: delivery_state('retry', retry['messageId']) == 'submitted')
    assert len([record for record in received() if retry['messageId'] in record['text']]) == 1
    stop()
    start()
    assert delivery_state('uncertain', ambiguous['messageId']) == 'uncertain'
    assert len([record for record in received() if retry['messageId'] in record['text']]) == 1
    assert not any(item['id'] == ambiguous['messageId'] for item in recovery('uncertain'))
    assert request(v=21, cmd='recovery', action='resume', sessionId=ids['active'], id='stale')['status'] == 'error'
    print('PASS uncertain side effects stay fenced, known pre-submission failures retry safely, stale recovery refused', flush=True)

    send('active', 'completed before status persisted')
    wait_for(lambda: row('active')['status'] == 'completed')
    stop()
    rows = json.loads((home / 'sessions/index.json').read_text())
    for item in rows:
        if item['sessionId'] == ids['active']:
            item['status'] = 'in_progress'
    (home / 'sessions/index.json').write_text(json.dumps(rows))
    start()
    assert row('active')['status'] == 'completed'
    assert not recovery('active')
    print('PASS completion evidence repairs stale running state without inventing an interruption', flush=True)
    assert 'err' not in ws('set_session_flags', dict(sessionId=ids['approval'], archived=True))
    assert next(item for item in recovery('approval') if item['kind'] == 'session')['action'] == 'inspect'
    assert 'err' not in ws('set_session_flags', dict(sessionId=ids['approval'], archived=False))
    def fx_send(text):
        result = ws('send_msg', dict(sessionId=ids['fx'], prompt=text, attachmentPaths=[], harness='fx', model='', effort=None, permissionMode='plan', fast=False, cwd=str(home / 'repo'), useWorktree=False, isNewSession=False))
        assert 'err' not in result, result
        return result['ok']
    fx_send('FX_HOLD')
    wait_for(lambda: row('fx')['status'] == 'in_progress')
    rows = json.loads((home / 'sessions/index.json').read_text())
    for item in rows:
        if item['sessionId'] == ids['fx']:
            item['interruption'] = dict(id='fx-pending', reason='server_restart', message='Pending recovery', at='2026-11-16T12:00:00Z', resumedAt=None)
    (home / 'sessions/index.json').write_text(json.dumps(rows))
    assert fx_send('fx queued follow-up')['queued']
    (home / 'finish-fx').touch()
    wait_for(lambda: row('fx')['interruption']['resumedAt'])
    wait_for(lambda: row('fx')['status'] != 'in_progress')
    fx_send('FX_DIE')
    wait_for(lambda: row('fx').get('interruption', {}).get('reason') == 'process_exited')
    assert row('fx')['interruption']['resumedAt'] is None
    wait_for(lambda: any(event['payload'].get('stopReason') == 'process_exited' and event['payload'].get('head') for event in [json.loads(line) for line in (home / 'sessions' / (ids['fx'] + '.jsonl')).read_text().splitlines()]))
    print('PASS fx queued submission retires recovery and dead-child reason persists', flush=True)
    (home / 'result.json').write_text(json.dumps(dict(passed=True, home=str(home), pid=server.pid, sessions=ids), indent=2))
    print('ALL RECOVERY REPLAYS PASSED', home, flush=True)
finally:
    if not preview or sys.exc_info()[0] is not None:
        stop()
