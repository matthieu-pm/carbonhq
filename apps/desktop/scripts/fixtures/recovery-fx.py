import json
import os
import pathlib
import sys
import threading
import time

if 'acp' not in sys.argv:
    print('0.0.14' if '--version' in sys.argv else '{}')
    sys.exit()
home = pathlib.Path(os.environ['CARBON_HOME'])
lock = threading.Lock()

def reply(id, result):
    with lock:
        print(json.dumps(dict(jsonrpc='2.0', id=id, result=result)), flush=True)

def release(id):
    while not (home / 'finish-fx').exists():
        time.sleep(0.02)
    (home / 'finish-fx').unlink()
    reply(id, dict(stopReason='end_turn'))

for line in sys.stdin:
    frame = json.loads(line)
    method = frame.get('method')
    if 'id' not in frame:
        continue
    id = frame['id']
    if method == 'initialize':
        reply(id, dict(protocolVersion=1, agentCapabilities={}))
    elif method in ['session/new', 'session/resume']:
        reply(id, dict(sessionId=frame.get('params', {}).get('sessionId', 'fx-fixture')))
    elif method == 'session/prompt':
        text = '\n'.join(block.get('text', '') for block in frame['params']['prompt'])
        with (home / 'fx-received.jsonl').open('a') as log:
            log.write(json.dumps(dict(text=text)) + '\n')
        if text == 'FX_DIE':
            os._exit(3)
        if text == 'FX_HOLD':
            threading.Thread(target=release, args=(id,), daemon=True).start()
        else:
            reply(id, dict(stopReason='end_turn'))
    else:
        reply(id, {})
