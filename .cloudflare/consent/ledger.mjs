// No provider credentials or conversion data belong in this service.
export const POLICY = 'ppl-ads-v1';
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const PERMIT_MS = 15_000;
export const MAX_DAILY_GRANTS = 1000;
export const MAX_DAILY_PUBLIC_REQUESTS = 20_000;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const EVENT_PATTERN = /^[a-f0-9]{64}$/;

export class LedgerError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}

const fail = (code, status) => { throw new LedgerError(code, status); };
const iso = value => value == null ? null : new Date(value).toISOString();
const rows = (sql, statement, ...args) => Array.from(sql.exec(statement, ...args));
const first = (sql, statement, ...args) => rows(sql, statement, ...args)[0];

export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

export class ConsentLedger {
  constructor(sql) {
    this.sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS receipts (
      receipt_id TEXT PRIMARY KEY,
      revoke_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('granted','revoked')),
      policy TEXT NOT NULL,
      qa INTEGER NOT NULL CHECK(qa IN (0,1)),
      granted_ms INTEGER NOT NULL,
      expires_ms INTEGER NOT NULL,
      revoked_ms INTEGER,
      revision INTEGER NOT NULL,
      event_key TEXT UNIQUE,
      import_state TEXT NOT NULL DEFAULT 'none'
        CHECK(import_state IN ('none','prepared','dispatch_started','accepted','rejected','unknown')),
      permit_hash TEXT,
      permit_until_ms INTEGER,
      permit_revision INTEGER,
      dispatch_ms INTEGER,
      result_ms INTEGER
    )`);
    sql.exec('CREATE INDEX IF NOT EXISTS receipt_expiry ON receipts(expires_ms)');
    sql.exec(`CREATE TABLE IF NOT EXISTS daily_limits (
      day INTEGER PRIMARY KEY, public_requests INTEGER NOT NULL, grants INTEGER NOT NULL
    )`);
  }

  // The Durable Object calls every public operation inside transactionSync.
  // The tests use a real SQLite transaction, including rollback on rejection.
  spendPublicBudget(now, grant = false, authenticatedRevoke = false) {
    const day = Math.floor(now / 86_400_000);
    const counts = first(this.sql, 'SELECT * FROM daily_limits WHERE day=?', day)
      || {public_requests: 0, grants: 0};
    if ((!authenticatedRevoke && counts.public_requests >= MAX_DAILY_PUBLIC_REQUESTS)
      || (grant && counts.grants >= MAX_DAILY_GRANTS)) fail('daily_limit', 429);
    this.sql.exec(`INSERT INTO daily_limits(day,public_requests,grants) VALUES(?,?,?)
      ON CONFLICT(day) DO UPDATE SET public_requests=excluded.public_requests,grants=excluded.grants`,
    day, counts.public_requests + 1, counts.grants + (grant ? 1 : 0));
  }

  grant({receiptId, revokeHash, qa}, now) {
    this.spendPublicBudget(now, true);
    if (first(this.sql, 'SELECT receipt_id FROM receipts WHERE receipt_id=?', receiptId)) fail('identifier_collision', 503);
    this.sql.exec(`INSERT INTO receipts(receipt_id,revoke_hash,state,policy,qa,granted_ms,expires_ms,revision)
      VALUES(?,?,'granted',?,?,?,?,1)`, receiptId, revokeHash, POLICY, qa ? 1 : 0, now, now + RETENTION_MS);
    return this.snapshot(receiptId, now);
  }

  get(receiptId) {
    const row = first(this.sql, 'SELECT * FROM receipts WHERE receipt_id=?', receiptId);
    if (!row) fail('unknown_receipt', 404);
    return row;
  }

  snapshot(receiptId, now) {
    const row = this.get(receiptId);
    return {
      receipt_id: row.receipt_id,
      policy: row.policy,
      qa: row.qa === 1,
      state: now >= row.expires_ms ? 'expired' : row.state,
      granted_at: iso(row.granted_ms),
      expires_at: iso(row.expires_ms),
      revoked_at: iso(row.revoked_ms),
      revision: row.revision,
      import_state: row.import_state,
      dispatch_started_at: iso(row.dispatch_ms),
      result_recorded_at: iso(row.result_ms),
      in_flight_may_have_sent: ['dispatch_started', 'unknown'].includes(row.import_state),
      already_accepted: row.import_state === 'accepted',
      server_time: iso(now)
    };
  }

  revoke({receiptId, capabilityHash}, now) {
    const row = first(this.sql, 'SELECT * FROM receipts WHERE receipt_id=?', receiptId);
    const authorized = row && constantTimeEqual(capabilityHash, row.revoke_hash);
    // An anonymous grant/invalid-request cap must not lock out an existing
    // holder's valid withdrawal. Platform outages/quotas can still fail and the
    // browser must retain its pending outbox until acknowledgement.
    this.spendPublicBudget(now, false, !!authorized);
    // Cleanup deliberately removes old capability hashes. An absent row cannot
    // authorize an import, so acknowledge current absence rather than leaving
    // an expired browser outbox pending forever. This does not establish that a
    // prior revocation succeeded or recall any earlier external dispatch. IDs
    // are generated afresh, never accepted from grant callers; rollback must
    // preserve current history and must never restore an older ledger snapshot.
    if (!row) return {receipt_id: receiptId, state: 'absent',
      acknowledged_at: iso(now), server_time: iso(now)};
    if (!authorized) fail('unknown_receipt', 404);
    if (row.state !== 'revoked') {
      this.sql.exec(`UPDATE receipts SET state='revoked',revoked_ms=?,revision=revision+1,
        permit_hash=NULL,permit_until_ms=NULL,permit_revision=NULL WHERE receipt_id=?`, now, receiptId);
    }
    return {...this.snapshot(receiptId, now), acknowledged_at: iso(now)};
  }

  eligible(row, now) {
    if (now < row.granted_ms) fail('clock_anomaly');
    if (row.state !== 'granted') fail('consent_revoked');
    if (now >= row.expires_ms) fail('consent_expired');
    if (row.qa === 1) fail('qa_receipt');
    if (row.policy !== POLICY) fail('policy_mismatch');
  }

  prepare({receiptId, eventKey, permitHash}, now) {
    const row = this.get(receiptId);
    this.eligible(row, now);
    const existing = first(this.sql, 'SELECT receipt_id FROM receipts WHERE event_key=?', eventKey);
    if (existing && existing.receipt_id !== receiptId) fail('event_already_bound');
    if (row.event_key && row.event_key !== eventKey) fail('receipt_already_bound');
    if (['dispatch_started','accepted','rejected','unknown'].includes(row.import_state)) fail('event_already_dispatched');
    if (row.import_state === 'prepared' && row.permit_until_ms > now) fail('permit_outstanding');
    const until = Math.min(now + PERMIT_MS, row.expires_ms);
    this.sql.exec(`UPDATE receipts SET event_key=?,import_state='prepared',permit_hash=?,
      permit_until_ms=?,permit_revision=? WHERE receipt_id=?`, eventKey, permitHash, until, row.revision, receiptId);
    return {receipt_id: receiptId, receipt_revision: row.revision,
      permit_expires_at: iso(until), server_time: iso(now)};
  }

  dispatch({receiptId, eventKey, permitHash}, now) {
    const row = this.get(receiptId);
    this.eligible(row, now);
    if (row.import_state !== 'prepared' || row.event_key !== eventKey
      || !constantTimeEqual(row.permit_hash, permitHash)) fail('invalid_permit');
    if (row.permit_revision !== row.revision) fail('stale_permit');
    if (now >= row.permit_until_ms) fail('permit_expired');
    this.sql.exec(`UPDATE receipts SET import_state='dispatch_started',dispatch_ms=?,
      permit_hash=NULL,permit_until_ms=NULL,permit_revision=NULL WHERE receipt_id=?`, now, receiptId);
    return {receipt_id: receiptId, receipt_revision: row.revision,
      dispatch_state: 'started', dispatch_started_at: iso(now), server_time: iso(now)};
  }

  result({receiptId, eventKey, outcome}, now) {
    const row = this.get(receiptId);
    if (row.event_key !== eventKey || row.dispatch_ms == null) fail('dispatch_not_started');
    if (now < row.dispatch_ms) fail('clock_anomaly');
    // A lost acknowledgement is not a reason to issue another permit. A trusted
    // importer may later reconcile unknown -> one definite provider result.
    if (['accepted','rejected'].includes(row.import_state) && row.import_state !== outcome) fail('result_conflict');
    if (row.import_state === outcome) return this.snapshot(receiptId, now);
    if (!['dispatch_started','unknown'].includes(row.import_state)) fail('result_conflict');
    this.sql.exec('UPDATE receipts SET import_state=?,result_ms=? WHERE receipt_id=?', outcome, now, receiptId);
    return this.snapshot(receiptId, now);
  }

  cleanup(now) {
    this.sql.exec('DELETE FROM receipts WHERE expires_ms<=?', now);
    this.sql.exec('DELETE FROM daily_limits WHERE day<?', Math.floor(now / 86_400_000) - 2);
  }
}

export function validObject(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every(key => keys.includes(key));
}

export async function digest(value) {
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(result, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function token() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
