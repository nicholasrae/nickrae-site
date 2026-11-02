#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..'), control = path.join(root, '.cloudflare');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
(async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(control, 'generated/manifest.json')));
  const pages = JSON.parse(await fs.readFile(path.join(control, 'generated/pages-manifest.json')));
  const worker = (await import(pathToFileURL(path.join(control, 'generated/pages-bundle.mjs')))).default;
  const bodies = new Map();
  for (const file of Object.keys(manifest.files)) bodies.set('/' + file, await fs.readFile(path.join(control, 'pages-dist', file)));
  const calls = [];
  const env = {ASSETS: {async fetch(request) {
    const url = new URL(request.url); calls.push({path: url.pathname, method: request.method, range: request.headers.get('range')});
    // Simulate Pages' canonical HTML redirects. The adapter must never depend
    // on any of these redirects or on Pages' HTML asset lookup behavior.
    if (url.pathname.endsWith('.html')) return new Response(null, {status: 308, headers: {Location: url.pathname.endsWith('/index.html') ? url.pathname.slice(0, -10) : url.pathname.slice(0, -5)}});
    const body = bodies.get(url.pathname);
    if (!body) return new Response('Pages binding miss', {status: 404});
    const types = {'.pdf': 'application/pdf', '.mp4': 'video/mp4', '.js': 'application/javascript', '.css': 'text/css'};
    const headers = new Headers({'Content-Type': types[path.extname(url.pathname)] || 'application/octet-stream', 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes'});
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d+)-(\d+)$/.exec(range); assert.ok(match);
      const start = Number(match[1]), end = Math.min(Number(match[2]), body.length - 1);
      headers.set('Content-Length', String(end - start + 1)); headers.set('Content-Range', `bytes ${start}-${end}/${body.length}`);
      return new Response(request.method === 'HEAD' ? null : body.subarray(start, end + 1), {status: 206, headers});
    }
    return new Response(request.method === 'HEAD' ? null : body, {headers});
  }}};
  const fetch = (route, init) => worker.fetch(new Request('https://nickrae-preview.pages.dev' + route, init), env);
  const preview = response => {
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-nickrae-preview'), '1');
  };
  await test('Pages output is unchanged public assets plus only the two Pages control files', async () => {
    assert.equal(pages.publicFileCount, manifest.publicFileCount); assert.equal(pages.uploadFileCount, manifest.publicFileCount + 2);
    for (const [name, info] of Object.entries(pages.files)) assert.equal(sha(await fs.readFile(path.join(control, 'pages-dist', name))), info.sha256, name);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(control, 'pages-dist/_routes.json'))), {version: 1, include: ['/*'], exclude: []});
    assert.ok(pages.workerBytes < 3 * 1024 * 1024); assert.ok(pages.workerGzipBytes < 3 * 1024 * 1024);
    assert.deepEqual(await fs.readFile(path.join(control, 'pages-dist/_worker.js')), await fs.readFile(path.join(control, 'generated/pages-bundle.mjs')));
  });
  await test('every public file is served with identical bytes and preview headers', async () => {
    for (const [file, info] of Object.entries(manifest.files)) {
      const before = calls.length, response = await fetch('/' + file + '?analytics_test=1');
      assert.equal(response.status, 200, file); assert.equal(response.headers.get('location'), null, file); preview(response);
      assert.equal(sha(Buffer.from(await response.arrayBuffer())), info.sha256, file);
      if (file.endsWith('.html')) assert.equal(calls.length, before, 'HTML must not reach the canonicalizing Pages binding: ' + file);
    }
  });
  await test('all HTML directory and extensionless aliases remain200 without outward redirects', async () => {
    for (const [route, target] of Object.entries(manifest.routing.routes)) {
      if (Object.hasOwn(manifest.routing.slashRedirects, route)) continue;
      const before = calls.length, response = await fetch(route + '?analytics_test=1');
      assert.equal(response.status, 200, route); assert.equal(response.headers.get('location'), null, route); preview(response);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bodies.get(target), route); assert.equal(calls.length, before);
    }
  });
  await test('bare directory redirects preserve the original query encoding', async () => {
    const response = await fetch('/about?analytics_test=1&example=%2f+%20'); preview(response);
    assert.equal(response.status, 301); assert.equal(response.headers.get('location'), 'https://nickrae-preview.pages.dev/about/?analytics_test=1&example=%2f+%20');
  });
  await test('HTML HEAD keeps MIME/full length and has no response body', async () => {
    for (const file of Object.keys(manifest.files).filter(f => f.endsWith('.html'))) {
      const response = await fetch('/' + file, {method: 'HEAD'}); preview(response);
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.equal(response.headers.get('content-length'), String(bodies.get('/' + file).length)); assert.equal((await response.arrayBuffer()).byteLength, 0);
    }
  });
  await test('HTML closed, open and suffix byte ranges preserve exact bytes', async () => {
    const body = bodies.get('/blog/checkride-prep-guide.html');
    for (const [range, start, end] of [['bytes=0-31', 0, 31], ['bytes=32-', 32, body.length - 1], ['bytes=-32', body.length - 32, body.length - 1]]) {
      const response = await fetch('/blog/checkride-prep-guide.html', {headers: {Range: range}}); preview(response);
      assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${body.length}`);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), body.subarray(start, end + 1));
    }
  });
  await test('invalid HTML ranges return416 and validators support304/IfRange safely', async () => {
    const full = await fetch('/blog/checkride-prep-guide.html'), etag = full.headers.get('etag');
    for (const range of ['bytes=999999999-', 'bytes=-0', 'bytes=8-2', 'bytes=0-2,4-6']) {
      const response = await fetch('/blog/checkride-prep-guide.html', {headers: {Range: range}}); assert.equal(response.status, 416); preview(response);
    }
    const conditional = await fetch('/blog/checkride-prep-guide.html', {headers: {'If-None-Match': etag}}); assert.equal(conditional.status, 304); preview(conditional); assert.equal((await conditional.arrayBuffer()).byteLength, 0);
    const changed = await fetch('/blog/checkride-prep-guide.html', {headers: {Range: 'bytes=0-31', 'If-Range': '"different"'}}); assert.equal(changed.status, 200);
    const same = await fetch('/blog/checkride-prep-guide.html', {headers: {Range: 'bytes=0-31', 'If-Range': etag}}); assert.equal(same.status, 206);
  });
  await test('PDF and media range requests still use the unchanged asset binding', async () => {
    for (const file of ['assets/free-ppl-oral-scenario-cards.pdf', 'lsu-stadium-approach.mp4']) {
      const before = calls.length, response = await fetch('/' + file, {headers: {Range: 'bytes=0-31'}}); preview(response);
      assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bodies.get('/' + file).subarray(0, 32)); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).range, 'bytes=0-31');
    }
  });
  await test('unknown/private/control paths return the full custom404 even with validators/ranges', async () => {
    for (const route of ['/not-a-page', '/scripts/check_site.py', '/data/pages.json', '/.git/config', '/_worker.js', '/_routes.json']) {
      const before = calls.length, response = await fetch(route, {headers: {Range: 'bytes=0-31', 'If-None-Match': '"' + manifest.files['404.html'].sha256 + '"'}}); preview(response);
      assert.equal(response.status, 404); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bodies.get('/404.html')); assert.equal(calls.length, before);
    }
  });
  await test('production hostname fence and unsupported-method protection remain intact', async () => {
    const refused = await worker.fetch(new Request('https://nickrae.net/'), env); assert.equal(refused.status, 421); preview(refused);
    const post = await fetch('/', {method: 'POST'}); assert.equal(post.status, 405); preview(post);
  });
  console.log(JSON.stringify({passedGroups: passed, publicFiles: pages.publicFileCount, uploadFiles: pages.uploadFileCount, embeddedHtml: pages.htmlFilesEmbedded, workerBytes: pages.workerBytes, workerGzipBytes: pages.workerGzipBytes, limits: 'Local bundled module and simulated Pages asset binding; not a deployed Cloudflare response or Google/Kit delivery test.'}));
})().catch(error => { console.error(error); process.exitCode = 1; });
