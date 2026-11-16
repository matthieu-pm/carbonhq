import json, os, sys

def emit(value):
    print(json.dumps(value), flush=True)

if '--version' in sys.argv:
    print('1.0.4')
    sys.exit()
handshake = None
for line in sys.stdin:
    request = json.loads(line)
    command = request['type']
    if command == 'get_available_models':
        emit(dict(type='response', id=request['id'], command=command, success=True, data=dict(models=[])))
    elif command == 'get_state' and '--session' in sys.argv and handshake is None:
        handshake = request
        emit(dict(type='extension_ui_request', id='startup-question', method='confirm', title='Trust this project?', message='Allow the fixture project?'))
    elif command == 'extension_ui_response':
        emit(dict(type='response', id=handshake['id'], command='get_state', success=True, data={}))
    elif command == 'prompt':
        emit(dict(type='response', id=request['id'], command=command, success=True))
        emit(dict(type='agent_start'))
        emit(dict(type='message_start', message=dict(role='assistant')))
        emit(dict(type='message_end', message=dict(role='assistant', content=[dict(type='text', text='pi result')], stopReason='stop')))
        emit(dict(type='agent_settled'))
    elif request.get('id'):
        emit(dict(type='response', id=request['id'], command=command, success=True, data={}))
