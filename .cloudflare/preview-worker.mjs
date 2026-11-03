import routing from './generated/routes.mjs';

const assets = new Set(routing.assets);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function previewResponse(response, status = response.status) {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-NickRae-Preview', '1');
  return new Response(response.body, {
    status,
    statusText: status === 404 ? 'Not Found' : response.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    // A preview must never become an accidental response for the live domain.
    if (['nickrae.net', 'www.nickrae.net'].includes(url.hostname)) {
      return previewResponse(new Response('This Worker is preview-only.', {status: 421}));
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return previewResponse(new Response(null, {status: 405, headers: {'Allow': 'GET, HEAD'}}));
    }
    if (own(routing.slashRedirects, url.pathname)) {
      url.pathname = routing.slashRedirects[url.pathname];
      return previewResponse(new Response(null, {status: 301, headers: {'Location': url.toString()}}));
    }
    let target = assets.has(url.pathname) ? url.pathname : null;
    if (!target && own(routing.routes, url.pathname)) target = routing.routes[url.pathname];
    if (!target) {
      url.pathname = '/404.html';
      const response = await env.ASSETS.fetch(new Request(url, request));
      return previewResponse(response, 404);
    }
    url.pathname = target;
    return previewResponse(await env.ASSETS.fetch(new Request(url, request)));
  }
};
