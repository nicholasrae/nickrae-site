#!/usr/bin/env node
'use strict';
// Read-only local adapter for the same preview Worker used by Cloudflare.
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {Readable} = require('node:stream');
const {pathToFileURL} = require('node:url');
const root = path.resolve(__dirname, '..');
const control = path.join(root, '.cloudflare');
const portIndex = process.argv.indexOf('--port');
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 8899;
const types = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2'};
(async () => {
  const worker = (await import(pathToFileURL(path.join(control, 'preview-worker.mjs')))).default;
  const manifest = JSON.parse(await fs.readFile(path.join(control, 'generated/manifest.json'), 'utf8'));
  const env = {ASSETS: {async fetch(request) {
    const url = new URL(request.url);
    let relative;
    try { relative = decodeURIComponent(url.pathname).slice(1); } catch { return new Response(null, {status: 404}); }
    if (!Object.prototype.hasOwnProperty.call(manifest.files, relative)) return new Response(null, {status: 404});
    const body = await fs.readFile(path.join(control, 'dist', relative));
    const headers = new Headers({'Content-Type': types[path.extname(relative).toLowerCase()] || 'application/octet-stream', 'Content-Length': String(body.length), 'Accept-Ranges': 'bytes'});
    let output = body, status = 200;
    const range = request.headers.get('range');
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match || Number(match[1]) >= body.length) return new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + body.length}});
      const start = Number(match[1]), end = Math.min(match[2] ? Number(match[2]) : body.length - 1, body.length - 1);
      if (end < start) return new Response(null, {status: 416, headers: {'Content-Range': 'bytes */' + body.length}});
      output = body.subarray(start, end + 1); status = 206;
      headers.set('Content-Length', String(output.length)); headers.set('Content-Range', `bytes ${start}-${end}/${body.length}`);
    }
    return new Response(request.method === 'HEAD' ? null : output, {status, headers});
  }}};
  http.createServer(async (req, res) => {
    try {
      const request = new Request(`http://127.0.0.1:${port}${req.url}`, {method: req.method, headers: req.headers});
      const response = await worker.fetch(request, env);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
    } catch (error) {
      console.error(error); res.writeHead(500, {'Content-Type': 'text/plain', 'X-Robots-Tag': 'noindex, nofollow'}); res.end('Preview adapter error');
    }
  }).listen(port, '127.0.0.1', () => console.log(`Nick Rae preview adapter: http://127.0.0.1:${port}/`));
})().catch(error => { console.error(error); process.exitCode = 1; });
