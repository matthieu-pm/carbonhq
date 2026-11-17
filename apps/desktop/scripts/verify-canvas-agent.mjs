import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const positional = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const binary = resolve(positional[0] ?? 'src-tauri/target/debug/carbon-serve');
const cli = resolve(positional[1] ?? '../cli/target/debug/carbon');
const root = await realpath(await mkdtemp('/tmp/c82-'));
const home = join(root, 'home'), project = join(root, 'project'), other = join(root, 'other');
const session = randomUUID();
let server, ws, log = '';
for (const path of [home, project, other, join(home, 'sessions'), join(home, 'bin'), join(home, 'claude/projects/fixture')]) await mkdir(path, { recursive: true });
await writeFile(join(home, 'sessions/index.json'), JSON.stringify([{ sessionId: session, harness: 'claude_code', cwd: project, projectPath: project, title: 'Canvas agent verification', titleLocked: true, model: 'sonnet', effort: 'high', permissionMode: 'plan', fast: false, status: 'idle', created: '2026-11-17T12:00:00Z', modified: '2026-11-17T12:00:00Z', archived: false, pinned: false }]));
const fixture = (await readFile(new URL('./fixtures/task-claude.py', import.meta.url), 'utf8')).replace("    if 'TASK_HOLD' in text and 'Delegated task ' not in text:", "    if 'TASK_HOLD' in text:\n        emit(dict(type='system', subtype='status', status='requesting', session_id=id))\n    if 'TASK_HOLD' in text and 'Delegated task ' not in text:");
await writeFile(join(home, 'bin/claude'), `#!/usr/bin/env python3\n${fixture}`, { mode: 0o755 });
const cached = process.env.CARBON_TEST_CHROMIUM ?? join(homedir(), '.carbon-dev/chromium');
try { await access(cached); await symlink(cached, join(home, 'chromium')); } catch {}
const env = { ...process.env, CARBON_HOME: home, CARBON_NO_ANALYTICS: '1', CARBON_SESSION_ID: session, CARBON_ENDPOINT: join(home, 'carbon.sock'), CLAUDE_CONFIG_DIR: join(home, 'claude'), PATH: `${join(home, 'bin')}:${process.env.PATH}` };

async function waitFor(read, predicate = Boolean, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) { try { value = await read(); if (predicate(value)) return value; } catch {} await delay(50); }
  throw new Error(`Timed out; last value ${JSON.stringify(value)}\n${log.slice(-3000)}`);
}

async function start() {
  server = spawn(binary, ['--port', '0'], { env, detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
  server.stderr.on('data', (data) => { log += data; });
  server.on('exit', (code, signal) => { log += `\nserver exit ${code} ${signal}\n`; });
  const port = await waitFor(async () => Number((await readFile(join(home, 'serve-port'), 'utf8')).split('\n')[0]));
  await waitFor(() => access(join(home, "carbon.sock")).then(() => true));
  const token = (await readFile(join(home, 'serve-token'), 'utf8')).trim();
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const pending = new Map(); const events = []; let next = 0;
  const hello = new Promise((resolveHello) => ws.addEventListener('message', ({ data }) => {
    const frame = JSON.parse(data);
    if (frame.id != null) {
      const call = pending.get(frame.id); if (!call) return; pending.delete(frame.id); clearTimeout(call.timer);
      frame.err == null ? call.resolve(frame.ok) : call.reject(new Error(String(frame.err)));
    } else if (frame.v === 1) resolveHello(); else if (frame.event) events.push(frame);
  }));
  await once(ws, 'open'); ws.send(JSON.stringify({ v: 1, token })); await hello;
  return { port, token, events, call(cmd, args = {}) { return new Promise((resolve, reject) => { const id = ++next; const timer = setTimeout(() => reject(new Error(`Timed out: ${cmd}`)), 30000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, cmd, args })); }); } };
}

async function command(args, input, expectedError) {
  const child = spawn(cli, ['canvas', ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '', err = ''; child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
  child.stdin.end(input ?? ''); const [code] = await once(child, 'exit');
  if (expectedError) { assert.notEqual(code, 0); assert.match(err, expectedError); return; }
  assert.equal(code, 0, `${args.join(' ')}\n${err}\n${log.slice(-1500)}`);
  return JSON.parse(out);
}

async function stop() {
  ws?.close();
  if (server?.exitCode === null && server?.signalCode === null) { const exited = once(server, 'exit'); try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; } await Promise.race([exited, delay(5000)]); if (server.exitCode === null && server.signalCode === null) { try { process.kill(-server.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } } }
}

try {
  let client = await start();
  await client.call('add_project', { path: project });
  const a = await client.call('create_canvas', { projectPath: project, name: 'Mobile checkout' });
  const b = await client.call('create_canvas', { projectPath: project, name: 'Other exploration' });
  const foreign = await client.call('create_canvas', { projectPath: other, name: 'Private other project' });
  assert.equal((await command(['ls'])).files.length, 2);
  await command(['--canvas', foreign.id, 'tree'], null, /does not belong/);
  await command(['tree'], null, /No canvas was captured/);
  const focus = { id: a.id, projectPath: project, revision: a.revision, picks: [], previewFrameId: null };
  await client.call('send_msg', { sessionId: session, prompt: 'TASK_HOLD design checkout', attachmentPaths: [], harness: 'claude_code', model: 'sonnet', effort: 'high', permissionMode: 'plan', fast: false, cwd: project, branch: null, useWorktree: false, worktreeName: null, baseRef: null, isNewSession: false, canvasContext: focus });
  const received = await waitFor(() => readFile(join(home, 'received.jsonl'), 'utf8'));
  assert.match(received, /Mobile checkout/);
  const context = await command(['context']); assert.equal(context.canvas.id, a.id);
  await waitFor(async () => client.events, events => events.some(e => e.event === 'agent_event' && e.payload.payload.type === 'model_request_started'));
  const queued = await client.call('send_msg', { sessionId: session, prompt: 'TASK_HOLD queued canvas selection', attachmentPaths: [], harness: 'claude_code', model: 'sonnet', effort: 'high', permissionMode: 'plan', fast: false, cwd: project, branch: null, useWorktree: false, worktreeName: null, baseRef: null, isNewSession: false, canvasContext: { ...focus, id: b.id, revision: b.revision } });
  assert(queued.queued);
  assert.equal((await command(['context'])).canvas.id, a.id);

  let revision = a.revision;
  let result = await command(['--revision', String(revision), 'frame', 'new', 'Checkout', '--width', '390', '--height', '844']);
  const frame = result.data.frameId; revision = result.revision;
  await command(['--revision', '1', 'set-text', frame, 'stale'], null, /conflict/);
  await command(['--revision', String(revision), 'write', frame], '<script>alert(1)</script>', /Unsupported/);
  result = await command(['--revision', String(revision), 'write', frame], '<style>.surface{background:rgb(20,80,40)} @media(min-width:600px){.surface{background:rgb(180,20,30)}}</style><main class="surface" style="height:100vh;--pad:24px;padding:var(--pad);color:white"><h1 style="font-size:32px">Checkout</h1><button style="width:200px;height:48px">Continue</button></main>');
  revision = result.revision;
  const hierarchy = await command(['tree', frame]);
  const main = hierarchy.data[0].id, heading = hierarchy.data[0].children[0].id, button = hierarchy.data[0].children[1].id;
  const measured = await command(['get', main, '--styles']);
  assert.equal(measured.data.computed.box.styles['background-color'], 'rgb(20, 80, 40)');
  assert.equal(measured.data.computed.box.width, 390);
  assert.equal(measured.data.computed.box.styles['padding-left'], '24px');
  result = await command(['--revision', String(revision), 'set-style', main, '{"padding":"32px"}']); revision = result.revision;
  assert.equal((await command(['get', main, '--styles'])).data.computed.box.styles['padding-left'], '32px');
  result = await command(['--revision', String(revision), 'set-style', main, '{"padding":null}']); revision = result.revision;
  assert.equal((await command(['get', main, '--styles'])).data.computed.box.styles['padding-left'], '0px');
  result = await command(['--revision', String(revision), 'set-style', main, '{"padding":"24px"}']); revision = result.revision;
  result = await command(['--revision', String(revision), 'set-style', heading, '{"color":"rgb(255,220,80)","--space-2":"12px","padding":"var(--space-2)"}']); revision = result.revision;
  assert.equal((await command(['get', heading, '--styles'])).data.computed.box.styles['padding-left'], '12px');
  result = await command(['--revision', String(revision), 'set-text', heading, 'Secure checkout']); revision = result.revision;
  const shot = await command(['shot', frame]);
  const png = await readFile(shot.data.path); assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 390); assert.equal(png.readUInt32BE(20), 844);
  assert.equal(shot.data.evidence.revision, revision);
  assert.equal(JSON.parse(await readFile(shot.data.path.replace('.png', '.json'), 'utf8')).kind, 'screenshot_returned');
  const layerShot = await command(['shot', button]); const layerPng = await readFile(layerShot.data.path);
  assert.equal(layerPng.readUInt32BE(16), 200); assert.equal(layerPng.readUInt32BE(20), 48);
  const editors = await client.call('canvas_editors'); assert(editors.some(e => e.frameId === frame && e.sessionId === session));
  result = await command(['--revision', String(revision), 'dup', frame]); revision = result.revision;
  const copy = result.data.frameId;
  const copyInfo = (await command(['frame', 'ls'])).data.find(f => f.id === copy); assert(copyInfo.geometry.x >= 470);
  result = await command(['--revision', String(revision), 'frame', 'resize', copy, '--width', '1440', '--height', '900']); revision = result.revision;
  assert.equal((await command(['get', copy, '--styles'])).data.computed.boxes[0].styles['background-color'], 'rgb(180, 20, 30)');
  await command(['open', frame]);
  const browserText = () => new Promise((resolveBrowser, reject) => {
    const child = spawn(cli, ['browser', 'get', 'text'], { env }); let output = '', errors = '';
    child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { errors += data; }); child.on('exit', code => code === 0 ? resolveBrowser(output) : reject(new Error(errors)));
  });
  assert.match(await browserText(), /Secure checkout/);
  result = await command(['--revision', String(revision), 'set-text', heading, 'Payment details']); revision = result.revision;
  await waitFor(browserText, text => text.includes('Payment details'));
  await command(['shot', frame]);
  await command(['shot', copy]);
  await writeFile(join(home, `finish-${session}`), 'done');
  await waitFor(() => readFile(join(home, 'received.jsonl'), 'utf8'), text => text.includes('queued canvas selection'));
  await waitFor(() => command(['context']), context => context.canvas?.id === b.id);
  await writeFile(join(home, `finish-${session}`), 'done');
  await waitFor(() => command(['context']), context => context.running === false);
  await waitFor(() => client.call('canvas_editors'), list => list.length === 0);
  const before = await client.call('read_canvas', { id: a.id });
  before.frames[0].geometry.x = 600;
  const manual = await client.call('update_canvas', { id: a.id, revision: before.revision, edit: { frames: before.frames } });
  const undone = await command(['--canvas', a.id, '--revision', String(manual.revision), 'undo', '--turn', context.turnId]);
  const saved = await client.call('read_canvas', { id: a.id }); assert.equal(saved.frames[0].geometry.x, 600); assert.equal(saved.frames.length, 1);
  assert(undone.data.conflicts.length > 0);
  await command(['--canvas', a.id, '--revision', String(undone.revision), 'redo']);
  await stop(); await rm(join(home, 'serve-port'), { force: true }); client = await start();
  assert.equal((await client.call('canvas_editors')).length, 0);
  const reopened = await client.call('read_canvas', { id: a.id }); assert.equal(reopened.frames.length, 2);
  assert.equal((await command(['context'])).canvas.id, b.id);
  const state = { home, project, session, canvas: a.id, frame, port: client.port, token: client.token, screenshot: shot.data.path };
  await writeFile('/tmp/cbn82-verification.json', JSON.stringify(state));
  console.log(JSON.stringify({ passed: true, checks: ['actual CLI v22', 'project scoping', 'captured turn', 'revision conflicts', 'HTML rejection and editable import', 'computed mobile CSS', 'frame and layer PNGs with durable evidence', 'editing lifecycle', 'duplicate placement', 'browser preview', 'property-wise undo and redo', 'restart recovery'], root }));
  if (process.argv.includes('--keep')) { console.log('Scratch server retained for browser verification; send a newline to clean up.'); process.stdin.resume(); await once(process.stdin, 'data'); process.stdin.pause(); }
} catch (error) { console.error(error, log.slice(-5000)); process.exitCode = 1; }
finally { await stop(); await rm(root, { recursive: true, force: true }); }
