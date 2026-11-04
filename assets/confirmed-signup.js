/* First-party consent receipts for confirmed PPL signup measurement.
 * No email reads, click-ID storage, Google calls, or submission interception.
 */
((root) => {
  'use strict';
  const STORE_KEY = 'nickrae_ppl_measurement_receipts_v1';
  const REVOKE_KEY = 'nickrae_ppl_measurement_withdrawal_v1';
  const POLICY = 'ppl-ads-v1';
  const CAMPAIGN = 'google/cpc/free_ppl_cards/ppl_search_v1';
  const BASE = '/api/ppl-measurement/v1';
  const TOKEN = /^[A-Za-z0-9_-]{43}$/;
  const CLICK = /^[A-Za-z0-9._~-]{10,512}$/;
  const ROLES = ['gclid', 'receipt', 'submitted_at', 'campaign'];
  const MAX_LIFETIME = 30 * 24 * 60 * 60 * 1000;

  function create(options) {
    const win = options.window || root;
    const doc = options.document || win.document;
    const config = options.config || {};
    // Only the temporary noindex harness opts in. Its request remains QA=true
    // regardless of URL values and can never create an importable receipt.
    const qaMode = config.qa_harness === true;
    const storeKey = qaMode ? 'nickrae_ppl_measurement_qa_receipts_v1' : STORE_KEY;
    const revokeKey = qaMode ? 'nickrae_ppl_measurement_qa_withdrawal_v1' : REVOKE_KEY;
    const pendingPrefix = storeKey + ':pending:';
    const choiceKey = qaMode ? 'nickrae_ppl_measurement_qa_choice_v1' : 'nickrae_analytics_consent_v1';
    const consent = options.currentConsent;
    const gpc = options.globalPrivacyControl;
    const now = () => Date.now();
    const notify = (state) => { try { options.onStatus?.(state); } catch (_) {} };
    const production = win.location.protocol === 'https:' && win.location.hostname === 'nickrae.net'
      && !win.location.port;
    const mapping = config.fields;
    const mappingValid = config.enabled === true && /^[a-f0-9]{64}$/.test(config.mapping_sha256 || '')
      && mapping && ROLES.every((role) => typeof mapping[role]?.api_key === 'string'
        && /^[a-z][a-z0-9_]{0,79}$/.test(mapping[role].api_key)
        && typeof mapping[role]?.input_name === 'string'
        && /^fields\[[a-z][a-z0-9_]{0,79}\]$/.test(mapping[role].input_name)
        && mapping[role].input_name === `fields[${mapping[role].api_key}]`)
      && new Set(ROLES.map((role) => mapping[role].input_name)).size === ROLES.length
      && new Set(ROLES.map((role) => mapping[role].api_key)).size === ROLES.length;
    let records = [];
    let storageSafe = true;
    let current = null;
    let click = null;
    let generation = 0;
    let granting = null;
    let state = 'off';
    const setStatus = (value) => { state = value; notify(value); };

    function privacyAllows() { return consent() === 'allow' && !gpc(); }
    function durableChoiceAllows() {
      try { return win.localStorage.getItem(choiceKey) === 'allow'; }
      catch (_) { storageSafe = false; return false; }
    }
    function localTimeAllows(record) {
      // A suspect client clock disables collection; it never erases a capability.
      return Date.parse(record.granted_at) <= now() + 5 * 60 * 1000 && Date.parse(record.expires_at) > now();
    }
    function withdrawalPending() {
      try { return win.localStorage.getItem(revokeKey) === '1'; }
      catch (_) { storageSafe = false; return true; }
    }
    function markWithdrawal() {
      try {
        win.localStorage.setItem(revokeKey, '1');
        if (win.localStorage.getItem(revokeKey) !== '1') throw new Error();
      } catch (_) { storageSafe = false; }
    }
    function withLock(operation) {
      // Cross-tab serialization prevents one grant from losing another tab's
      // revocation capability. Unsupported browsers keep ordinary signup only.
      if (typeof win.navigator?.locks?.request !== 'function') {
        setStatus('unavailable'); return Promise.resolve(false);
      }
      return win.navigator.locks.request(storeKey, {mode:'exclusive'}, async () => {
        load();
        if (withdrawalPending()) records.forEach((record) => { record.local_state = 'pending'; });
        const clockUnsafe = records.filter((record) => record.local_state === 'active' && !localTimeAllows(record));
        if (clockUnsafe.length) { storageSafe = false; retainPending(clockUnsafe); }
        return operation();
      });
    }
    function eligibleClick() {
      if (!production || !mappingValid || !privacyAllows() || typeof win.navigator?.locks?.request !== 'function') return null;
      const query = new URLSearchParams(win.location.search);
      if (qaMode) {
        if (win.location.pathname !== '/ppl-measurement-qa/' || query.getAll('analytics_test').length !== 1
          || query.get('analytics_test') !== '1' || [...query.keys()].some((key) => key !== 'analytics_test')) return null;
        return 'QA_SYNTHETIC_NO_GOOGLE_MATCH_20261104';
      }
      if (!/^\/aviation-workbooks\/private-pilot\/(?:index\.html)?$/.test(win.location.pathname)) return null;
      if (query.has('analytics_test')) return null;
      const exact = {utm_source:'google', utm_medium:'cpc', utm_campaign:'free_ppl_cards', utm_content:'ppl_search_v1'};
      if (!Object.entries(exact).every(([key, value]) => query.getAll(key).length === 1 && query.get(key) === value)
        || query.getAll('gclid').length !== 1 || !CLICK.test(query.get('gclid') || '')) return null;
      return query.get('gclid'); // Case-sensitive, opaque identifier; memory only.
    }
    function safeRecord(value) {
      if (!value || typeof value.receipt_id !== 'string' || typeof value.revoke_capability !== 'string'
        || !TOKEN.test(value.receipt_id) || !TOKEN.test(value.revoke_capability)
        || typeof value.granted_at !== 'string' || typeof value.expires_at !== 'string'
        || value.policy !== POLICY || typeof value.qa !== 'boolean' || !['active', 'pending'].includes(value.local_state)) return null;
      const granted = Date.parse(value.granted_at), expiry = Date.parse(value.expires_at);
      if (!Number.isFinite(granted) || !Number.isFinite(expiry) || expiry <= granted
        || expiry - granted > MAX_LIFETIME) return null;
      return {receipt_id:value.receipt_id, revoke_capability:value.revoke_capability, policy:POLICY,
        qa:value.qa, granted_at:new Date(granted).toISOString(), expires_at:new Date(expiry).toISOString(), local_state:value.local_state};
    }
    function retainPending(values = records) {
      values.forEach((record) => {
        record.local_state = 'pending';
        try {
          const key = pendingPrefix + record.receipt_id, value = JSON.stringify(record);
          win.localStorage.setItem(key, value);
          if (win.localStorage.getItem(key) !== value) throw new Error();
        } catch (_) { storageSafe = false; setStatus('withdrawal-pending'); }
      });
    }
    function load() {
      const known = records.slice();
      try {
        const text = win.localStorage.getItem(storeKey);
        if (text && text.length > 64000) throw new Error();
        const data = text ? JSON.parse(text) : {version:1, receipts:[]};
        if (data.version !== 1 || !Array.isArray(data.receipts) || data.receipts.length > 100) throw new Error();
        const parsed = data.receipts.map(safeRecord);
        if (parsed.some((value) => !value) || new Set(parsed.map((value) => value.receipt_id)).size !== parsed.length) throw new Error();
        // Independent outbox entries survive a cleared/stale collection key and
        // can be written synchronously before a privacy-triggered reload.
        const storage = win.localStorage;
        if (typeof storage.key !== 'function' || !Number.isSafeInteger(storage.length) || storage.length > 500) throw new Error();
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (typeof key !== 'string' || !key.startsWith(pendingPrefix)) continue;
          const pending = safeRecord(JSON.parse(storage.getItem(key)));
          if (!pending || pending.local_state !== 'pending' || key !== pendingPrefix + pending.receipt_id) throw new Error();
          const at = parsed.findIndex((record) => record.receipt_id === pending.receipt_id);
          if (at >= 0 && parsed[at].revoke_capability !== pending.revoke_capability) throw new Error();
          if (at >= 0) parsed[at] = pending; else parsed.push(pending);
        }
        const merged = new Map(parsed.map((record) => [record.receipt_id, record]));
        for (const record of known) {
          const stored = merged.get(record.receipt_id);
          if (!stored || stored.revoke_capability !== record.revoke_capability) {
            retainPending([record]); merged.set(record.receipt_id, record);
          } else if (record.local_state === 'pending') merged.set(record.receipt_id, record);
        }
        records = [...merged.values()];
      } catch (_) {
        records = known; storageSafe = false;
        retainPending(known); setStatus(known.length ? 'withdrawal-pending' : 'unavailable');
      }
    }
    function persist() {
      try {
        const value = JSON.stringify({version:1, receipts:records});
        win.localStorage.setItem(storeKey, value);
        // A silent storage failure must not make an unrevocable association.
        if (win.localStorage.getItem(storeKey) !== value) throw new Error();
        return true;
      } catch (_) { storageSafe = false; return false; }
    }
    async function request(path, body, capability, keepalive = false) {
      if (!production || typeof win.fetch !== 'function') throw new Error('Unavailable');
      const controller = typeof win.AbortController === 'function' ? new win.AbortController() : null;
      const timeout = controller ? win.setTimeout(() => controller.abort(), 4000) : null;
      try {
        const response = await win.fetch(BASE + path, {
          // Fetch's append-a-request-origin-header algorithm turns Origin into
          // null for same-origin mode + no-referrer. cors keeps the real Origin
          // on this fixed first-party POST without exposing the landing query.
          // https://fetch.spec.whatwg.org/#append-a-request-origin-header
          method:'POST', mode:'cors', credentials:'omit', cache:'no-store', redirect:'error',
          referrerPolicy:'no-referrer', keepalive,
          headers:{'Content-Type':'application/json', ...(capability ? {Authorization:`Bearer ${capability}`} : {})},
          body:JSON.stringify(body), ...(controller ? {signal:controller.signal} : {})
        });
        if (!response.ok || ![200, 201].includes(response.status)) throw new Error('Unavailable');
        const text = await response.text();
        if (text.length > 8192) throw new Error('Unavailable');
        return JSON.parse(text);
      } finally { if (timeout !== null) win.clearTimeout(timeout); }
    }
    function clearFields() {
      doc.querySelectorAll('input[data-nickrae-confirmed-field]').forEach((input) => input.remove());
    }
    function selectCurrent() {
      current = records.filter((record) => record.local_state === 'active'
        && record.qa === qaMode && localTimeAllows(record)).at(-1) || null;
    }
    async function flushPendingLocked() {
        const pending = records.filter((record) => record.local_state === 'pending');
        if (pending.length) { retainPending(pending); persist(); }
        for (const record of pending) {
          try {
            const result = await request('/revoke', {receipt_id:record.receipt_id}, record.revoke_capability, true);
            const serverTime = typeof result.server_time === 'string' ? Date.parse(result.server_time) : NaN;
            const acknowledged = typeof result.acknowledged_at === 'string' ? Date.parse(result.acknowledged_at) : NaN;
            // absent acknowledges no current server authorization after cleanup;
            // it does not claim an earlier withdrawal was received.
            const terminal = result.state === 'revoked' || result.state === 'absent' || (result.state === 'expired'
              && typeof result.expires_at === 'string' && typeof result.server_time === 'string'
              && Date.parse(result.expires_at) === Date.parse(record.expires_at)
              && serverTime >= Date.parse(result.expires_at));
            if (result.receipt_id !== record.receipt_id || !terminal
              || !Number.isFinite(serverTime) || !Number.isFinite(acknowledged) || acknowledged > serverTime) throw new Error();
            win.localStorage.removeItem(pendingPrefix + record.receipt_id);
            if (win.localStorage.getItem(pendingPrefix + record.receipt_id) !== null) throw new Error();
            records = records.filter((value) => value.receipt_id !== record.receipt_id);
            // Keeping a revoked record when deletion fails is safe: it retries.
            persist();
          } catch (_) { setStatus('withdrawal-pending'); return false; }
        }
        if (pending.length) setStatus('withdrawal-saved');
        return true;
    }
    function flushPending() {
      return withLock(flushPendingLocked).catch(() => { setStatus('withdrawal-pending'); return false; });
    }
    function withdraw(explicit = false) {
      generation += 1;
      current = null;
      click = null;
      clearFields();
      // A separate synchronous marker cannot overwrite another tab's receipt.
      // Every locked writer drains all stored capabilities before any regrant.
      const globalWithdrawal = explicit || gpc() || !durableChoiceAllows();
      if (globalWithdrawal) { markWithdrawal(); retainPending(records); }
      setStatus(records.length || granting ? 'withdrawal-pending' : 'off');
      return withLock(async () => {
        // A stale page may retain a local denied override after another tab's
        // newer explicit Allow. It stays off, but must not revoke that new grant.
        if (!explicit && !gpc() && durableChoiceAllows()) return flushPendingLocked();
        if (records.length) markWithdrawal();
        records.forEach((record) => { record.local_state = 'pending'; });
        return flushPendingLocked();
      }).catch(() => { setStatus('withdrawal-pending'); return false; });
    }
    async function grantFromChoice() {
      const candidate = eligibleClick();
      if (!candidate || !storageSafe) return false;
      if (granting) return granting;
      const revision = generation;
      granting = withLock(async () => {
        if (!await flushPendingLocked() || revision !== generation || !eligibleClick() || !storageSafe) return false;
        try {
          win.localStorage.removeItem(revokeKey);
          if (win.localStorage.getItem(revokeKey) !== null) throw new Error();
        } catch (_) { storageSafe = false; setStatus('unavailable'); return false; }
        if (records.length >= 20) { setStatus('unavailable'); return false; }
        try {
          setStatus('saving');
          const response = await request('/grant', {policy:POLICY, qa:qaMode});
          if (response.state !== 'granted' || response.qa !== qaMode || response.policy !== POLICY) throw new Error();
          const record = safeRecord({...response, local_state:'active'});
          if (!record) throw new Error();
          // Even a grant response received after withdrawal must be revoked.
          if (revision !== generation || !eligibleClick() || withdrawalPending()) record.local_state = 'pending';
          records.push(record);
          if (!localTimeAllows(record)) { storageSafe = false; record.local_state = 'pending'; }
          if (!persist()) {
            record.local_state = 'pending';
            await flushPendingLocked();
            current = null; click = null; setStatus('unavailable'); return false;
          }
          if (record.local_state === 'pending') { await flushPendingLocked(); return false; }
          current = record; click = candidate; setStatus('ready'); return true;
        } catch (_) { current = null; click = null; setStatus('unavailable'); return false; }
      }).catch(() => { current = null; click = null; setStatus('unavailable'); return false; });
      try { return await granting; } finally { granting = null; }
    }
    function refresh() {
      if (!privacyAllows()) { void withdraw(); return; }
      void flushPending().then(() => {
        if (!privacyAllows()) return;
        selectCurrent();
        const candidate = eligibleClick();
        if (candidate && current && storageSafe && !withdrawalPending()
          && !records.some((record) => record.local_state === 'pending')) {
          click = candidate; setStatus('ready');
        }
      });
      selectCurrent();
      const candidate = eligibleClick();
      if (!candidate) { click = null; clearFields(); return; }
      if (current && !withdrawalPending() && !records.some((record) => record.local_state === 'pending') && storageSafe) {
        click = candidate; setStatus('ready');
      } else {
        click = null;
        if (state !== 'withdrawal-pending' && state !== 'saving') {
          setStatus('choice-needed');
          try { options.onChoiceNeeded?.(); } catch (_) {}
        }
      }
    }
    function submit(event) {
      const form = event.target;
      if (!form?.matches?.('form[data-uid="899d974875"][data-sv-form="10042240"]')) return;
      try {
        form.querySelectorAll('input[data-nickrae-confirmed-field]').forEach((input) => input.remove());
        const action = new URL(form.action, win.location.href);
        if (form.method.toLowerCase() !== 'post' || action.origin !== 'https://app.kit.com'
          || action.pathname !== '/forms/10042240/subscriptions') return;
        if (!privacyAllows()) { void withdraw(); return; }
        const candidate = eligibleClick();
        load();
        const stored = current && records.find((record) => record.receipt_id === current.receipt_id);
        if (!candidate || candidate !== click || !current || !storageSafe
          || !stored || stored.local_state !== 'active' || withdrawalPending() || Date.parse(current.expires_at) <= now()
          || records.some((record) => record.local_state === 'pending')) return;
        // Never take over a vendor field or overwrite another feature's value.
        if (ROLES.some((role) => form.querySelectorAll(`input[name="${mapping[role].input_name}"]`).length)) return;
        const values = {gclid:click, receipt:current.receipt_id, submitted_at:new Date(now()).toISOString(), campaign:CAMPAIGN};
        ROLES.forEach((role) => {
          const input = doc.createElement('input');
          input.type = 'hidden'; input.name = mapping[role].input_name; input.value = values[role];
          input.dataset.nickraeConfirmedField = role; form.appendChild(input);
        });
      } catch (_) { /* Optional matching must never block a normal signup. */ }
    }
    function start() {
      if (!production) return;
      load();
      doc.addEventListener('submit', submit, true);
      ['focus', 'pageshow', 'online'].forEach((name) => win.addEventListener(name, refresh));
      doc.addEventListener('visibilitychange', refresh);
      // GPC can change while a document stays open; recheck before each gesture.
      ['pointerdown', 'keydown'].forEach((name) => doc.addEventListener(name, () => { if (gpc()) void withdraw(); }, true));
      win.addEventListener('storage', (event) => {
        if (![storeKey, revokeKey, 'nickrae_analytics_consent_v1', null].includes(event.key)) return;
        if (event.key === null || ((event.key === storeKey || event.key === revokeKey) && event.newValue === null)) {
          retainPending(records);
        }
        current = null; click = null; clearFields(); load(); refresh();
      });
      refresh();
    }
    return Object.freeze({start,
      choice(value, explicit = false) {
        if (value !== 'allow' || gpc()) return withdraw(explicit);
        if (explicit) return grantFromChoice();
        refresh(); return Promise.resolve(false);
      },
      status:() => state
    });
  }
  root.NickRaeConfirmedSignup = Object.freeze({create});
})(window);
