import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
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
const tokens = async () => JSON.parse((await exec(resolve(cliPath), ['canvas', 'tokens'], { cwd: root, env })).stdout);
const bundle = async name => JSON.parse(await readFile(join(project, name), 'utf8'));
const layers = nodes => nodes.flatMap(node => [node, ...layers(node.children ?? [])]);

try {
  await mkdir(join(home, 'sessions'), { recursive: true });
  await mkdir(project);
  const cssPath = join(project, 'tokens.css');
  await writeFile(cssPath, ':root { --brand: #14283c; --space: 4px; }\n@theme inline { --radius-card: 12px; }\n');
  await writeFile(join(home, 'sessions/index.json'), JSON.stringify([{
    sessionId, harness: 'claude_code', cwd: project, projectPath: project, title: 'Browser capture fixture',
    status: 'idle', created: new Date().toISOString(), modified: new Date().toISOString(), archived: false, pinned: false,
  }]));
  const chromium = process.env.CARBON_TEST_CHROMIUM ?? join(homedir(), '.carbon-dev/chromium');
  try { await access(chromium); await symlink(chromium, join(home, 'chromium')); } catch {}

  const font = await readFile(new URL('../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', import.meta.url));
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const background = 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><!--${'x'.repeat(2300)}--><rect width="4" height="4" fill="green"/></svg>`).toString('base64');
  web = createServer((req, res) => {
    if (req.url?.split('?')[0] === '/fixture.woff2') { res.writeHead(200, { 'content-type': 'font/woff2' }); res.end(font); return; }
    if (req.url === '/pixel.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(pixel); return; }
    if (req.url === '/embedded') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<style>input{color:red;transition:-webkit-text-fill-color 10s linear}</style><input value="fixture-private-embedded">');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html data-theme="light"><style>
      @font-face{font-family:Fixture;src:url(/fixture.woff2);font-weight:100 900}
      @font-face{font-family:PseudoFixture;src:url(/fixture.woff2?icons);font-weight:100 900}
      body{margin:0;background:#f8f6f2}
      :root { --brand:#14283c; --space:4px; --radius-card:12px; --same-value:#14283c }
      @layer base, components;
      @layer base { main { padding:0 } }
      @layer components { #checkout { padding:calc(var(--space) * 4) } }
      #checkout{width:320px;margin:20px;background:#fff;font-family:Fixture,sans-serif;border-radius:var(--radius-card)}
      .buy { color:var(--brand); }
      @media (min-width: 10000px) { .buy { color:var(--same-value) } }
      #overridden { color:var(--same-value); border-left:1px solid; border-left-color:var(--same-value); border-inline-start-color:rgb(20,40,60); }
      button#overridden { color:rgb(20,40,60); }
      h1::before{content:"*";font-family:PseudoFixture}
      aside{height:32px;overflow:auto}aside span{display:block;height:64px}
      footer{height:2100px}iframe{display:block;width:160px;height:50px}
      </style>
      <main id="checkout" data-astro-source-file="/src/checkout.astro?query=private">
        <h1 style="color:rgb(20,40,60)">Checkout</h1>
        <button class="buy" style="background-color:var(--brand)" onclick="document.body.remove()">Pay now</button>
        <button id="overridden">Other</button>
        <img src="/pixel.png" width="24" height="24">
        <iframe src="/embedded"></iframe>
        <iframe sandbox srcdoc="<input value='fixture-private-opaque'>"></iframe>
        <input value="fixture-private-value">
        <input id="blank">
        <div style="width:30px;height:20px;background-image:url('${background}')">Badge</div>
        <aside><span>First</span><span>Second</span></aside>
        <p style="visibility:hidden">Hidden data <span>also hidden</span></p>
      </main>
      <footer>Below the fold</footer><script>document.documentElement.dataset.fixture = "ready"</script>`);
  }).listen(0, '127.0.0.1');
  await once(web, 'listening');
  carbon = spawn(resolve(serverPath), ['--port', '0'], { env, stdio: 'ignore' });
  for (let attempt = 0; ; attempt++) {
    try { await access(env.CARBON_ENDPOINT); break; }
    catch (error) { if (attempt >= 200) throw error; await delay(50); }
  }

  const catalog = await tokens();
  assert.equal(catalog.source.cwd, await realpath(project));
  assert.deepEqual(catalog.tokens.find(token => token.name === '--radius-card').scope, ['@theme inline']);
  assert.equal(catalog.tokens.find(token => token.name === '--brand').value, '#14283c');

  await browser('open', `http://127.0.0.1:${web.address().port}/checkout?session=fixture-private-query`);
  await browser('wait', '--load', 'load');
  await browser('eval', `(async()=>{
    await document.fonts.ready;
    const field = document.querySelector('iframe').contentDocument.querySelector('input');
    window.embeddedMask = false;
    new MutationObserver(() => {
      window.embeddedMask ||= getComputedStyle(field).webkitTextFillColor === 'rgba(0, 0, 0, 0)';
    }).observe(field, {attributes:true, attributeFilter:['style']});
    window.blankMask = false;
    new MutationObserver(() => {
      const field = document.querySelector('#blank');
      if (field.style.webkitTextFillColor === 'transparent') {
        field.value = 'fixture-private-autofill';
        window.blankMask ||= getComputedStyle(field).webkitTextFillColor === 'rgba(0, 0, 0, 0)';
      }
    }).observe(document.querySelector('main > input'), {attributes:true, attributeFilter:['style']});
    window.__carbonPick = {coverCapture() { throw new Error('Page code controlled capture'); }};
    document.querySelector('aside').scrollTop = 64;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return true;
  })()`);
  const viewport = JSON.parse((await browser('eval', '({width:innerWidth,height:innerHeight})', '--json')).stdout).value;
  const full = JSON.parse((await browser('capture', '--to', 'full.json', '--json')).stdout);
  const document = await bundle('full.json');
  assert.equal(document.formatVersion, 1);
  assert.equal(document.frame.geometry.width, viewport.width);
  assert(full.height > viewport.height);
  assert.equal(document.frame.capture.pagePath, '/checkout');
  assert.equal(document.frame.capture.imageOnly, false);
  assert(document.frame.capture.warnings.some(note => note.includes('Embedded page')));
  assert(document.frame.capture.warnings.some(note => note.includes('could not be inspected')));
  const captured = layers(document.frame.content.nodes);
  assert.equal(document.frame.content.tokenSource.checkout.cwd, await realpath(project));
  assert.deepEqual(document.frame.content.tokenSource.theme, ['data-theme=light']);
  const layerWithText = text => captured.find(node => node.children?.some(child => child.text === text));
  assert.deepEqual(layerWithText('Pay now').tokenReferences.color, ['--brand']);
  assert.deepEqual(layerWithText('Pay now').tokenReferences['background-color'], ['--brand']);
  assert.equal(layerWithText('Pay now').styles.color, 'rgb(20, 40, 60)');
  assert.equal(layerWithText('Other').tokenReferences?.color, undefined);
  assert.equal(layerWithText('Other').tokenReferences?.['border-left-color'], undefined);
  assert.equal(layerWithText('Checkout').tokenReferences?.color, undefined);
  const main = captured.find(node => node.tag === 'main');
  assert.deepEqual(main.tokenReferences['padding-left'], ['--space']);
  assert.deepEqual(main.tokenReferences['border-top-left-radius'], ['--radius-card']);
  assert.equal(main.styles['padding-left'], '16px');
  await writeFile(cssPath, ':root { --space: 8px; }\n');
  const refreshed = await tokens();
  assert.equal(refreshed.tokens.find(token => token.name === '--space').value, '8px');
  assert(!refreshed.tokens.some(token => token.name === '--brand'));
  assert(captured.some(node => node.text === 'Below the fold'));
  assert(captured.some(node => node.name === 'Embedded page · Image reference'));
  assert(captured.some(node => node.name === 'Scrolled area · Image reference'));
  const badge = captured.find(node => node.children?.some(child => child.text === 'Badge'));
  assert.match(badge.styles['background-image'], /carbon-canvas-asset:\/\//, document.frame.capture.warnings.join(' '));
  assert(captured.every(node => !['iframe', 'script'].includes(node.tag) && !node.attributes?.onclick));
  assert(!JSON.stringify(document).includes('fixture-private'));
  assert(!captured.some(node => node.text?.includes('Hidden data')));
  assert.match(document.frame.content.css, /font-family:PseudoFixture;src:url\(carbon-canvas-asset:\/\//);
  const masks = JSON.parse((await browser('eval', `({
    embedded: window.embeddedMask,
    blank: window.blankMask,
    remaining: [...document.querySelectorAll('input'), document.querySelector('iframe').contentDocument.querySelector('input')].some(field => field.hasAttribute('style')),
  })`, '--json')).stdout).value;
  assert.deepEqual(masks, { embedded: true, blank: true, remaining: false });
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
  await browser('eval', 'document.querySelector("footer").__reactFiber$fixture = {_debugSource:{fileName:"/src/Footer.tsx?hidden=1",lineNumber:42}}');
  await browser('capture', 'footer', '--to', 'source.json');
  assert.deepEqual((await bundle('source.json')).frame.capture.source, {
    file: '/src/Footer.tsx', line: 42, framework: 'React', confidence: 'exact',
  });
  await browser('capture', 'iframe', '--to', 'image.json');
  assert.equal((await bundle('image.json')).frame.name, 'Image reference');
  await browser('eval', 'document.querySelector("main").style.transform = "scale(0.5)"');
  const transformed = JSON.parse((await browser('capture', 'h1', '--to', 'transformed.json', '--json')).stdout);
  assert.equal(transformed.imageOnly, true);
  assert(transformed.warnings.some(note => note.includes('transform')));
  await browser('eval', 'document.querySelector("main").style.removeProperty("transform")');
  await browser('eval', `(() => {
    const heading = document.querySelector('h1');
    const observer = new MutationObserver(() => { observer.disconnect(); heading.style.color = 'blue'; });
    observer.observe(document.querySelector('main input'), {attributes:true, attributeFilter:['style']});
  })()`);
  await assert.rejects(browser('capture', '#checkout', '--to', 'stale.json'), /page changed or capture expired/);
  assert.equal((await browser('eval', 'document.querySelector("main input").hasAttribute("style")')).stdout.trim(), 'false');
  await browser('eval', 'document.querySelector("footer").style.height = "12000px"');
  const tall = JSON.parse((await browser('capture', '--to', 'tall.json', '--json')).stdout);
  assert.equal(tall.height, 10_000);
  assert(tall.warnings.some(note => note.includes('cropped')));
  await assert.rejects(browser('capture', '--to', 'full.json'), /exists/);
  await assert.rejects(browser('capture', '#missing', '--to', 'missing.json'), /No element matches/);
  assert.deepEqual((await readdir(project)).sort(), ['element.json', 'full.json', 'image.json', 'source.json', 'tall.json', 'tokens.css', 'transformed.json']);
  assert.deepEqual(await bundle('full.json'), document);
  console.log('Verified project token refresh, captured token links, editable exports, original JPEG, assets, raster fallback, privacy, truncation and no overwrite.');
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
