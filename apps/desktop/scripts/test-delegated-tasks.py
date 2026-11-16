import os, json, socket, subprocess, pathlib, tempfile, time, uuid, signal, hashlib, sys
ROOT = pathlib.Path(__file__).resolve().parents[3]
SERVER = ROOT / 'apps/desktop/src-tauri/target/debug/carbon-serve'
home = pathlib.Path(tempfile.mkdtemp(prefix='cbn102-live-'))
(home / 'bin').mkdir()
(home / 'sessions').mkdir()
(home / 'repo').mkdir()
(home / 'claude/projects/fixture').mkdir(parents=True)
subprocess.run(['git', 'init', '-q', str(home / 'repo')], check=True)
subprocess.run(['git', '-C', str(home / 'repo'), 'config', 'user.name', 'Fixture'], check=True)
subprocess.run(['git', '-C', str(home / 'repo'), 'config', 'user.email', 'fixture@example.test'], check=True)
subprocess.run(['git', '-C', str(home / 'repo'), 'commit', '--allow-empty', '-qm', 'fixture'], check=True)
ids = {name: str(uuid.uuid4()) for name in ['parent', 'child', 'nested', 'grandchild', 'independent', 'question', 'replay', 'queued', 'follower']}
rows = [dict(sessionId=id, harness='claude_code', cwd=str(home / 'repo'), projectPath=str(home / 'repo'), branch='main', worktreeName=None, title=name, titleLocked=True, model='sonnet', effort='high', permissionMode='plan', fast=False, status='idle', created='2026-11-16T12:00:00Z', modified='2026-11-16T12:00:00Z', archived=False, pinned=False) for (name, id) in ids.items()]
(home / 'sessions/index.json').write_text(json.dumps(rows))
fake = home / 'bin/claude'
fake.write_text(f'#!{sys.executable}\n' + (pathlib.Path(__file__).parent / 'fixtures/task-claude.py').read_text())
fake.chmod(0o755)
pi = home / 'bin/pi'
pi.write_text(f'#!{sys.executable}\n' + (pathlib.Path(__file__).parent / 'fixtures/task-pi.py').read_text())
pi.chmod(0o755)
gh = home / 'bin/gh'
gh.write_text(f'#!{sys.executable}\n' + (pathlib.Path(__file__).parent / 'fixtures/inbox-gh.py').read_text())
gh.chmod(0o755)
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
    return unwrap(request(dict(v=19 if kwargs.get('task') else (18 if durable else 6), cmd='send_message', sessionId=ids[name], prompt=text, **dict(durable=True, requestId=key) if durable else {}, **kwargs)))

def status(name, id):
    return unwrap(request(dict(v=18, cmd='delivery_status', sessionId=ids[name], messageId=id)))['delivery']

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

def task(name, parent='parent', text='work', key=None, awaited=False):
    out = send(name, text, key or str(uuid.uuid4()), fromSessionId=ids[parent], task=dict(awaited=awaited))
    assert out['status'] == 'task', out
    return out['task']

def inspect(id, action='status', **kwargs):
    out = request(dict(v=19, cmd='task', action=action, taskId=id, **kwargs))
    assert out['status'] == 'task', out
    return out['task']

def finished(id):
    value = inspect(id)
    return value if value['result'] else None

def release(name):
    (home / f"finish-{ids[name]}").touch()

def count_wakes(task_id):
    return len([row for row in received() if 'Delegated task ' + task_id + ' completed.' in row['text']])

try:
    start()
    one = task('child', text='TASK_BACKGROUND', key='first-wave')
    first = wait_for(lambda: finished(one['taskId']))
    assert first['state'] == 'succeeded', first
    assert first['result']['sourceSessionId'] == ids['child'] and first['result']['tree'] and first['result']['commit']
    assert first['result']['references'] == ['report.md'], first
    wait_for(lambda: inspect(one['taskId'])['completionAcknowledged'])
    assert count_wakes(one['taskId']) == 1
    assert task('child', text='TASK_BACKGROUND', key='first-wave')['taskId'] == one['taskId']
    assert len(list((home / 'delegated-tasks').glob('*.json'))) == 1
    assert finished(one['taskId'])['result'] == first['result']
    two = task('child', text='second wave')
    wait_for(lambda: inspect(two['taskId'])['completionAcknowledged'])
    assert two['taskId'] != one['taskId'] and count_wakes(two['taskId']) == 1
    assert finished(one['taskId'])['result'] == first['result']
    print('PASS automatic capture, background server, references, multiple waves, retry and immutable follow-up results', flush=True)

    send('parent', 'TASK_HOLD', None, False)
    wait_for(lambda: any(row['id'] == ids['parent'] and row['text'] == 'TASK_HOLD' for row in received()))
    held = task('child', text='while parent busy')
    wait_for(lambda: finished(held['taskId']))
    wait_for(lambda: inspect(held['taskId'])['completionDelivery'])
    assert inspect(held['taskId'])['completionDelivery']['state'] == 'accepted'
    assert not inspect(held['taskId'])['completionAcknowledged']
    frozen = inspect(held['taskId'])['result']
    stop()
    start()
    wait_for(lambda: inspect(held['taskId'])['completionAcknowledged'])
    assert count_wakes(held['taskId']) == 1 and inspect(held['taskId'])['result'] == frozen
    print('PASS busy parent wake, accepted-delivery restart and acknowledgment without duplication', flush=True)

    parent = task('nested', text='TASK_HOLD')
    wait_for(lambda: inspect(parent['taskId'])['state'] == 'running')
    child = task('grandchild', parent='nested', text='TASK_HOLD', awaited=True)
    wait_for(lambda: inspect(child['taskId'])['state'] == 'running')
    release('nested')
    wait_for(lambda: inspect(parent['taskId'])['state'] == 'waiting')
    assert not inspect(parent['taskId'])['result']
    assert inspect(child['taskId'], 'wait', timeoutSecs=0)['state'] == 'running'
    release('grandchild')
    wait_for(lambda: finished(parent['taskId']))
    assert inspect(child['taskId'])['parentTaskId'] == parent['taskId']
    assert inspect(parent['taskId'])['awaitedTaskIds'] == [child['taskId']]
    wait_for(lambda: inspect(parent['taskId'])['completionAcknowledged'])
    print('PASS explicitly awaited nested work holds parent through result consumption; timeout leaves child running', flush=True)

    question = task('question', text='TASK_QUESTION')
    blocked = wait_for(lambda: (lambda t: t if t['state'] == 'blocked' else None)(inspect(question['taskId'])))
    assert blocked['questions'][0]['questions'][0]['question'] == 'Which target?', blocked
    assert inspect(question['taskId'], 'wait', timeoutSecs=10)['state'] == 'blocked'
    ws('answer_questions', dict(sessionId=ids['question'], requestId=blocked['questions'][0]['requestId'], answers={'Which target?':'Local'}))
    wait_for(lambda: finished(question['taskId']))
    print('PASS blocking question projection, wait early return and existing answer UI command', flush=True)

    parent = task('nested', text='TASK_HOLD')
    wait_for(lambda: inspect(parent['taskId'])['state'] == 'running')
    child = task('grandchild', parent='nested', text='TASK_HOLD', awaited=True)
    other = task('independent', parent='nested', text='TASK_HOLD')
    wait_for(lambda: inspect(child['taskId'])['state'] == 'running' and inspect(other['taskId'])['state'] == 'running')
    follow = send('nested', 'must never execute', 'cancel-follow')['delivery']
    nested_follow = send('grandchild', 'nested must never execute', 'cancel-nested')['delivery']
    composer = ws('send_msg', dict(sessionId=ids['nested'], prompt='composer must never execute', attachmentPaths=[], harness='claude_code', model='sonnet', effort='high', permissionMode='plan', fast=False, cwd=str(home / 'repo'), useWorktree=False, isNewSession=False))
    assert composer['queued']['text'] == 'composer must never execute'
    out = inspect(parent['taskId'], 'cancel')
    assert out['state'] == 'canceled', out
    wait_for(lambda: inspect(child['taskId'])['state'] == 'canceled')
    wait_for(lambda: status('nested', follow['messageId'])['state'] == 'canceled')
    wait_for(lambda: status('grandchild', nested_follow['messageId'])['state'] == 'canceled')
    wait_for(lambda: inspect(parent['taskId'])['completionAcknowledged'])
    assert count_wakes(parent['taskId']) == 1 and count_wakes(child['taskId']) == 0
    assert ws('cancel_queued', dict(sessionId=ids['nested'])) is None
    assert not any('must never execute' in row['text'] for row in received())
    assert inspect(other['taskId'])['state'] == 'running'
    release('independent')
    wait_for(lambda: finished(other['taskId']))
    print('PASS cancellation fences awaited descendants and pending follow-ups, preserves unawaited work and emits one result', flush=True)

    cancel_root = task('nested', text='TASK_HOLD')
    wait_for(lambda: inspect(cancel_root['taskId'])['state'] == 'running')
    cancel_child = task('grandchild', parent='nested', text='TASK_HOLD', awaited=True)
    wait_for(lambda: inspect(cancel_child['taskId'])['state'] == 'running')
    pending_cancel = send('grandchild', 'must never execute after restart', 'crash-cancel')['delivery']
    import fcntl
    delivery_lock = inbox_path(pending_cancel['messageId']).with_suffix('.lock')
    with delivery_lock.open('r+') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        assert inspect(cancel_root['taskId'], 'cancel')['state'] == 'canceled'
        stop()
    start()
    wait_for(lambda: status('grandchild', pending_cancel['messageId'])['state'] == 'canceled')
    wait_for(lambda: inspect(cancel_root['taskId'])['completionAcknowledged'])
    assert count_wakes(cancel_root['taskId']) == 1 and count_wakes(cancel_child['taskId']) == 0
    assert not any('must never execute after restart' in row['text'] for row in received())
    print('PASS crash during cancellation recovers subtree cleanup and a single root wake', flush=True)

    send('queued', 'TASK_HOLD', None, False)
    wait_for(lambda: any(row['id'] == ids['queued'] for row in received()))
    not_started = task('queued', text='must never execute queued task')
    assert inspect(not_started['taskId'], 'cancel')['state'] == 'canceled'
    wait_for(lambda: inspect(not_started['taskId'])['completionAcknowledged'])
    assert not any('must never execute queued task' in row['text'] for row in received())
    release('queued')
    wait_for(lambda: next(row for row in request(dict(v=6, cmd='list_sessions', all=True))['sessions'] if row['sessionId'] == ids['queued'])['status'] != 'in_progress')
    print('PASS canceling an unstarted task retracts its delivery without stopping unrelated running work', flush=True)

    replay = task('replay', text='TASK_HOLD')
    wait_for(lambda: inspect(replay['taskId'])['state'] == 'running')
    import fcntl
    lock_path = next((home / 'delegated-tasks').glob('*.lock'))
    with lock_path.open('r+') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        release('replay')
        path = home / 'sessions' / (ids['replay'] + '.jsonl')
        wait_for(lambda: any(json.loads(line)['payload']['type'] == 'turn_completed' for line in path.read_text().splitlines()))
        stop()
    start()
    recovered = wait_for(lambda: finished(replay['taskId']))
    assert recovered['state'] == 'succeeded', recovered
    wait_for(lambda: inspect(replay['taskId'])['completionAcknowledged'])
    assert count_wakes(replay['taskId']) == 1
    print('PASS crash after normalized completion append but before task persistence replays the production event log', flush=True)

    interrupted = task('child', text='TASK_HOLD')
    wait_for(lambda: inspect(interrupted['taskId'])['state'] == 'running')
    stop()
    start()
    assert inspect(interrupted['taskId'])['state'] == 'interrupted'
    send('queued', 'TASK_HOLD', None, False)
    wait_for(lambda: any(row['id'] == ids['queued'] for row in received()))
    queued = task('queued', text='queued tracked operation')
    assert inspect(queued['taskId'])['state'] == 'queued'
    stop()
    start()
    wait_for(lambda: finished(queued['taskId']))
    assert inspect(queued['taskId'])['state'] == 'succeeded'
    print('PASS unfinished task interruption and queued tracked operation recovery', flush=True)

    old = send('follower', 'historical message', 'historical-message')['delivery']
    wait_for(lambda: status('follower', old['messageId'])['state'] == 'submitted')
    stop()
    old_record = json.loads(inbox_path(old['messageId']).read_text())
    old_record['summary']['state'] = 'uncertain'
    inbox_path(old['messageId']).write_text(json.dumps(old_record))
    start()
    fresh = task('follower', text='separate work after inspecting uncertainty')
    assert wait_for(lambda: finished(fresh['taskId']))['state'] == 'succeeded'
    assert status('follower', old['messageId'])['state'] == 'uncertain'
    print('PASS historical uncertain delivery cannot hold a new task open', flush=True)

    stopped = task('follower', text='TASK_HOLD')
    wait_for(lambda: inspect(stopped['taskId'])['state'] == 'running')
    request(dict(v=10, cmd='stop_session', sessionId=ids['follower']))
    assert wait_for(lambda: finished(stopped['taskId']))['state'] == 'interrupted'
    print('PASS ordinary Stop reports an interrupted task instead of immutable success', flush=True)

    send('follower', 'TASK_HOLD', None, False)
    wait_for(lambda: next(row for row in request(dict(v=6, cmd='list_sessions', all=True))['sessions'] if row['sessionId'] == ids['follower'])['status'] == 'in_progress')
    log = home / 'sessions' / (ids['follower'] + '.jsonl')
    line = json.dumps(dict(id=str(uuid.uuid4()), sessionId=ids['follower'], harness='claude_code', seq=999, ts='2026-11-16T16:00:00Z', turnId=None, subagent=None, payload=dict(type='assistant_text', text='old partial message'))) + '\n'
    with log.open('a') as file:
        file.write(line[:20])
        file.flush()
        during_append = task('follower', text='new task behind an old partial append')
        file.write(line[20:])
    release('follower')
    assert wait_for(lambda: finished(during_append['taskId']))['state'] == 'succeeded'
    corrupt = task('replay', text='TASK_HOLD')
    wait_for(lambda: inspect(corrupt['taskId'])['state'] == 'running')
    with (home / 'sessions' / (ids['replay'] + '.jsonl')).open('a') as file:
        file.write('malformed event\n')
    independent = task('child', text='independent of a broken transcript')
    assert wait_for(lambda: finished(corrupt['taskId']))['state'] == 'interrupted'
    assert wait_for(lambda: finished(independent['taskId']))['state'] == 'succeeded'
    release('replay')
    print('PASS complete-line cursors and per-task replay failure isolation', flush=True)

    import concurrent.futures
    observer_script = "const fs=require('fs');const home=process.argv[1];const port=fs.readFileSync(home+'/serve-port','utf8').trim().split(/\\s+/)[0];const token=fs.readFileSync(home+'/serve-token','utf8').trim();const ws=new WebSocket('ws://127.0.0.1:'+port);ws.onopen=()=>ws.send(JSON.stringify({v:1,token}));ws.onmessage=e=>{const v=JSON.parse(e.data);fs.appendFileSync(home+'/observed.jsonl',JSON.stringify(v)+'\\n');if(v.v===1)fs.writeFileSync(home+'/observer-ready','')};"
    observer = subprocess.Popen(['node', '-e', observer_script, str(home)])
    try:
        wait_for(lambda: (home / 'observer-ready').exists())
        with concurrent.futures.ThreadPoolExecutor() as pool:
            future = pool.submit(request, dict(v=19, cmd='create_session', prompt='pi startup task', title='Startup question fixture', projectPath=str(home / 'repo'), parentSessionId=ids['parent'], harness='pi', task=dict(awaited=False), requestId='pi-startup', base='HEAD'))
            def startup_row():
                events = [json.loads(line) for line in (home / 'observed.jsonl').read_text().splitlines()]
                return next((event['payload'] for event in events if event.get('event') == 'session_created' and event.get('payload', {}).get('harness') == 'pi'), None)
            row = wait_for(startup_row)
            task_id = wait_for(lambda: next((record['summary']['taskId'] for record in json.loads(next((home / 'delegated-tasks').glob('*.json')).read_text())['tasks'].values() if record['summary']['childSessionId'] == row['sessionId']), None))
            blocked = wait_for(lambda: (lambda t: t if t['state'] == 'blocked' else None)(inspect(task_id)))
            assert not future.done(), 'startup question did not hold the handshake open'
            question = blocked['questions'][0]
            choice = question['questions'][0]
            ws('answer_questions', dict(sessionId=row['sessionId'], requestId=question['requestId'], answers={choice['question']:choice['options'][0]['label']}))
            assert unwrap(future.result(timeout=12))['task']['taskId'] == task_id
            assert wait_for(lambda: finished(task_id))['state'] == 'succeeded'
        print('PASS startup question is visible and inspectable while the creation slot remains held', flush=True)
    finally:
        observer.terminate()
        observer.wait(timeout=3)

    created = unwrap(request(dict(v=19, cmd='create_session', prompt='created task', projectPath=str(home / 'repo'), parentSessionId=ids['parent'], harness='claude_code', model='sonnet', task=dict(awaited=False), requestId='new-tracked')))
    assert created['status'] == 'task', created
    wait_for(lambda: finished(created['task']['taskId']))
    row = next(row for row in request(dict(v=6, cmd='list_sessions', all=True))['sessions'] if row['sessionId'] == created['task']['childSessionId'])
    assert row['worktreeName'] and row['parentSessionId'] == ids['parent'], row
    print('PASS new tracked session keeps mandatory worktree and Crew ancestry', flush=True)
    print('ALL TASK REPLAYS PASSED', home, flush=True)
finally:
    stop()
