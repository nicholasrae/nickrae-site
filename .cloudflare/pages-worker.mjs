import previewWorker from './preview-worker.mjs';
import htmlPages from './generated/pages-html.mjs';

function htmlResponse(request, page) {
  const size = page.bytes;
  const etag = '"' + page.sha256 + '"';
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': String(size),
    'Accept-Ranges': 'bytes',
    'ETag': etag
  });
  const matches = request.headers.get('if-none-match');
  if (matches && matches.split(',').some(value => ['*', etag, 'W/' + etag].includes(value.trim()))) {
    headers.delete('Content-Length');
    return new Response(null, {status: 304, headers});
  }
  let start = 0, end = size - 1, status = 200;
  const range = request.method === 'GET' && request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  if (range && (!ifRange || ifRange === etag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    let valid = !!match && !!(match[1] || match[2]);
    if (valid && !match[1]) {
      const suffix = Number(match[2]);
      valid = Number.isSafeInteger(suffix) && suffix > 0;
      start = Math.max(0, size - suffix);
    } else if (valid) {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : end;
      valid = Number.isSafeInteger(start) && Number.isSafeInteger(end) && start < size && end >= start;
    }
    if (!valid) {
      headers.set('Content-Range', 'bytes */' + size);
      headers.set('Content-Length', '0');
      return new Response(null, {status: 416, headers});
    }
    status = 206;
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
  }
  if (request.method === 'HEAD') return new Response(null, {headers});
  // Binary decoding preserves every original UTF-8 byte, including a BOM.
  const bytes = Uint8Array.from(atob(page.base64), character => character.charCodeAt(0));
  return new Response(bytes.subarray(start, end + 1), {status, headers});
}

export default {
  async fetch(request, env) {
    const originalPath = new URL(request.url).pathname;
    return previewWorker.fetch(request, {ASSETS: {async fetch(assetRequest) {
      const pathname = new URL(assetRequest.url).pathname;
      if (Object.prototype.hasOwnProperty.call(htmlPages, pathname)) {
        // A missing/private URL must retain its complete custom404, even if the
        // visitor sends a Range or validator for another representation.
        if (pathname === '/404.html' && !['/404.html', '/404'].includes(originalPath)) {
          const headers = new Headers(assetRequest.headers);
          for (const name of ['Range', 'If-Range', 'If-None-Match']) headers.delete(name);
          assetRequest = new Request(assetRequest, {headers});
        }
        return htmlResponse(assetRequest, htmlPages[pathname]);
      }
      // Non-HTML assets use the existing Pages asset service without URL
      // rewriting. All HTML is served above, bypassing Pages' clean-URL rules.
      return env.ASSETS.fetch(assetRequest);
    }}});
  }
};
