import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

const [serverPath = 'src-tauri/target/debug/carbon-serve', cliPath = '../cli/target/debug/carbon'] = process.argv.slice(2);
const root = await mkdtemp(join(tmpdir(), 'carbon-browser-capture-'));
const home = join(root, 'home');
const project = join(root, 'project');
const sessionId = randomUUID();
const env = { ...process.env, CARBON_HOME: home, CARBON_ENDPOINT: join(home, 'carbon.sock'), CARBON_SESSION_ID: sessionId, CARBON_NO_ANALYTICS: '1' };
let carbon, web;
const exec = promisify(execFile);
const browser = (...args) => exec(resolve(cliPath), ['browser', ...args], { cwd: project, env, timeout: 45_000 });
const bundle = async name => JSON.parse(await readFile(join(project, name), 'utf8'));
const layers = nodes => nodes.flatMap(node => [node, ...layers(node.children ?? [])]);

try {
  await mkdir(join(home, 'sessions'), { recursive: true });
  await mkdir(project);
  await writeFile(join(home, 'sessions/index.json'), JSON.stringify([{
    sessionId, harness: 'claude_code', cwd: project, projectPath: project, title: 'Browser capture fixture',
    status: 'idle', created: new Date().toISOString(), modified: new Date().toISOString(), archived: false, pinned: false,
  }]));
  const chromium = process.env.CARBON_TEST_CHROMIUM ?? join(homedir(), '.carbon-dev/chromium');
  try { await access(chromium); await symlink(chromium, join(home, 'chromium')); } catch {}

  const font = await readFile(new URL('../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', import.meta.url));
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  web = createServer((req, res) => {
    if (req.url === '/fixture.woff2') { res.writeHead(200, { 'content-type': 'font/woff2' }); res.end(font); return; }
    if (req.url === '/pixel.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(pixel); return; }
    if (req.url === '/embedded') { res.end('<p>Embedded reference</p>'); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><style>
      @font-face{font-family:Fixture;src:url(/fixture.woff2);font-weight:100 900}
      body{margin:0;background:#f8f6f2}
      #checkout{width:320px;margin:20px;padding:16px;background:#fff;font-family:Fixture,sans-serif}
      footer{height:2100px}iframe{display:block;width:160px;height:50px}
      </style>
      <main id="checkout" data-astro-source-file="/src/checkout.astro?query=private">
        <h1 style="color:rgb(20,40,60)">Checkout</h1>
        <button onclick="document.body.remove()">Pay now</button>
        <img src="/pixel.png" width="24" height="24">
        <iframe src="/embedded"></iframe>
        <input value="fixture-private-value">
      </main>
      <footer>Below the fold</footer><script>document.documentElement.dataset.fixture = "ready"</script>`);
  }).listen(0, '127.0.0.1');
  await once(web, 'listening');
  carbon = spawn(resolve(serverPath), ['--port', '0'], { env, stdio: 'ignore' });
  for (let attempt = 0; ; attempt++) {
    try { await access(env.CARBON_ENDPOINT); break; }
    catch (error) { if (attempt >= 200) throw error; await delay(50); }
  }

  await browser('open', `http://127.0.0.1:${web.address().port}/checkout?session=fixture-private-query`);
  await browser('eval', '(async()=>{await document.fonts.ready;return true})()');
  const viewport = JSON.parse((await browser('eval', '({width:innerWidth,height:innerHeight})', '--json')).stdout).value;
  const full = JSON.parse((await browser('capture', '--to', 'full.json', '--json')).stdout);
  const document = await bundle('full.json');
  assert.equal(document.formatVersion, 1);
  assert.equal(document.frame.geometry.width, viewport.width);
  assert(full.height > viewport.height);
  assert.equal(document.frame.capture.pagePath, '/checkout');
  assert.equal(document.frame.capture.imageOnly, false);
  assert(document.frame.capture.warnings.some(note => note.includes('Embedded page')));
  const captured = layers(document.frame.content.nodes);
  assert(captured.some(node => node.text === 'Below the fold'));
  assert(captured.some(node => node.name === 'Embedded page · Image reference'));
  assert(captured.every(node => !['iframe', 'script'].includes(node.tag) && !node.attributes?.onclick));
  assert(!JSON.stringify(document).includes('fixture-private'));
  assert(document.assets.some(({ asset, data }) => asset.mimeType === 'font/woff2' && Buffer.from(data, 'base64').equals(font)));
  assert(document.assets.some(({ asset }) => asset.mimeType === 'image/png'));
  const original = document.assets.find(({ asset }) => asset.id === document.frame.capture.originalAssetId);
  assert.equal(Buffer.from(original.data, 'base64').subarray(0, 3).toString('hex'), 'ffd8ff');

  await browser('capture', '#checkout', '--to', 'element.json');
  const element = await bundle('element.json');
  assert.equal(element.frame.geometry.width, element.frame.capture.bounds.width);
  assert.equal(element.frame.capture.selector, '#checkout');
  assert.equal(element.frame.capture.source.file, '/src/checkout.astro');
  assert(!layers(element.frame.content.nodes).some(node => node.text === 'Below the fold'));
  await browser('capture', 'iframe', '--to', 'image.json');
  assert.equal((await bundle('image.json')).frame.name, 'Image reference');
  await browser('eval', 'document.querySelector("footer").style.height = "12000px"');
  const tall = JSON.parse((await browser('capture', '--to', 'tall.json', '--json')).stdout);
  assert.equal(tall.height, 10_000);
  assert(tall.warnings.some(note => note.includes('cropped')));
  await assert.rejects(browser('capture', '--to', 'full.json'), /exists/);
  await assert.rejects(browser('capture', '#missing', '--to', 'missing.json'), /No element matches/);
  assert.deepEqual((await readdir(project)).sort(), ['element.json', 'full.json', 'image.json', 'tall.json']);
  assert.deepEqual(await bundle('full.json'), document);
  console.log('Verified editable full-page and element exports, original JPEG, fonts, images, raster fallback, privacy, truncation and no overwrite.');
} finally {
  if (carbon && carbon.exitCode == null && carbon.signalCode == null) {
    const exited = once(carbon, 'exit');
    carbon.kill('SIGTERM');
    await Promise.race([exited, delay(1500).then(() => carbon.kill('SIGKILL'))]);
  }
  web?.closeAllConnections();
  web?.close();
  await rm(root, { recursive: true, force: true });
}
