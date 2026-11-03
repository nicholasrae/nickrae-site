import routing from './generated/routes.mjs';
import policies from './generated/production-policies.mjs';

const assets = new Set(routing.assets);
const productionHosts = new Set(['nickrae.net', 'www.nickrae.net']);
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function responsePolicy(response, {candidate = false, target = null, status = response.status} = {}) {
  const headers = new Headers(response.headers);
  // A candidate deployment and a custom-domain deployment use the same bytes,
  // but only the two explicit production hosts may return indexable content.
  headers.delete('X-NickRae-Preview');
  headers.delete('X-Robots-Tag');
  if (candidate) {
    headers.set('X-NickRae-Preview', '1');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('Cache-Control', 'no-store');
  } else if (status >= 400) {
    headers.set('X-Robots-Tag', own(policies.noindex, target) ? policies.noindex[target] : 'noindex, nofollow');
    headers.set('Cache-Control', 'no-store');
  } else {
    if (own(policies.noindex, target)) headers.set('X-Robots-Tag', policies.noindex[target]);
    // HTML remains revalidatable rather than pinned across deployments. Leave
    // non-HTML assets on Pages' own deployment-aware caching policy; a stable
    // PDF or script filename must never acquire an immutable long lifetime.
    if ((target && target.endsWith('.html')) || [301, 302, 303, 307, 308].includes(status)) {
      headers.set('Cache-Control', 'no-cache');
    }
  }
  return new Response(response.body, {
    status,
    statusText: status === 404 ? 'Not Found' : response.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const production = productionHosts.has(url.hostname) && !url.port;
    const candidate = url.hostname.endsWith('.pages.dev') && url.hostname !== 'pages.dev' && !url.port;
    if ((!production && !candidate) || !['http:', 'https:'].includes(url.protocol)) {
      return responsePolicy(new Response('This deployment is not configured for this host.', {status: 421}), {candidate: true});
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return responsePolicy(new Response(null, {status: 405, headers: {'Allow': 'GET, HEAD'}}), {candidate});
    }
    // Match the live site's current www -> HTTPS apex 301, retaining the full
    // path and query. HTTP www combines both upgrades into this single hop.
    if (url.protocol === 'http:' || (production && url.hostname === 'www.nickrae.net')) {
      url.protocol = 'https:';
      if (production) url.hostname = 'nickrae.net';
      return responsePolicy(new Response(null, {status: 301, headers: {'Location': url.toString()}}), {candidate});
    }
    if (own(routing.slashRedirects, url.pathname)) {
      url.pathname = routing.slashRedirects[url.pathname];
      return responsePolicy(new Response(null, {status: 301, headers: {'Location': url.toString()}}), {candidate});
    }
    let target = assets.has(url.pathname) ? url.pathname : null;
    if (!target && own(routing.routes, url.pathname)) target = routing.routes[url.pathname];
    if (!target) {
      url.pathname = '/404.html';
      const response = await env.ASSETS.fetch(new Request(url, request));
      return responsePolicy(response, {candidate, target: '/404.html', status: 404});
    }
    url.pathname = target;
    return responsePolicy(await env.ASSETS.fetch(new Request(url, request)), {candidate, target});
  }
};
