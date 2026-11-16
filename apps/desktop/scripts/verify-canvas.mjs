import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const binary = resolve(process.argv[2] ?? 'src-tauri/target/debug/carbon-serve');
const root = await mkdtemp(join(tmpdir(), 'carbon-canvas-smoke-'));
const home = join(root, 'home');
const project = join(root, 'project');
const children = new Set();
const sockets = new Set();
const checks = [];
let log = '';
await mkdir(home);
await mkdir(project);

async function waitFor(read, predicate, description, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read().catch(() => null);
    if (predicate(value)) return value;
    await delay(40);
  }
  throw new Error(`Timed out: ${description}\n${log}`);
}

async function start(homeDir = home) {
  await rm(join(homeDir, 'serve-port'), { force: true });
  const server = spawn(binary, ['--port', '0'], {
    env: { ...process.env, CARBON_HOME: homeDir, CARBON_NO_ANALYTICS: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  children.add(server);
  server.stderr.on('data', data => { log += data; });
  server.on('error', error => { log += error.message; });
  await waitFor(() => readFile(join(homeDir, 'serve-port'), 'utf8'), Boolean, 'server readiness');
  return server;
}

async function stop(server) {
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await Promise.race([exited, delay(5_000).then(() => server.kill('SIGKILL'))]);
  children.delete(server);
}

async function connect(homeDir = home) {
  const port = Number((await readFile(join(homeDir, 'serve-port'), 'utf8')).split('\n')[0]);
  const token = (await readFile(join(homeDir, 'serve-token'), 'utf8')).trim();
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.add(ws);
  const pending = new Map();
  const events = [];
  let next = 0;
  const hello = new Promise((resolveHello, rejectHello) => {
    ws.addEventListener('message', ({ data }) => {
      const frame = JSON.parse(data);
      if (frame.id != null) {
        const request = pending.get(frame.id);
        pending.delete(frame.id);
        if (request) { clearTimeout(request.timer); frame.err != null ? request.reject(new Error(String(frame.err))) : request.resolve(frame.ok); }
      } else if (frame.event) events.push(frame);
      else if (frame.v === 1) resolveHello();
      else if (frame.err) rejectHello(new Error(frame.err));
    });
  });
  await once(ws, 'open');
  ws.send(JSON.stringify({ v: 1, token }));
  await hello;
  return {
    events,
    call(cmd, args = {}) {
      return new Promise((resolveCall, reject) => {
        const id = ++next;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${cmd}`)); }, 10_000);
        pending.set(id, { resolve: resolveCall, reject, timer });
        ws.send(JSON.stringify({ id, cmd, args }));
      });
    },
    close() { ws.close(); sockets.delete(ws); },
  };
}

async function git(cwd, args) {
  const child = spawn('git', args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
  children.add(child);
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  const [code] = await once(child, 'exit');
  children.delete(child);
  assert.equal(code, 0, errors);
}

try {
  let server = await start();
  let client = await connect();
  const canvas = await client.call('create_canvas', { projectPath: project, name: 'Explorations' });
  const frame = {
    id: randomUUID(), name: 'Checkout', geometry: { x: 0, y: 0, width: 390, height: 844 },
    content: { nodes: [{ kind: 'element', id: randomUUID(), name: 'Button', tag: 'button', attributes: {}, styles: { color: 'var(--brand)' }, children: [{ kind: 'text', id: randomUUID(), name: 'Label', text: 'Pay' }] }], css: '', assetIds: [] },
  };
  let saved = await client.call('update_canvas', { id: canvas.id, revision: 1, edit: { frames: [frame], tokens: { '--brand': '#ffcc00' } }, author: { sessionId: randomUUID(), turnId: 'turn-one' } });
  assert.equal(saved.change.author.turnId, 'turn-one');
  assert.deepEqual(saved.frames, [frame]);
  checks.push('create, stable node tree, tokens and turn metadata');

  for (const separate of [false, true]) {
    const repository = join(root, separate ? 'separate' : 'repository');
    const linked = `${repository}-linked`;
    await mkdir(repository);
    await git(repository, separate ? ['init', '--separate-git-dir', `${repository}-gitdata`] : ['init']);
    await git(repository, ['-c', 'user.name=Canvas test', '-c', 'user.email=canvas@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Initial']);
    await git(repository, ['worktree', 'add', '--detach', linked]);
    await mkdir(join(repository, 'a'));
    await mkdir(join(repository, 'b'));
    await mkdir(join(linked, 'a'));
    const design = await client.call('create_canvas', { projectPath: join(repository, 'a'), name: 'Project A' });
    assert.equal(design.projectPath, await realpath(join(repository, 'a')));
    assert.equal((await client.call('list_canvases', { projectPath: join(repository, 'b') })).files.length, 0);
    assert.equal((await client.call('list_canvases', { projectPath: join(linked, 'a') })).files[0].id, design.id);
    checks.push(separate ? 'separate Git metadata shares the subproject across worktrees' : 'distinct subprojects retain their owner and share only their own worktrees');
  }


  const contenders = await Promise.allSettled(['First', 'Second'].map(name => client.call('update_canvas', { id: canvas.id, revision: 2, edit: { name } })));
  assert.equal(contenders.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(contenders.find(r => r.status === 'rejected').reason.message, /conflict/);
  saved = await client.call('read_canvas', { id: canvas.id });
  checks.push('concurrent requests reject a stale revision');

  const lock = spawn('python3', ['-u', '-c', 'import fcntl,sys; f=open(sys.argv[1],"w"); fcntl.flock(f,fcntl.LOCK_EX); print("held",flush=True); sys.stdin.readline()', join(home, 'canvas.lock')], { stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(lock);
  await once(lock.stdout, 'data');
  let completed = false;
  const blocked = client.call('update_canvas', { id: canvas.id, revision: saved.revision, edit: { name: 'After process lock' } }).then(value => { completed = true; return value; });
  await delay(150);
  assert.equal(completed, false);
  lock.stdin.end('\n');
  saved = await blocked;
  children.delete(lock);
  checks.push('writes wait for an independent process holding the shared lock');

  await client.call('watch_canvases', { scope: 'smoke', ids: [canvas.id] });
  const inbox = await client.call('prepare_canvas_frame_edit', { id: canvas.id, revision: saved.revision, frameId: frame.id });
  await writeFile(inbox.path, '{"revision":');
  const partial = await client.call('reconcile_canvas', { id: canvas.id });
  assert.equal(partial.problems.length, 1);
  assert.deepEqual(partial.canvas.frames, saved.frames);
  inbox.edit.content.css = 'button { background: gold; }';
  await writeFile(inbox.path, JSON.stringify(inbox.edit));
  saved = await waitFor(() => client.call('read_canvas', { id: canvas.id }), value => value?.revision === inbox.edit.revision + 1, 'automatic content reconciliation');
  assert.equal(saved.frames[0].content.css, inbox.edit.content.css);
  await waitFor(async () => client.events, events => events.some(e => e.event === 'canvas_changed' && e.payload.revision === saved.revision), 'canvas invalidation event');
  const again = await client.call('reconcile_canvas', { id: canvas.id });
  assert.equal(again.canvas.revision, saved.revision);
  checks.push('partial files preserve the design; corrected files reconcile live exactly once');

  const stale = await client.call('prepare_canvas_frame_edit', { id: canvas.id, revision: saved.revision, frameId: frame.id });
  saved = await client.call('update_canvas', { id: canvas.id, revision: saved.revision, edit: { name: 'Manual change' } });
  stale.edit.content.css = 'button { color: red; }';
  await writeFile(stale.path, JSON.stringify(stale.edit));
  const rejected = await client.call('reconcile_canvas', { id: canvas.id });
  assert.match(rejected.problems[0].message, /conflict/);
  assert.equal(rejected.canvas.revision, saved.revision);
  checks.push('late content edits cannot replace newer manual changes');

  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6ZkAAAAASUVORK5CYII=';
  const assetId = randomUUID();
  const upload = await client.call('write_canvas_asset', { id: canvas.id, revision: saved.revision, upload: { assetId, name: 'pixel.png', offset: 0, data: png, complete: true } });
  saved = upload.canvas;
  saved.frames[0].content.assetIds.push(assetId);
  saved.frames[0].content.nodes.push({ kind: 'element', id: randomUUID(), name: 'Image', tag: 'img', attributes: { src: `carbon-canvas-asset://${assetId}` }, styles: {}, children: [] });
  saved = await client.call('update_canvas', { id: canvas.id, revision: saved.revision, edit: { frames: saved.frames } });
  const history = await client.call('canvas_history', { id: canvas.id });
  assert.equal(history[0].revision, saved.revision);
  assert.ok(history.some(version => version.change.author.turnId === 'turn-one'));
  const withImage = saved.revision;
  const duplicatedFrame = await client.call('duplicate_canvas_frame', { id: canvas.id, revision: saved.revision, frameId: frame.id });
  assert.equal(duplicatedFrame.frames.length, 2);
  assert.notEqual(duplicatedFrame.frames[0].id, duplicatedFrame.frames[1].id);
  assert.deepEqual(duplicatedFrame.frames[0].content.assetIds, duplicatedFrame.frames[1].content.assetIds);
  saved = duplicatedFrame;
  const copy = await client.call('duplicate_canvas', { id: canvas.id, revision: saved.revision, name: 'Independent copy' });
  assert.equal((await client.call('read_canvas_asset', { id: copy.id, assetId })).data, png);
  saved = await client.call('restore_canvas_version', { id: canvas.id, revision: saved.revision, version: 1 });
  assert.equal(saved.frames.length, 0);
  assert.equal((await client.call('read_canvas_asset', { id: canvas.id, assetId, version: withImage })).data, png);
  saved = await client.call('restore_canvas_version', { id: canvas.id, revision: saved.revision, version: withImage });
  checks.push('frame/file duplication, assets and history restore without Git');

  const missing = await client.call('create_canvas', { projectPath: project, name: 'Missing content' });
  const withContent = await client.call('update_canvas', { id: missing.id, revision: 1, edit: { frames: [frame] } });
  const contentDir = join(home, 'canvases', missing.id, 'content');
  await rm(join(contentDir, (await readdir(contentDir))[0]));
  const listed = await client.call('list_canvases', { projectPath: project });
  assert.ok(listed.problems.some(problem => problem.id === missing.id));
  assert.ok(!listed.files.some(file => file.id === missing.id));
  assert.equal(withContent.revision, 2);
  checks.push('listing reports broken frame content without hiding healthy files');

  const damaged = await client.call('create_canvas', { projectPath: project, name: 'Damaged image' });
  const uploaded = await client.call('write_canvas_asset', { id: damaged.id, revision: 1, upload: { assetId: randomUUID(), name: 'pixel.png', offset: 0, data: png, complete: true } });
  const damagedDir = join(home, 'canvases', damaged.id);
  const imagePath = join(damagedDir, 'assets', uploaded.canvas.assets[0].hash);
  const altered = await readFile(imagePath);
  altered[20] ^= 1;
  await writeFile(imagePath, altered);
  await assert.rejects(client.call('duplicate_canvas', { id: damaged.id, revision: 2, name: 'Rejected copy' }), /checksum/);
  await writeFile(join(damagedDir, 'canvas.json'), 'preserve this manifest');
  await assert.rejects(client.call('recover_canvas', { id: damaged.id }), /checksum/);
  assert.equal(await readFile(join(damagedDir, 'canvas.json'), 'utf8'), 'preserve this manifest');
  checks.push('same-size image corruption refuses recovery and duplication without replacing the manifest');

  const deepCanvas = await client.call('create_canvas', { projectPath: project, name: 'Depth boundary' });
  let deepNode = { kind: 'text', id: randomUUID(), name: 'Text', text: 'Deep' };
  for (let depth = 1; depth < 48; depth++) deepNode = { kind: 'element', id: randomUUID(), name: 'Container', tag: 'div', attributes: {}, styles: {}, children: [deepNode] };
  const nestedFrame = { ...frame, id: randomUUID(), content: { nodes: [deepNode], css: '', assetIds: [] } };
  const boundary = await client.call('update_canvas', { id: deepCanvas.id, revision: 1, edit: { frames: [nestedFrame] } });
  assert.deepEqual((await client.call('read_canvas', { id: deepCanvas.id })).frames, boundary.frames);
  nestedFrame.content.nodes = [{ kind: 'element', id: randomUUID(), name: 'Too deep', tag: 'div', attributes: {}, styles: {}, children: [deepNode] }];
  await assert.rejects(client.call('update_canvas', { id: deepCanvas.id, revision: 2, edit: { frames: [nestedFrame] } }), /nested/);
  await client.call('delete_canvas', { id: deepCanvas.id, revision: 2 });
  checks.push('maximum supported tree depth reopens and a deeper write is rejected before publication');


  client.close();
  await stop(server);
  server = await start();
  client = await connect();
  assert.deepEqual((await client.call('read_canvas', { id: canvas.id })).frames, saved.frames);
  checks.push('content and assets survive a real server restart');

  const manifest = join(home, 'canvases', canvas.id, 'canvas.json');
  await writeFile(manifest, 'broken manifest bytes');
  const recovered = await client.call('recover_canvas', { id: canvas.id });
  assert.ok(recovered.revision > saved.revision);
  const backups = (await readdir(join(home, 'canvases', canvas.id))).filter(name => name.startsWith('canvas.json.broken-'));
  assert.equal(await readFile(join(home, 'canvases', canvas.id, backups[0]), 'utf8'), 'broken manifest bytes');
  checks.push('recovery preserves original bytes and publishes a fresh revision');

  const head = JSON.parse(await readFile(manifest, 'utf8'));
  head.formatVersion = 999;
  head.minReaderVersion = 999;
  const unsupported = JSON.stringify(head);
  await writeFile(manifest, unsupported);
  await assert.rejects(client.call('read_canvas', { id: canvas.id }), /Update Carbon/);
  await assert.rejects(client.call('update_canvas', { id: canvas.id, revision: recovered.revision, edit: { name: 'Forbidden' } }), /Update Carbon/);
  await assert.rejects(client.call('recover_canvas', { id: canvas.id }), /Update Carbon/);
  assert.equal(await readFile(manifest, 'utf8'), unsupported);
  checks.push('unsupported future files are never overwritten');

  const peerHome = join(root, 'peer-home');
  await mkdir(peerHome);
  await symlink(join(home, 'canvases'), join(peerHome, 'canvases'));
  await symlink(join(home, 'canvas.lock'), join(peerHome, 'canvas.lock'));
  const peerServer = await start(peerHome);
  const peer = await connect(peerHome);
  await client.call('watch_canvases', { scope: 'peer-deletion', ids: [copy.id] });
  await peer.call('delete_canvas', { id: copy.id, revision: copy.revision });
  await waitFor(async () => client.events, events => events.some(event => event.event === 'canvas_deleted' && event.payload.id === copy.id), 'shared-store deletion event');
  assert.ok(!client.events.some(event => event.event === 'canvas_problem' && event.payload.id === copy.id));
  peer.close();
  await stop(peerServer);
  assert.equal((await client.call('list_canvases', { projectPath: project })).files.length, 0);
  await assert.rejects(readFile(join(home, 'canvases', copy.id, 'canvas.json')), /ENOENT/);
  checks.push('permanent deletion removes file-owned assets and notifies a second server watching the shared store');
  client.close();
  await stop(server);
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally {
  for (const ws of sockets) ws.close();
  for (const child of children) child.kill('SIGKILL');
  await rm(root, { recursive: true, force: true });
}
