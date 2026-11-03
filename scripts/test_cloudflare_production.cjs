#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..'), control = path.join(root, '.cloudflare');
const sha = body => crypto.createHash('sha256').update(body).digest('hex');
let passed = 0;
async function test(name, fn) {await fn(); passed++; console.log('PASS ' + name);}

(async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(control, 'generated/manifest.json')));
  const production = JSON.parse(await fs.readFile(path.join(control, 'generated/production-manifest.json')));
  const worker = (await import(pathToFileURL(path.join(control, 'generated/production-bundle.mjs')))).default;
  const bodies = new Map();
  for (const file of Object.keys(manifest.files)) bodies.set('/' + file, await fs.readFile(path.join(control, 'production-dist', file)));
  const calls = [];
  const assetCache = 'public, max-age=0, must-revalidate';
  const env = {ASSETS: {async fetch(request) {
    const url = new URL(request.url); calls.push({url: url.href, method: request.method, range: request.headers.get('range')});
    // Pages redirects HTML assets by default. Production must serve embedded
    // HTML itself, never relying on this binding's clean-URL behavior.
    if (url.pathname.endsWith('.html')) return new Response(null, {status: 308, headers: {Location: url.pathname.slice(0, -5)}});
    const body = bodies.get(url.pathname);
    if (!body) return new Response('Binding miss', {status: 404});
    const etag = '"' + sha(body) + '"';
    const types = {'.pdf': 'application/pdf', '.js': 'application/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.xml': 'application/xml', '.txt': 'text/plain'};
    const headers = new Headers({'Content-Type': types[path.extname(url.pathname)] || 'application/octet-stream', 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes', 'Cache-Control': assetCache, 'ETag': etag});
    if (request.headers.get('if-none-match') === etag) {headers.delete('Content-Length'); return new Response(null, {status: 304, headers});}
    const range = request.headers.get('range');
    if (request.method === 'GET' && range && (!request.headers.get('if-range') || request.headers.get('if-range') === etag)) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match || Number(match[1]) >= body.length) return new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + body.length, 'Cache-Control': assetCache}});
      const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : body.length - 1, body.length - 1);
      if (end < start) return new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + body.length}});
      headers.set('Content-Length', String(end - start + 1)); headers.set('Content-Range', `bytes ${start}-${end}/${body.length}`);
      return new Response(body.subarray(start, end + 1), {status: 206, headers});
    }
    return new Response(request.method === 'HEAD' ? null : body, {headers});
  }}};
  const fetch = (route, init, origin = 'https://nickrae.net') => worker.fetch(new Request(origin + route, init), env);
  const candidateHeaders = response => {
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-nickrae-preview'), '1');
  };
  await test('explicit production output contains the same public bytes plus two closed-routing control files', async () => {
    assert.equal(production.mode, 'explicit-production-candidate');
    assert.deepEqual(production.productionHosts, ['nickrae.net', 'www.nickrae.net']);
    assert.equal(production.publicFileCount, manifest.publicFileCount); assert.equal(production.uploadFileCount, manifest.publicFileCount + 2);
    for (const [file, info] of Object.entries(manifest.files)) {
      assert.equal(sha(bodies.get('/' + file)), info.sha256, file);
      assert.deepEqual(bodies.get('/' + file), await fs.readFile(path.join(root, file)), file);
    }
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(control, 'production-dist/_routes.json'))), {version: 1, include: ['/*'], exclude: []});
    assert.deepEqual(await fs.readFile(path.join(control, 'production-dist/_worker.js')), await fs.readFile(path.join(control, 'generated/production-bundle.mjs')));
    assert.ok(production.workerBytes < 3 * 1024 * 1024); assert.ok(production.workerGzipBytes < 3 * 1024 * 1024);
  });
  await test('HTTPS apex serves every public file without HTML canonical redirects or blanket noindex', async () => {
    for (const [file, info] of Object.entries(manifest.files)) {
      const before = calls.length, response = await fetch('/' + file + '?analytics_test=1');
      assert.equal(response.status, 200, file); assert.equal(response.headers.get('location'), null, file);
      assert.equal(response.headers.get('x-nickrae-preview'), null, file);
      assert.equal(response.headers.get('x-robots-tag'), production.intentionalNoindexPages['/' + file] || null, file);
      assert.equal(sha(Buffer.from(await response.arrayBuffer())), info.sha256, file);
      assert.equal(response.headers.get('cache-control'), file.endsWith('.html') ? 'no-cache' : assetCache, file);
      if (file.endsWith('.html')) assert.equal(calls.length, before, file);
    }
  });
  await test('all known folder and extensionless aliases retain exact bytes and source indexing policy', async () => {
    for (const [route, target] of Object.entries(manifest.routing.routes)) {
      if (Object.hasOwn(manifest.routing.slashRedirects, route)) continue;
      const response = await fetch(route + '?analytics_test=1');
      assert.equal(response.status, 200, route); assert.equal(response.headers.get('location'), null, route);
      assert.equal(response.headers.get('x-robots-tag'), production.intentionalNoindexPages[target] || null, route);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bodies.get(target), route);
    }
  });
  await test('www matches the existing HTTPS apex301 and combines HTTP upgrade without changing path/query', async () => {
    const route = '/aviation-workbooks/private-pilot/?migration_readback=1&term=%2f+%20&value=one%26two';
    for (const origin of ['https://www.nickrae.net', 'http://www.nickrae.net', 'http://nickrae.net']) for (const method of ['GET', 'HEAD']) {
      const before = calls.length, response = await fetch(route, {method}, origin);
      assert.equal(response.status, 301); assert.equal(response.headers.get('location'), 'https://nickrae.net' + route);
      assert.equal(response.headers.get('cache-control'), 'no-cache'); assert.equal(response.headers.get('x-nickrae-preview'), null);
      assert.equal(response.headers.get('x-robots-tag'), null); assert.equal(calls.length, before);
    }
  });
  await test('all bare-directory redirects preserve the HTTPS apex and original encoded query', async () => {
    for (const [route, target] of Object.entries(manifest.routing.slashRedirects)) {
      const response = await fetch(route + '?analytics_test=1&term=%2f+%20');
      assert.equal(response.status, 301); assert.equal(response.headers.get('location'), 'https://nickrae.net' + target + '?analytics_test=1&term=%2f+%20');
      assert.equal(response.headers.get('cache-control'), 'no-cache');
    }
  });
  await test('every public candidate file remains byte-exact and noindex/no-store', async () => {
    for (const [file, info] of Object.entries(manifest.files)) {
      const response = await fetch('/' + file + '?analytics_test=1', undefined, 'https://nickrae-production-candidate.pages.dev');
      assert.equal(response.status, 200, file); candidateHeaders(response);
      assert.equal(sha(Buffer.from(await response.arrayBuffer())), info.sha256, file);
    }
  });
  await test('candidate redirects,304,404,405 and416 all retain noindex/no-store', async () => {
    const origin = 'https://hash.nickrae-production-candidate.pages.dev';
    const home = await fetch('/', undefined, origin), etag = home.headers.get('etag');
    for (const [route, init, status] of [['/about?x=%2f+%20', undefined, 301], ['/', {headers: {'If-None-Match': etag}}, 304], ['/unknown', undefined, 404], ['/', {method: 'POST'}, 405], ['/', {headers: {Range: 'bytes=999999999-'}}, 416]]) {
      const response = await fetch(route, init, origin); assert.equal(response.status, status); candidateHeaders(response);
    }
    const upgraded = await fetch('/about?x=%2f+%20', undefined, 'http://nickrae-production-candidate.pages.dev');
    assert.equal(upgraded.status, 301); assert.equal(upgraded.headers.get('location'), 'https://nickrae-production-candidate.pages.dev/about?x=%2f+%20'); candidateHeaders(upgraded);
  });
  await test('unknown hosts, confusing suffixes and nonstandard ports fail closed before asset access', async () => {
    for (const origin of ['https://example.com', 'https://nickrae.net.evil.example', 'https://pages.dev', 'https://evilpages.dev', 'https://app.pages.dev.evil.example', 'https://nickrae.net:8443', 'https://candidate.pages.dev:8443']) {
      const before = calls.length, response = await fetch('/', undefined, origin);
      assert.equal(response.status, 421, origin); candidateHeaders(response); assert.equal(calls.length, before);
    }
  });
  await test('writes and OPTIONS never reach assets or redirect to another host', async () => {
    for (const origin of ['https://nickrae.net', 'https://www.nickrae.net', 'http://www.nickrae.net', 'https://candidate.pages.dev']) for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const before = calls.length, response = await fetch('/aviation-workbooks/private-pilot/', {method}, origin);
      assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD'); assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(calls.length, before);
    }
  });
  await test('unknown/private/control routes retain complete custom404 and ignore unrelated validators/ranges', async () => {
    const etag = (await fetch('/')).headers.get('etag');
    for (const route of ['/not-found', '/scripts/check_site.py', '/data/pages.json', '/.git/config', '/.cloudflare/production-worker.mjs', '/_worker.js', '/_routes.json', '/CNAME']) {
      const response = await fetch(route, {headers: {Range: 'bytes=0-3', 'If-None-Match': etag, 'If-Range': etag}});
      assert.equal(response.status, 404, route); assert.equal(response.headers.get('content-range'), null);
      assert.equal(response.headers.get('x-robots-tag'), production.intentionalNoindexPages['/404.html']); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bodies.get('/404.html'), route);
      const head = await fetch(route, {method: 'HEAD'}); assert.equal(head.status, 404); assert.equal((await head.arrayBuffer()).byteLength, 0);
    }
    const direct = await fetch('/404.html'); assert.equal(direct.status, 200); assert.equal(direct.headers.get('x-robots-tag'), production.intentionalNoindexPages['/404.html']);
  });
  await test('HTML HEAD,ETag304 and byte ranges remain exact with revalidation caching', async () => {
    const file = '/blog/checkride-prep-guide.html', body = bodies.get(file);
    const first = await fetch(file), etag = first.headers.get('etag');
    const head = await fetch(file, {method: 'HEAD'}); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(body.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
    const unchanged = await fetch(file, {headers: {'If-None-Match': etag}}); assert.equal(unchanged.status, 304); assert.equal(unchanged.headers.get('cache-control'), 'no-cache'); assert.equal(unchanged.headers.get('x-robots-tag'), null);
    for (const [range, start, end] of [['bytes=0-31', 0, 31], ['bytes=32-', 32, body.length - 1], ['bytes=-32', body.length - 32, body.length - 1]]) {
      const response = await fetch(file, {headers: {Range: range, 'If-Range': etag}}); assert.equal(response.status, 206); assert.equal(response.headers.get('cache-control'), 'no-cache');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), body.subarray(start, end + 1));
    }
    const stale = await fetch(file, {headers: {Range: 'bytes=0-31', 'If-Range': '"stale"'}}); assert.equal(stale.status, 200); assert.deepEqual(Buffer.from(await stale.arrayBuffer()), body);
    const invalid = await fetch(file, {headers: {Range: 'bytes=999999999-'}}); assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('cache-control'), 'no-store');
  });
  await test('every PDF retains full bytes,HEAD,range,asset validators and mutable-URL caching', async () => {
    for (const file of Object.keys(manifest.files).filter(name => name.endsWith('.pdf'))) {
      const url = '/' + file, body = bodies.get(url), response = await fetch(url), etag = response.headers.get('etag');
      assert.equal(response.headers.get('content-type'), 'application/pdf'); assert.equal(response.headers.get('cache-control'), assetCache); assert.equal(response.headers.get('x-robots-tag'), null);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
      const head = await fetch(url, {method: 'HEAD'}); assert.equal(head.headers.get('content-length'), String(body.length)); assert.equal((await head.arrayBuffer()).byteLength, 0);
      const part = await fetch(url, {headers: {Range: 'bytes=0-31', 'If-Range': etag}}); assert.equal(part.status, 206); assert.equal(part.headers.get('cache-control'), assetCache); assert.deepEqual(Buffer.from(await part.arrayBuffer()), body.subarray(0, 32));
      const unchanged = await fetch(url, {headers: {'If-None-Match': etag}}); assert.equal(unchanged.status, 304); assert.equal(unchanged.headers.get('cache-control'), assetCache);
      const invalid = await fetch(url, {headers: {Range: 'bytes=999999999-'}}); assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('cache-control'), 'no-store');
    }
  });
  await test('source intentional noindex pages retain policy on aliases,HEAD and304 without changing content', async () => {
    assert.ok(Object.keys(production.intentionalNoindexPages).length >= 11);
    for (const [file, policy] of Object.entries(production.intentionalNoindexPages)) {
      const response = await fetch(file), etag = response.headers.get('etag'); assert.equal(response.headers.get('x-robots-tag'), policy);
      for (const init of [{method: 'HEAD'}, {headers: {'If-None-Match': etag}}]) assert.equal((await fetch(file, init)).headers.get('x-robots-tag'), policy);
    }
  });
  await test('production controls and internal data never enter the public file map', async () => {
    for (const file of Object.keys(manifest.files)) assert.ok(!/^(?:scripts\/|data\/|sketches\/|\.|_|CNAME$)/.test(file), file);
    const source = bodies.get('/assets/site.js').toString();
    assert.match(source, /window\.location\.protocol !== 'https:' \|\| !\['nickrae\.net', 'www\.nickrae\.net'\]\.includes\(window\.location\.hostname\)/);
    assert.equal(bodies.get('/robots.txt').toString(), await fs.readFile(path.join(root, 'robots.txt'), 'utf8'));
    assert.equal(bodies.get('/sitemap.xml').toString(), await fs.readFile(path.join(root, 'sitemap.xml'), 'utf8'));
  });
  console.log(JSON.stringify({passedGroups: passed, publicFiles: manifest.publicFileCount, htmlFiles: manifest.htmlFiles, pdfFiles: manifest.pdfFiles, intentionalNoindexPages: Object.keys(production.intentionalNoindexPages).length, limits: 'Local production bundle and simulated Pages binding. No deployment,DNS,Google or email-delivery proof.'}));
})().catch(error => {console.error(error); process.exitCode = 1;});
