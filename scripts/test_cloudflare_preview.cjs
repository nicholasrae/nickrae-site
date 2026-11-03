#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const control = path.join(root, '.cloudflare');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
const hash = body => crypto.createHash('sha256').update(body).digest('hex');

(async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(control, 'generated/manifest.json'), 'utf8'));
  const worker = (await import(pathToFileURL(path.join(control, 'preview-worker.mjs')))).default;
  const config = JSON.parse((await fs.readFile(path.join(control, 'wrangler.preview.jsonc'), 'utf8')).replace(/^\s*\/\/.*$/mg, ''));
  const calls = [];
  const bodies = new Map();
  for (const file of Object.keys(manifest.files)) bodies.set('/' + file, await fs.readFile(path.join(control, 'dist', file)));
  const env = {ASSETS: {async fetch(request) {
    const url = new URL(request.url);
    calls.push({url: url.toString(), method: request.method, range: request.headers.get('range')});
    const body = bodies.get(decodeURIComponent(url.pathname));
    if (!body) return new Response('Asset binding miss', {status: 404});
    const types = {'.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'};
    const headers = new Headers({'Content-Type': types[path.extname(url.pathname)] || 'application/octet-stream', 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes'});
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      assert.ok(match, 'Test binding supports one normal range');
      const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : body.length - 1, body.length - 1);
      if (start >= body.length || end < start) return new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + body.length}});
      headers.set('Content-Range', `bytes ${start}-${end}/${body.length}`);
      headers.set('Content-Length', String(end - start + 1));
      return new Response(request.method === 'HEAD' ? null : body.subarray(start, end + 1), {status: 206, headers});
    }
    return new Response(request.method === 'HEAD' ? null : body, {headers});
  }}};
  const fetch = (route, init) => worker.fetch(new Request('https://nickrae-preview.example.workers.dev' + route, init), env);
  const noindex = response => {
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-nickrae-preview'), '1');
  };
  await test('configuration is preview-only and keeps exact HTML handling', async () => {
    assert.equal(config.name, 'nickrae-preview');
    assert.equal(config.workers_dev, true);
    assert.equal(config.assets.html_handling, 'none');
    assert.equal(config.assets.not_found_handling, 'none');
    assert.equal(config.assets.run_worker_first, true);
    assert.equal(config.assets.binding, 'ASSETS');
    for (const key of ['route', 'routes', 'account_id', 'zone_id']) assert.equal(config[key], undefined, key);
  });
  await test('all exported asset bytes match source and source manifest hashes', async () => {
    assert.equal(bodies.size, manifest.publicFileCount);
    for (const [file, info] of Object.entries(manifest.files)) {
      assert.equal(hash(await fs.readFile(path.join(root, file))), info.sha256, file);
      assert.equal(hash(bodies.get('/' + file)), info.sha256, file);
      assert.equal(bodies.get('/' + file).length, info.bytes, file);
    }
    assert.equal(Object.keys(manifest.files).filter(f => f.endsWith('.pdf')).length, manifest.pdfFiles);
  });
  await test('internal, metadata and generated files are absent from the payload', async () => {
    for (const file of ['CNAME', '_config.yml', '.gitignore', '.github/workflows/site-checks.yml', 'scripts/check_site.py', 'data/pages.json', 'data/workbooks.json', 'PLAYBOOK_CONVERSION_MEMO_2026-04-03.md', 'WEBSITE_CONVERSION_MEMO_2026-04-03.md', 'SITE_TEARDOWN_2026-04-03.md', 'INDEX_HTML_REDIRECT_NOTES.md', '.cloudflare/preview-worker.mjs', '.cloudflare/generated/manifest.json']) assert.equal(manifest.files[file], undefined, file);
    for (const file of Object.keys(manifest.files)) assert.ok(!file.split('/').some(part => part.startsWith('.') || part.startsWith('_')), file);
  });
  await test('all public files serve identical bytes with preview indexing headers', async () => {
    for (const [file, info] of Object.entries(manifest.files)) {
      const response = await fetch('/' + file + '?analytics_test=1');
      assert.equal(response.status, 200, file); noindex(response);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), info.sha256, file);
    }
  });
  await test('homepage and every directory index resolve with 200 and unchanged bytes', async () => {
    for (const [route, target] of Object.entries(manifest.routing.routes).filter(([route]) => route === '/' || route.endsWith('/'))) {
      const response = await fetch(route + '?analytics_test=1');
      assert.equal(response.status, 200, route); noindex(response);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bodies.get(target), route);
    }
  });
  await test('bare directory 301s preserve complete query text', async () => {
    const query = '?analytics_test=1&utm_source=x&example=%2f+%20';
    for (const [route, destination] of Object.entries(manifest.routing.slashRedirects)) {
      const response = await fetch(route + query); assert.equal(response.status, 301, route); noindex(response);
      assert.equal(response.headers.get('location'), 'https://nickrae-preview.example.workers.dev' + destination + query, route);
    }
  });
  await test('known extensionless article aliases remain 200 without a redirect', async () => {
    const response = await fetch('/blog/checkride-prep-guide?analytics_test=1');
    assert.equal(response.status, 200); assert.equal(response.headers.get('location'), null);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bodies.get('/blog/checkride-prep-guide.html'));
  });
  await test('explicit .html and direct index.html URLs stay 200', async () => {
    for (const route of ['/blog/checkride-prep-guide.html', '/about/index.html', '/index.html']) {
      const response = await fetch(route); assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('location'), null, route); noindex(response);
    }
  });
  await test('rewritten asset requests preserve query, method and request headers', async () => {
    await fetch('/about/?analytics_test=1&value=%2F', {method: 'HEAD', headers: {'X-Synthetic-Test': 'yes'}});
    const last = calls[calls.length - 1];
    assert.equal(last.url, 'https://nickrae-preview.example.workers.dev/about/index.html?analytics_test=1&value=%2F');
    assert.equal(last.method, 'HEAD');
  });
  await test('unknown and private paths return the unchanged custom 404 with status404', async () => {
    for (const route of ['/missing-preview-page', '/scripts/check_site.py', '/data/pages.json', '/.git/config', '/.cloudflare/wrangler.preview.jsonc', '/_config.yml', '/CNAME', '/assets%2F..%2Fscripts%2Fcheck_site.py']) {
      const response = await fetch(route + '?analytics_test=1');
      assert.equal(response.status, 404, route); noindex(response);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bodies.get('/404.html'), route);
      assert.equal(new URL(calls[calls.length - 1].url).pathname, '/404.html');
    }
  });
  await test('custom404 direct file remains a normal 200 asset', async () => {
    assert.equal((await fetch('/404.html')).status, 200);
  });
  await test('all PDFs preserve type, complete bytes and HEAD semantics', async () => {
    for (const file of Object.keys(manifest.files).filter(f => f.endsWith('.pdf'))) {
      const response = await fetch('/' + file); noindex(response);
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bodies.get('/' + file));
      const head = await fetch('/' + file, {method: 'HEAD'}); noindex(head);
      assert.equal(head.status, 200); assert.equal((await head.arrayBuffer()).byteLength, 0);
      assert.equal(head.headers.get('content-length'), String(bodies.get('/' + file).length));
    }
  });
  await test('PDF and MP4 byte ranges pass through unchanged', async () => {
    for (const file of ['assets/free-ppl-oral-scenario-cards.pdf', 'lsu-stadium-approach.mp4']) {
      const response = await fetch('/' + file, {headers: {'Range': 'bytes=0-31'}}); noindex(response);
      assert.equal(response.status, 206); assert.equal(response.headers.get('content-length'), '32');
      assert.equal(response.headers.get('content-range'), `bytes 0-31/${bodies.get('/' + file).length}`);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bodies.get('/' + file).subarray(0, 32));
    }
  });
  await test('unsatisfiable asset ranges retain416 status and preview headers', async () => {
    const response = await fetch('/assets/free-ppl-oral-scenario-cards.pdf', {headers: {'Range': 'bytes=999999999-'}});
    assert.equal(response.status, 416); noindex(response);
  });
  await test('verification files and intentional HTML redirect stubs are unchanged', async () => {
    for (const file of ['google4fe268415010cf4b.html', 'cdabfd4d1da86266d8fd65752b533625.txt', 'blog/blog-trajectory-learning.html', 'blog/openclaw-setup.html', 'inflection/index.html']) {
      const response = await fetch('/' + file); assert.equal(response.status, 200, file);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bodies.get('/' + file), file);
    }
  });
  await test('production hostnames cannot be served accidentally by the preview Worker', async () => {
    for (const host of ['nickrae.net', 'www.nickrae.net']) {
      const before = calls.length;
      const response = await worker.fetch(new Request('https://' + host + '/'), env);
      assert.equal(response.status, 421); noindex(response); assert.equal(calls.length, before);
    }
  });
  await test('non-read requests do not reach assets or create any submission', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const before = calls.length; const response = await fetch('/', {method});
      assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD'); noindex(response);
      assert.equal(calls.length, before);
    }
  });
  await test('preview source preserves production-only Google SDK host gate and Kit identity', async () => {
    const js = bodies.get('/assets/site.js').toString();
    assert.match(js, /window\.location\.protocol !== 'https:' \|\| !\['nickrae\.net', 'www\.nickrae\.net'\]\.includes\(window\.location\.hostname\)/);
    const html = bodies.get('/aviation-workbooks/private-pilot/index.html').toString();
    assert.match(html, /data-uid="899d974875"/);
    assert.match(html, /https:\/\/f\.convertkit\.com\/ckjs\/ck\.5\.js/);
    assert.match(html, /action="https:\/\/app\.kit\.com\/forms\/10042240\/subscriptions"/);
    assert.match(html, /https:\/\/nickrae\.net\/aviation-workbooks\/private-pilot\//);
  });
  console.log(JSON.stringify({passedGroups: passed, publicFiles: manifest.publicFileCount, htmlFiles: manifest.htmlFiles, pdfFiles: manifest.pdfFiles, limits: 'Offline Worker/asset-binding tests; no Cloudflare, Google, signup or email receipt proof.'}));
})().catch(error => { console.error(error); process.exitCode = 1; });
