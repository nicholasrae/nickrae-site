import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {ConsentLedger, LedgerError, POLICY, RETENTION_MS, PERMIT_MS,
  MAX_DAILY_GRANTS, MAX_DAILY_PUBLIC_REQUESTS, constantTimeEqual} from './ledger.mjs';

// The override points only to an official npm installation for a local review;
// normal `npm ci && npm test` resolves the pinned dev dependency beside this file.
const require = createRequire(process.env.PPL_MINIFLARE_REQUIRE_BASE || import.meta.url);
const {Miniflare} = require('miniflare');
const control = path.dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse('2026-11-04T20:00:00Z');
const ID = 'A'.repeat(43), ID2 = 'B'.repeat(43), CAP = 'a'.repeat(64);
const PERMIT = 'b'.repeat(64), EVENT = 'c'.repeat(64), EVENT2 = 'd'.repeat(64);
const sha = value => createHash('sha256').update(value).digest('hex');

function fixture() {
  const db = new DatabaseSync(':memory:');
  const sql = {exec(statement, ...bindings) {
    const prepared = db.prepare(statement);
    return /^\s*SELECT\b/i.test(statement) ? prepared.all(...bindings) : (prepared.run(...bindings), []);
  }};
  const ledger = new ConsentLedger(sql);
  return {db, sql, ledger, grant(id = ID, qa = false) {
    return ledger.grant({receiptId: id, revokeHash: CAP, qa}, NOW);
  }};
}
function throwsCode(fn, code) {
  assert.throws(fn, error => error instanceof LedgerError && error.code === code);
}

test('SQLite records minimal grant with server time,30-day expiry and no raw capability', () => {
  const f = fixture(); const receipt = f.grant();
  assert.equal(receipt.state, 'granted'); assert.equal(receipt.qa, false); assert.equal(receipt.revision, 1);
  assert.equal(receipt.granted_at, new Date(NOW).toISOString());
  assert.equal(receipt.expires_at, new Date(NOW + RETENTION_MS).toISOString());
  assert.equal(f.ledger.get(ID).revoke_hash, CAP);
  assert.equal(JSON.stringify(receipt).includes(CAP), false);
  f.db.close();
});
test('unknown/wrong capability cannot revoke another receipt and exposes no identity', () => {
  const f = fixture(); f.grant();
  throwsCode(() => f.ledger.revoke({receiptId: ID2, capabilityHash: CAP}, NOW + 1), 'unknown_receipt');
  throwsCode(() => f.ledger.revoke({receiptId: ID, capabilityHash: 'f'.repeat(64)}, NOW + 1), 'unknown_receipt');
  assert.equal(f.ledger.snapshot(ID, NOW + 1).state, 'granted'); f.db.close();
});
test('acknowledged revoke is irreversible, idempotent and cancels a prepared permit', () => {
  const f = fixture(); f.grant();
  f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 1);
  const a = f.ledger.revoke({receiptId: ID, capabilityHash: CAP}, NOW + 2);
  const b = f.ledger.revoke({receiptId: ID, capabilityHash: CAP}, NOW + 3);
  assert.equal(a.state, 'revoked'); assert.equal(a.revision, 2); assert.equal(b.revision, 2);
  assert.equal(a.revoked_at, b.revoked_at); assert.equal(b.in_flight_may_have_sent, false);
  assert.equal(f.ledger.get(ID).permit_hash, null);
  throwsCode(() => f.ledger.dispatch({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 4), 'consent_revoked');
  throwsCode(() => f.ledger.grant({receiptId: ID, revokeHash: CAP, qa: false}, NOW + 5), 'identifier_collision');
  f.db.close();
});
test('QA receipt can be tested/revoked but never receives an import permit', () => {
  const f = fixture(); f.grant(ID, true);
  throwsCode(() => f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 1), 'qa_receipt');
  assert.equal(f.ledger.revoke({receiptId: ID, capabilityHash: CAP}, NOW + 2).state, 'revoked'); f.db.close();
});
test('expiry is enforced at30days before cleanup; unknown/expired never import', () => {
  const f = fixture(); f.grant();
  assert.equal(f.ledger.snapshot(ID, NOW + RETENTION_MS).state, 'expired');
  throwsCode(() => f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + RETENTION_MS), 'consent_expired');
  throwsCode(() => f.ledger.prepare({receiptId: ID2, eventKey: EVENT, permitHash: PERMIT}, NOW + 1), 'unknown_receipt'); f.db.close();
});
test('one outstanding short permit binds exact event and revision', () => {
  const f = fixture(); f.grant();
  const permit = f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 1);
  assert.equal(Date.parse(permit.permit_expires_at), NOW + 1 + PERMIT_MS);
  throwsCode(() => f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 2), 'permit_outstanding');
  throwsCode(() => f.ledger.dispatch({receiptId: ID, eventKey: EVENT2, permitHash: PERMIT}, NOW + 2), 'invalid_permit');
  throwsCode(() => f.ledger.dispatch({receiptId: ID, eventKey: EVENT, permitHash: 'e'.repeat(64)}, NOW + 2), 'invalid_permit');
  f.db.close();
});
test('expired unconsumed permit cannot dispatch; retry creates a new bounded permit', () => {
  const f = fixture(); f.grant();
  f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 1);
  throwsCode(() => f.ledger.dispatch({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 1 + PERMIT_MS), 'permit_expired');
  f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: 'e'.repeat(64)}, NOW + 2 + PERMIT_MS);
  throwsCode(() => f.ledger.dispatch({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 3 + PERMIT_MS), 'invalid_permit');
  f.db.close();
});
test('a stable event cannot move between receipts or be replaced by a different event', () => {
  const f = fixture(); f.grant(); f.grant(ID2);
  f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 1);
  throwsCode(() => f.ledger.prepare({receiptId: ID2, eventKey: EVENT, permitHash: PERMIT}, NOW + 2), 'event_already_bound');
  throwsCode(() => f.ledger.prepare({receiptId: ID, eventKey: EVENT2, permitHash: PERMIT}, NOW + PERMIT_MS + 2), 'receipt_already_bound'); f.db.close();
});
test('dispatch is single-use; lost/unknown provider result cannot issue a new permit', () => {
  const f = fixture(); f.grant();
  f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 1);
  const result = f.ledger.dispatch({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 2);
  assert.equal(result.dispatch_state, 'started');
  throwsCode(() => f.ledger.dispatch({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 3), 'invalid_permit');
  f.ledger.result({receiptId: ID, eventKey: EVENT, outcome: 'unknown'}, NOW + 4);
  throwsCode(() => f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 5), 'event_already_dispatched'); f.db.close();
});
test('revoke after dispatch states its in-flight boundary and blocks future permits', () => {
  const f = fixture(); f.grant();
  f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 1);
  f.ledger.dispatch({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 2);
  const ack = f.ledger.revoke({receiptId: ID, capabilityHash: CAP}, NOW + 3);
  assert.equal(ack.in_flight_may_have_sent, true); assert.equal(ack.state, 'revoked');
  assert.equal(f.ledger.result({receiptId: ID, eventKey: EVENT, outcome: 'accepted'}, NOW + 4).already_accepted, true);
  throwsCode(() => f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 5), 'consent_revoked'); f.db.close();
});
test('provider result is idempotent; unknown reconciles once, contradictory final result fails', () => {
  const f = fixture(); f.grant();
  f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 1);
  f.ledger.dispatch({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 2);
  f.ledger.result({receiptId: ID, eventKey: EVENT, outcome: 'unknown'}, NOW + 3);
  const result = f.ledger.result({receiptId: ID, eventKey: EVENT, outcome: 'accepted'}, NOW + 4);
  assert.deepEqual(f.ledger.result({receiptId: ID, eventKey: EVENT, outcome: 'accepted'}, NOW + 5).result_recorded_at, result.result_recorded_at);
  throwsCode(() => f.ledger.result({receiptId: ID, eventKey: EVENT, outcome: 'rejected'}, NOW + 6), 'result_conflict'); f.db.close();
});
test('result without matching dispatch cannot manufacture an accepted conversion', () => {
  const f = fixture(); f.grant();
  throwsCode(() => f.ledger.result({receiptId: ID, eventKey: EVENT, outcome: 'accepted'}, NOW + 1), 'dispatch_not_started'); f.db.close();
});
test('aggregate daily hard caps use no IP/device/user data', () => {
  const f = fixture(); const day = Math.floor(NOW / 86_400_000);
  f.sql.exec('INSERT INTO daily_limits VALUES(?,?,?)', day, MAX_DAILY_PUBLIC_REQUESTS - 1, MAX_DAILY_GRANTS - 1);
  f.grant();
  throwsCode(() => f.grant(ID2), 'daily_limit');
  const limits = f.sql.exec('SELECT * FROM daily_limits')[0];
  assert.deepEqual(Object.keys(limits), ['day','public_requests','grants']); f.db.close();
});
test('daily grant cap does not prevent a legitimate revoke while public budget remains', () => {
  const f = fixture(); f.grant(); const day = Math.floor(NOW / 86_400_000);
  f.sql.exec('UPDATE daily_limits SET grants=? WHERE day=?', MAX_DAILY_GRANTS, day);
  assert.equal(f.ledger.revoke({receiptId: ID, capabilityHash: CAP}, NOW + 1).state, 'revoked'); f.db.close();
});
test('exhausted anonymous request budget never blocks a holder\'s authenticated revoke', () => {
  const f = fixture(); f.grant(); const day = Math.floor(NOW / 86_400_000);
  f.sql.exec('UPDATE daily_limits SET public_requests=? WHERE day=?', MAX_DAILY_PUBLIC_REQUESTS, day);
  assert.equal(f.ledger.revoke({receiptId: ID, capabilityHash: CAP}, NOW + 1).state, 'revoked'); f.db.close();
});
test('cleanup deletes expired receipt/capability/event metadata and old aggregate buckets', () => {
  const f = fixture(); f.grant(); f.ledger.prepare({receiptId: ID, eventKey: EVENT, permitHash: PERMIT}, NOW + 1);
  f.ledger.cleanup(NOW + RETENTION_MS);
  assert.equal(f.sql.exec('SELECT * FROM receipts').length, 0);
  assert.equal(f.sql.exec('SELECT * FROM daily_limits').length, 0); f.db.close();
});
test('constant-time comparison rejects wrong lengths and types', () => {
  assert.equal(constantTimeEqual(CAP, CAP), true); assert.equal(constantTimeEqual(CAP, CAP + 'a'), false);
  assert.equal(constantTimeEqual(CAP, 'e'.repeat(64)), false); assert.equal(constantTimeEqual(null, CAP), false);
});

let mf, scratch, runtimeOptions, requestCount = 0;
const IMPORTER = 'I'.repeat(43); // Synthetic local test bearer, never a real credential.
before(async () => {
  scratch = await mkdtemp(path.join(os.tmpdir(), 'nickrae-consent-miniflare-'));
  runtimeOptions = {
    name: 'nickrae-consent-test', modules: true, scriptPath: path.join(control,
      process.env.PPL_CONSENT_TEST_BUNDLE === '1' ? 'dist/consent-worker.bundle.mjs' : 'worker.mjs'),
    compatibilityDate: '2026-07-30', cf: false,
    bindings: {SERVICE_ENABLED: 'true', IMPORTER_TOKEN_SHA256: sha(IMPORTER)},
    durableObjects: {PPL_LEDGER: {className: 'PplConsentLedger', useSQLite: true}},
    durableObjectsPersist: scratch,
    outboundService: async () => { requestCount++; return new Response('No external network in tests', {status: 503}); }
  };
  mf = new Miniflare(runtimeOptions);
  await mf.ready;
});
after(async () => { if (mf) await mf.dispose(); if (scratch) await rm(scratch, {recursive: true, force: true}); });
const apiUrl = route => 'https://nickrae.net/api/ppl-measurement/v1/' + route;
async function call(route, data, options = {}) {
  const headers = {'Content-Type': 'application/json', ...(options.importer
    ? {Authorization: 'Bearer ' + (options.token || IMPORTER)}
    : {Origin: 'https://nickrae.net', 'Sec-Fetch-Site': 'same-origin'})};
  if (options.capability) headers.Authorization = 'Bearer ' + options.capability;
  Object.assign(headers, options.headers || {});
  const response = await mf.dispatchFetch(options.url || apiUrl(route), {
    method: options.method || 'POST', headers,
    body: ['GET','HEAD'].includes(options.method) ? undefined : (options.body ?? JSON.stringify(data))
  });
  const parsed = await response.json();
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  return {response, parsed};
}
async function runtimeGrant(qa = false) {
  const result = await call('grant', {policy: POLICY, qa}); assert.equal(result.response.status, 201);
  assert.match(result.parsed.receipt_id, /^[A-Za-z0-9_-]{43}$/);
  assert.match(result.parsed.revoke_capability, /^[A-Za-z0-9_-]{43}$/);
  return result.parsed;
}

test('actual workerd SQLite grant/status/revoke roundtrip and private-token authentication', async () => {
  const grant = await runtimeGrant();
  const status = await call('status', {receipt_id: grant.receipt_id}, {importer: true});
  assert.equal(status.parsed.state, 'granted'); assert.equal(status.parsed.revoke_capability, undefined);
  const denied = await call('status', {receipt_id: grant.receipt_id}, {importer: true, token: 'X'.repeat(43)});
  assert.equal(denied.response.status, 401);
  const revoke = await call('revoke', {receipt_id: grant.receipt_id}, {capability: grant.revoke_capability});
  assert.equal(revoke.parsed.state, 'revoked'); assert.ok(revoke.parsed.acknowledged_at);
  const repeated = await call('revoke', {receipt_id: grant.receipt_id}, {capability: grant.revoke_capability});
  assert.equal(repeated.parsed.revision, revoke.parsed.revision);
});
test('actual workerd permits are consumed once and revoke-before-dispatch cancels eligibility', async () => {
  const grant = await runtimeGrant(); const event_key = sha('runtime-revoke-before-dispatch');
  const permit = await call('permit', {receipt_id: grant.receipt_id, event_key}, {importer: true});
  assert.equal(permit.response.status, 201);
  await call('revoke', {receipt_id: grant.receipt_id}, {capability: grant.revoke_capability});
  const blocked = await call('dispatch', {receipt_id: grant.receipt_id, event_key, permit_token: permit.parsed.permit_token}, {importer: true});
  assert.equal(blocked.response.status, 409); assert.equal(blocked.parsed.error, 'consent_revoked');
});
test('actual workerd preserves dispatch/revoke ordering without claiming an atomic Google call', async () => {
  const grant = await runtimeGrant(); const event_key = sha('runtime-dispatch-first');
  const permit = await call('permit', {receipt_id: grant.receipt_id, event_key}, {importer: true});
  const body = {receipt_id: grant.receipt_id, event_key, permit_token: permit.parsed.permit_token};
  const begin = await call('dispatch', body, {importer: true}); assert.equal(begin.parsed.dispatch_state, 'started');
  const replay = await call('dispatch', body, {importer: true}); assert.equal(replay.response.status, 409);
  const revoke = await call('revoke', {receipt_id: grant.receipt_id}, {capability: grant.revoke_capability});
  assert.equal(revoke.parsed.in_flight_may_have_sent, true);
  const result = await call('result', {receipt_id: grant.receipt_id, event_key, outcome: 'unknown'}, {importer: true});
  assert.equal(result.parsed.state, 'revoked'); assert.equal(result.parsed.import_state, 'unknown');
});
test('QA grants exercise service behavior but are always denied permits', async () => {
  const grant = await runtimeGrant(true);
  const blocked = await call('permit', {receipt_id: grant.receipt_id, event_key: sha('qa')}, {importer: true});
  assert.equal(blocked.response.status, 409); assert.equal(blocked.parsed.error, 'qa_receipt');
});
test('browser routes require exact same-origin and GPC forbids grant', async () => {
  for (const headers of [{Origin: 'https://evil.example'}, {'Sec-Fetch-Site': 'cross-site'}, {'Sec-GPC': '1'}]) {
    const result = await call('grant', {policy: POLICY, qa: false}, {headers});
    assert.ok([403,409].includes(result.response.status));
  }
});
test('importer routes reject browser origin/cookies and never accept a revoke capability', async () => {
  const grant = await runtimeGrant();
  for (const headers of [{Origin: 'https://nickrae.net'}, {Cookie: 'example=1'}]) {
    const result = await call('status', {receipt_id: grant.receipt_id}, {importer: true, headers});
    assert.equal(result.response.status, 401);
  }
  const wrongScope = await call('status', {receipt_id: grant.receipt_id}, {importer: true, token: grant.revoke_capability});
  assert.equal(wrongScope.response.status, 401);
});
test('wrong hosts/query/path/method and content types are rejected', async () => {
  for (const url of ['https://evil.example/api/ppl-measurement/v1/grant', apiUrl('grant') + '?gclid=private', apiUrl('grant/extra')]) {
    const result = await call('grant', {policy: POLICY, qa: false}, {url}); assert.equal(result.response.status, 404);
  }
  const method = await call('grant', {}, {method: 'GET'}); assert.equal(method.response.status, 405);
  const type = await call('grant', {policy: POLICY, qa: false}, {headers: {'Content-Type': 'text/plain'}}); assert.equal(type.response.status, 415);
});
test('bodies reject extra sensitive fields, duplicates, escaped names and excessive bytes', async () => {
  const values = [
    JSON.stringify({policy: POLICY, qa: false, gclid: 'not-collected'}),
    JSON.stringify({policy: POLICY, qa: false, email: 'synthetic@example.invalid'}),
    '{"policy":"ppl-ads-v1","qa":false,"qa":true}',
    '{"pol\\u0069cy":"ppl-ads-v1","qa":false}',
    '{"policy":"ppl-ads-v1","qa":{}}', '{not-json}'
  ];
  for (const body of values) {
    const result = await call('grant', {}, {body}); assert.equal(result.response.status, 400);
    assert.equal(JSON.stringify(result.parsed).includes('synthetic'), false);
  }
  const huge = await call('grant', {}, {body: 'x'.repeat(513)}); assert.equal(huge.response.status, 413);
});
test('identifier fields reject arrays,null,numbers and objects instead of regex coercion', async () => {
  const grant = await runtimeGrant();
  const malformed = [null, 123, {}, [grant.receipt_id]];
  for (const receipt_id of malformed) {
    const result = await call('status', {receipt_id}, {importer: true}); assert.equal(result.response.status, 400);
  }
  for (const event_key of [null, 123, {}, [sha('array-event')]]) {
    const result = await call('permit', {receipt_id: grant.receipt_id, event_key}, {importer: true}); assert.equal(result.response.status, 400);
  }
  for (const permit_token of [null, 123, {}, ['P'.repeat(43)]]) {
    const result = await call('dispatch', {receipt_id: grant.receipt_id, event_key: sha('token-array'), permit_token}, {importer: true});
    assert.equal(result.response.status, 400);
  }
});
test('actual SQLite state survives a worker restart with no external request', async () => {
  const grant = await runtimeGrant();
  const withdrawing = await runtimeGrant();
  await mf.setOptions({...runtimeOptions, bindings: {SERVICE_ENABLED: 'false', IMPORTER_TOKEN_SHA256: sha(IMPORTER)}});
  const disabled = await call('status', {receipt_id: grant.receipt_id}, {importer: true});
  assert.equal(disabled.response.status, 503);
  const allowedRevoke = await call('revoke', {receipt_id: withdrawing.receipt_id}, {capability: withdrawing.revoke_capability});
  assert.equal(allowedRevoke.parsed.state, 'revoked');
  await mf.setOptions(runtimeOptions);
  await mf.dispose();
  mf = new Miniflare(runtimeOptions);
  await mf.ready;
  const status = await call('status', {receipt_id: grant.receipt_id}, {importer: true});
  assert.equal(status.parsed.state, 'granted'); assert.equal(requestCount, 0);
  const revoked = await call('status', {receipt_id: withdrawing.receipt_id}, {importer: true});
  assert.equal(revoked.parsed.state, 'revoked');
});
test('deployment defaults expose no workers.dev/preview/route and contain no actual secrets', async () => {
  const config = JSON.parse(await readFile(path.join(control, 'wrangler.jsonc'), 'utf8'));
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false); assert.deepEqual(config.routes, []);
  assert.equal(config.observability.enabled, false); assert.equal(config.vars.SERVICE_ENABLED, 'false');
  assert.equal(config.IMPORTER_TOKEN_SHA256, undefined);
  assert.deepEqual(config.migrations[0].new_sqlite_classes, ['PplConsentLedger']);
  const source = await readFile(path.join(control, 'worker.mjs'), 'utf8');
  assert.deepEqual(Array.from(source.matchAll(/^export (?:class|(?:async )?function) ([A-Za-z0-9_]+)/gm), match => match[1]), ['PplConsentLedger']);
});
