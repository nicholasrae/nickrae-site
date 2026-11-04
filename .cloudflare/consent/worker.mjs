import {DurableObject} from 'cloudflare:workers';
import {ConsentLedger, LedgerError, POLICY, TOKEN_PATTERN, EVENT_PATTERN,
  constantTimeEqual, validObject, digest, token} from './ledger.mjs';

const ORIGIN = 'https://nickrae.net';
const BASE = '/api/ppl-measurement/v1/';
const ROUTES = new Set(['grant','revoke','status','permit','dispatch','result']);
const BROWSER_ROUTES = new Set(['grant','revoke']);
const MAX_BYTES = 512;

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Vary': 'Origin',
    'Allow': 'POST'
  }});
}

function bearer(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization') || '');
  return match ? match[1] : null;
}

export async function parseOperation(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.startsWith(BASE) ? url.pathname.slice(BASE.length) : '';
  if (url.origin !== ORIGIN || url.search || !ROUTES.has(path)) throw new LedgerError('not_found', 404);
  if (request.method !== 'POST') throw new LedgerError('method_not_allowed', 405);
  const browser = BROWSER_ROUTES.has(path);
  if (browser) {
    if (request.headers.get('Origin') !== ORIGIN
      || (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) {
      throw new LedgerError('origin_not_allowed', 403);
    }
    if (path === 'grant' && request.headers.get('Sec-GPC') === '1') throw new LedgerError('measurement_declined', 409);
  } else {
    if (request.headers.has('Origin') || request.headers.has('Cookie')) throw new LedgerError('importer_auth_required', 401);
    const expected = env.IMPORTER_TOKEN_SHA256;
    const supplied = bearer(request);
    if (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected)) throw new LedgerError('service_unconfigured', 503);
    if (!supplied || !constantTimeEqual(await digest(supplied), expected)) throw new LedgerError('importer_auth_required', 401);
  }
  if (request.headers.get('Content-Type') !== 'application/json') throw new LedgerError('json_required', 415);
  const size = request.headers.get('Content-Length');
  if (size && (!/^\d+$/.test(size) || Number(size) > MAX_BYTES)) throw new LedgerError('body_too_large', 413);
  if (!request.body) throw new LedgerError('invalid_body', 400);
  const reader = request.body.getReader();
  let length = 0, body = '';
  const decoder = new TextDecoder('utf-8', {fatal: true});
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) { await reader.cancel(); throw new LedgerError('body_too_large', 413); }
      body += decoder.decode(value, {stream: true});
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof LedgerError) throw error;
    throw new LedgerError('invalid_body', 400);
  }
  let data;
  try { data = JSON.parse(body); } catch (_) { throw new LedgerError('invalid_json', 400); }
  const keys = {
    grant: ['policy','qa'], revoke: ['receipt_id'], status: ['receipt_id'],
    permit: ['receipt_id','event_key'], dispatch: ['receipt_id','event_key','permit_token'],
    result: ['receipt_id','event_key','outcome']
  }[path];
  // These schemas contain only scalar values with fixed/token alphabets. Reject
  // duplicate, escaped or nested property names instead of silently accepting
  // JSON.parse's last value for an ambiguous member.
  const writtenKeys = Array.from(body.matchAll(/"([^"\\]*)"\s*:/g), match => match[1]);
  if (!validObject(data, keys) || writtenKeys.length !== keys.length
    || writtenKeys.some(key => !keys.includes(key))
    || keys.some(key => writtenKeys.filter(value => value === key).length !== 1)) {
    throw new LedgerError('invalid_fields', 400);
  }
  if (path === 'grant') {
    if (data.policy !== POLICY || typeof data.qa !== 'boolean') throw new LedgerError('invalid_grant', 400);
    const receiptId = token(), capability = token();
    return {path, args: {receiptId, revokeHash: await digest(capability), qa: data.qa}, capability};
  }
  if (typeof data.receipt_id !== 'string' || !TOKEN_PATTERN.test(data.receipt_id)) throw new LedgerError('invalid_receipt', 400);
  const args = {receiptId: data.receipt_id};
  if (path === 'revoke') {
    const capability = bearer(request);
    if (!capability) throw new LedgerError('revoke_auth_required', 401);
    args.capabilityHash = await digest(capability);
  }
  if (['permit','dispatch','result'].includes(path)) {
    if (typeof data.event_key !== 'string' || !EVENT_PATTERN.test(data.event_key)) throw new LedgerError('invalid_event', 400);
    args.eventKey = data.event_key;
  }
  if (path === 'permit') {
    const permitToken = token();
    args.permitHash = await digest(permitToken);
    return {path, args, permitToken};
  }
  if (path === 'dispatch') {
    if (typeof data.permit_token !== 'string' || !TOKEN_PATTERN.test(data.permit_token)) throw new LedgerError('invalid_permit', 400);
    args.permitHash = await digest(data.permit_token);
  }
  if (path === 'result') {
    if (!['accepted','rejected','unknown'].includes(data.outcome)) throw new LedgerError('invalid_outcome', 400);
    args.outcome = data.outcome;
  }
  return {path, args};
}

export function applyOperation(ledger, operation, now) {
  let data, status = 200;
  const {path, args} = operation;
  if (path === 'grant') {
    data = {...ledger.grant(args, now), revoke_capability: operation.capability}; status = 201;
  } else if (path === 'status') data = ledger.snapshot(args.receiptId, now);
  else if (path === 'revoke') data = ledger.revoke(args, now);
  else if (path === 'permit') {
    data = {...ledger.prepare(args, now), permit_token: operation.permitToken}; status = 201;
  } else if (path === 'dispatch') data = ledger.dispatch(args, now);
  else data = ledger.result(args, now);
  return {data, status};
}

export class PplConsentLedger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.ledger = new ConsentLedger(ctx.storage.sql);
  }

  async fetch(request) {
    try {
      const withdrawal = new URL(request.url).pathname === BASE + 'revoke';
      if (!withdrawal && (this.env.SERVICE_ENABLED !== 'true' || typeof this.env.IMPORTER_TOKEN_SHA256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(this.env.IMPORTER_TOKEN_SHA256))) {
        return response({error: 'service_unconfigured'}, 503);
      }
      const operation = await parseOperation(request, this.env);
      const now = Date.now();
      const reply = this.ctx.storage.transactionSync(() => {
        try { return applyOperation(this.ledger, operation, now); }
        catch (error) {
          // Persist the aggregate public-request budget even for a bad revoke
          // capability. No receipt mutation precedes a failing validation.
          if (error instanceof LedgerError) return {data: {error: error.code}, status: error.status};
          throw error;
        }
      });
      // Alarm is only data expiry/cleanup; it never sends conversions or email.
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null) await this.ctx.storage.setAlarm(now + 60 * 60 * 1000);
      return response(reply.data, reply.status);
    } catch (error) {
      return response({error: error instanceof LedgerError ? error.code : 'service_unavailable'},
        error instanceof LedgerError ? error.status : 503);
    }
  }

  async alarm() {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => this.ledger.cleanup(now));
    // Continue while any unexpired receipt exists; otherwise leave the object idle.
    const remaining = Array.from(this.ctx.storage.sql.exec(`SELECT 1 FROM receipts
      UNION ALL SELECT 1 FROM daily_limits LIMIT 1`));
    if (remaining.length) await this.ctx.storage.setAlarm(now + 60 * 60 * 1000);
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.origin !== ORIGIN || !url.pathname.startsWith(BASE) || url.search) return response({error: 'not_found'}, 404);
      const withdrawal = url.pathname === BASE + 'revoke';
      if (!env.PPL_LEDGER || (!withdrawal && (env.SERVICE_ENABLED !== 'true' || typeof env.IMPORTER_TOKEN_SHA256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(env.IMPORTER_TOKEN_SHA256)))) {
        return response({error: 'service_unconfigured'}, 503);
      }
      return await env.PPL_LEDGER.getByName('ppl-ads-v1').fetch(request);
    } catch (_) { return response({error: 'service_unavailable'}, 503); }
  }
};
