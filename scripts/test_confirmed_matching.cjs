// Actual browser module with synthetic DOM/network/storage; no live requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const modulePath = path.join(__dirname, '../assets/confirmed-signup.js');
const source = fs.readFileSync(modulePath, 'utf8');
const fieldMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ppl-matching-fields.json'), 'utf8'));
const STORE = 'nickrae_ppl_measurement_receipts_v1';
const REVOKE = 'nickrae_ppl_measurement_withdrawal_v1';
const CAMPAIGN = 'google/cpc/free_ppl_cards/ppl_search_v1';
const QUERY = 'utm_source=google&utm_medium=cpc&utm_campaign=free_ppl_cards&utm_content=ppl_search_v1';
const CLICK = 'Case_Sensitive-Gclid_QA0001';
const BASE = '/api/ppl-measurement/v1';
const results = [];
const siteSource = fs.readFileSync(path.join(__dirname,'../assets/site.js'),'utf8');
const siteConfigExpression = siteSource.match(/const PPL_MATCHING_CONFIG = Object\.freeze\(([\s\S]*?)\n  \}\);/);
assert(siteConfigExpression,'Expected one explicit website matching configuration');
const config = vm.runInNewContext('('+siteConfigExpression[1]+'\n})');
const plain = (value) => JSON.parse(JSON.stringify(value));
class Events {
  constructor() { this.listeners = {}; }
  addEventListener(type, fn, capture = false) { (this.listeners[type] ||= []).push({fn,capture}); }
  dispatch(type, target = this, extra = {}) {
    const event = {type,target,...extra};
    for (const entry of this.listeners[type] || []) entry.fn(event);
  }
}
function lockManager() {
  let tail = Promise.resolve();
  return {request(name, options, operation) {
    const result = tail.then(operation); tail = result.catch(() => {}); return result;
  }};
}
function server() {
  let serial = 0;
  const requests = [], records = new Map();
  const token = (prefix) => prefix + String(++serial).padStart(42, '0');
  const api = {
    requests, records, fail:false, grantGate:null, grantOverride:null,
    async fetch(url, options) {
      const body = JSON.parse(options.body);
      requests.push({url, options:{...options, body}});
      if (api.fail) throw Error('Synthetic network failure');
      if (url === BASE+'/grant') {
        if (api.grantGate) await api.grantGate;
        const receipt_id=token('R'), revoke_capability=token('C');
        const result={receipt_id,revoke_capability,policy:'ppl-ads-v1',qa:body.qa,state:'granted',revision:1,
          granted_at:'2026-11-04T20:00:00.000Z',expires_at:'2026-12-04T20:00:00.000Z',...api.grantOverride};
        records.set(receipt_id,{...result});
        return response(201,result);
      }
      if (url === BASE+'/revoke') {
        const record=records.get(body.receipt_id);
        if (!record || options.headers.Authorization !== 'Bearer '+record.revoke_capability) return response(403,{});
        record.state='revoked';
        return response(200,{receipt_id:record.receipt_id,state:'revoked',revision:2,
          acknowledged_at:'2026-11-04T20:00:01.000Z',in_flight_may_have_sent:false});
      }
      throw Error('Unexpected endpoint');
    }
  };
  return api;
}
function response(status,data) { return {ok:status>=200&&status<300,status,async text() {return JSON.stringify(data);}}; }
function environment({choice='allow',gpc=false,origin='https://nickrae.net',search='?'+QUERY+'&gclid='+CLICK,
  config:cfg=config,store=new Map(),locks=lockManager(),api=server()}={}) {
  let clock=Date.parse('2026-11-04T20:00:00.000Z');
  const choiceState={value:choice}, notices=[], statuses=[];
  const document=new Events(), window=new Events(), inputs=[];
  Object.assign(document,{
    createElement(tag) {
      assert.equal(tag,'input');
      const input={dataset:{},remove() { const i=inputs.indexOf(input); if(i>=0) inputs.splice(i,1); }};
      return input;
    },
    querySelectorAll(selector) { return selector==='input[data-nickrae-confirmed-field]'?inputs.filter(i=>i.dataset.nickraeConfirmedField):[]; }
  });
  const form={method:'POST',action:'https://app.kit.com/forms/10042240/subscriptions',
    matches:selector=>selector==='form[data-uid="899d974875"][data-sv-form="10042240"]',
    querySelectorAll(selector) {
      if(selector==='input[data-nickrae-confirmed-field]') return inputs.filter(i=>i.dataset.nickraeConfirmedField);
      const name=selector.match(/^input\[name="(.*)"\]$/)?.[1];
      return inputs.filter(i=>i.name===name);
    },appendChild(input) {inputs.push(input);}
  };
  Object.defineProperty(form,'email',{get() {throw Error('Email must not be read');}});
  Object.assign(window,{document,location:new URL(origin+'/aviation-workbooks/private-pilot/'+search),
    navigator:{globalPrivacyControl:gpc, ...(locks?{locks}:{})},
    localStorage:{getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},
    fetch:api.fetch,setTimeout,clearTimeout});
  class FakeDate extends Date { static now() {return clock;} }
  vm.runInNewContext(source,{window,URL,URLSearchParams,Date:FakeDate,Set,JSON,Object,Promise},{filename:modulePath});
  const client=window.NickRaeConfirmedSignup.create({window,document,config:cfg,
    currentConsent:()=>choiceState.value,globalPrivacyControl:()=>window.navigator.globalPrivacyControl===true,
    onStatus:value=>statuses.push(value),onChoiceNeeded:()=>notices.push('fresh-choice')});
  const submit=()=>{document.dispatch('submit',form);return Object.fromEntries(inputs.map(i=>[i.name,i.value]));};
  const start=()=>client.start();
  return {window,document,form,inputs,client,store,choiceState,statuses,notices,api,start,submit,
    setClock:value=>{clock=Date.parse(value);}};
}
const tick=async()=>{for(let i=0;i<12;i++) await Promise.resolve();};
async function test(name,fn) { await fn(); results.push(name); }
(async()=>{
  await test('Published mapping manifest matches exact native optional field names and website config',async()=>{
    assert.equal(fieldMap.published_readback_verified,true);assert.equal(fieldMap.form_id,'10042240');
    assert.equal(fieldMap.form_uid,'899d974875');assert.equal(config.mapping_sha256,fieldMap.html_sha256);
    for(const [role,field] of Object.entries(fieldMap.fields)) {
      assert.equal(field.required,false);assert.equal(field.input_type,'text');
      assert.equal(config.fields[role].input_name,field.input_name);assert.equal(config.fields[role].api_key,field.api_key);
    }
  });
  await test('An old allow requests a fresh policy choice and sends no grant or field without it',async()=>{
    const e=environment();e.start();await tick();assert.equal(e.api.requests.length,0);
    assert.equal(e.notices.length,1);assert.deepEqual(e.submit(),{});assert.equal(e.store.has(STORE),false);
  });
  await test('A fresh acknowledged allow inserts exactly four fields before SDK FormData, never email or capability',async()=>{
    const e=environment();e.start();assert.equal(await e.client.choice('allow',true),true);
    const data=e.submit(), saved=JSON.parse(e.store.get(STORE));
    assert.equal(Object.keys(data).length,4);assert.equal(data['fields[nr_ads_gclid]'],CLICK);
    assert.equal(data['fields[nr_ads_campaign]'],CAMPAIGN);assert.equal(data['fields[nr_ads_submitted_at]'],'2026-11-04T20:00:00.000Z');
    assert.equal(data['fields[nr_ads_receipt]'],saved.receipts[0].receipt_id);
    assert(!JSON.stringify(data).includes(saved.receipts[0].revoke_capability));
    assert(!e.store.get(STORE).includes(CLICK));assert(!e.store.get(STORE).includes('gclid'));
    const req=e.api.requests[0];assert.deepEqual(plain(req.options.body),{policy:'ppl-ads-v1',qa:false});
    assert.equal(req.options.credentials,'omit');assert.equal(req.options.referrerPolicy,'no-referrer');assert.equal(req.options.redirect,'error');
  });
  await test('Native canceled attempts refresh their own fields once and leave unrelated vendor values intact',async()=>{
    const e=environment();e.inputs.push({name:'vendor',value:'unchanged',dataset:{}});e.start();await e.client.choice('allow',true);
    e.submit();e.setClock('2026-11-04T20:00:10Z');const data=e.submit();
    assert.equal(e.inputs.length,5);assert.equal(data.vendor,'unchanged');assert.equal(data['fields[nr_ads_submitted_at]'],'2026-11-04T20:00:10.000Z');
  });
  await test('Existing vendor input collision disables all optional additions rather than overwriting',async()=>{
    const e=environment();e.inputs.push({name:'fields[nr_ads_receipt]',value:'vendor-choice',dataset:{}});e.start();await e.client.choice('allow',true);
    assert.deepEqual(e.submit(),{'fields[nr_ads_receipt]':'vendor-choice'});
  });
  await test('Consent, GPC, QA, origin, path, unsupported locks and invalid mapping fail closed without blocking signup',async()=>{
    const contexts=[{choice:null},{choice:'deny'},{gpc:true},{origin:'http://nickrae.net'},
      {origin:'https://www.nickrae.net'},{origin:'https://nickrae-preview.pages.dev'},
      ...['1','0',''].map(v=>({search:'?'+QUERY+'&gclid='+CLICK+'&analytics_test='+v})),
      {locks:null},{config:{...config,enabled:false}},{config:{...config,mapping_sha256:''}},
      {config:{...config,fields:{...config.fields,receipt:config.fields.gclid}}}];
    for(const context of contexts) {const e=environment(context);e.start();await e.client.choice('allow',true);assert.deepEqual(e.submit(),{});assert.equal(e.api.requests.filter(r=>r.url.endsWith('/grant')).length,0);}
    const e=environment();e.window.location.pathname='/blog/checkride-prep-guide.html';e.start();await e.client.choice('allow',true);assert.deepEqual(e.submit(),{});
  });
  await test('Missing duplicate malformed or mixed query values never capture a click',async()=>{
    const queries=[QUERY,QUERY+'&gclid=',QUERY+'&gclid=short',QUERY+'&gclid='+CLICK+'&gclid='+CLICK,
      QUERY+'&gclid=secret%40example.com',QUERY+'&gclid='+CLICK+'&utm_source=google',
      QUERY.replace('utm_medium=cpc','utm_medium=social')+'&gclid='+CLICK];
    for(const query of queries) {const e=environment({search:'?'+query});e.start();await e.client.choice('allow',true);assert.deepEqual(e.submit(),{});assert.equal(e.api.requests.filter(r=>r.url.endsWith('/grant')).length,0);}
  });
  await test('Grant failure, malformed acknowledgement and storage failure never add measurement fields',async()=>{
    for(const change of [e=>{e.api.fail=true;},e=>{e.api.grantOverride={qa:true};},e=>{e.api.grantOverride={receipt_id:'bad'};},
      e=>{e.window.localStorage.setItem=()=>{};}]) {
      const e=environment();change(e);e.start();await e.client.choice('allow',true);assert.deepEqual(e.submit(),{});
    }
  });
  await test('Denied choice clears fields immediately and persists withdrawal before asynchronous acknowledgement',async()=>{
    const e=environment();e.start();await e.client.choice('allow',true);e.submit();e.api.fail=true;e.choiceState.value='deny';
    const pending=e.client.choice('deny',true);assert.equal(e.inputs.length,0);assert.equal(e.store.get(REVOKE),'1');
    await pending;assert.equal(e.client.status(),'withdrawal-pending');assert.deepEqual(e.submit(),{});
    const saved=JSON.parse(e.store.get(STORE));assert.equal(saved.receipts[0].local_state,'pending');
  });
  await test('A new page retries durable pending withdrawal and removes acknowledged capabilities',async()=>{
    const e=environment();e.start();await e.client.choice('allow',true);e.api.fail=true;e.choiceState.value='deny';await e.client.choice('deny',true);
    e.api.fail=false;const next=environment({choice:'deny',store:e.store,api:e.api});next.start();await tick();
    assert.equal(JSON.parse(e.store.get(STORE)).receipts.length,0);assert([...e.api.records.values()].every(r=>r.state==='revoked'));
  });
  await test('A late grant response after withdrawal is revoked and cannot resurrect matching',async()=>{
    const e=environment();let release;e.api.grantGate=new Promise(resolve=>{release=resolve;});e.start();
    const grant=e.client.choice('allow',true);await tick();e.choiceState.value='deny';const revoke=e.client.choice('deny',true);
    release();await grant;await revoke;assert.deepEqual(e.submit(),{});assert([...e.api.records.values()].every(r=>r.state==='revoked'));
  });
  await test('GPC enabled before submit clears stale fields and starts revocation',async()=>{
    const e=environment();e.start();await e.client.choice('allow',true);e.submit();e.window.navigator.globalPrivacyControl=true;
    assert.deepEqual(e.submit(),{});await tick();assert([...e.api.records.values()].every(r=>r.state==='revoked'));
  });
  await test('Cross-tab serialization retains both capabilities and one withdrawal revokes every grant',async()=>{
    const store=new Map(),locks=lockManager(),api=server();const a=environment({store,locks,api}),b=environment({store,locks,api});a.start();b.start();
    await Promise.all([a.client.choice('allow',true),b.client.choice('allow',true)]);
    assert.equal(JSON.parse(store.get(STORE)).receipts.length,2);
    a.choiceState.value='deny';await a.client.choice('deny',true);assert([...api.records.values()].every(r=>r.state==='revoked'));
    assert.deepEqual(b.submit(),{});
  });
  await test('Regrant waits for pending withdrawals and obtains a distinct receipt',async()=>{
    const e=environment();e.start();await e.client.choice('allow',true);const old=e.submit()['fields[nr_ads_receipt]'];
    e.api.fail=true;e.choiceState.value='deny';await e.client.choice('deny',true);
    e.choiceState.value='allow';await e.client.choice('allow',true);assert.deepEqual(e.submit(),{});
    e.api.fail=false;await e.client.choice('allow',true);assert.notEqual(e.submit()['fields[nr_ads_receipt]'],old);
    assert.equal(e.api.records.get(old).state,'revoked');
  });
  await test('Unacknowledged storage updates cannot be used even if the server accepted a grant',async()=>{
    const e=environment();e.start();e.window.localStorage.setItem=()=>{throw Error('Blocked');};
    await e.client.choice('allow',true);assert.deepEqual(e.submit(),{});assert([...e.api.records.values()].every(r=>r.state==='revoked'));
  });
  await test('Expired records never submit, and cleanup occurs under the same storage lock',async()=>{
    const e=environment();e.start();await e.client.choice('allow',true);e.setClock('2026-12-05T20:00:00Z');
    assert.deepEqual(e.submit(),{});e.window.dispatch('focus');await tick();assert.equal(JSON.parse(e.store.get(STORE)).receipts.length,0);
  });
  await test('Array-coerced tokens and timestamps in stored or returned records never become measurement fields',async()=>{
    for(const property of ['receipt_id','revoke_capability','granted_at','expires_at']) {
      const e=environment();e.start();await e.client.choice('allow',true);
      const saved=JSON.parse(e.store.get(STORE));saved.receipts[0][property]=[saved.receipts[0][property]];e.store.set(STORE,JSON.stringify(saved));
      const next=environment({store:e.store,api:e.api});next.start();await next.client.choice('allow',true);assert.deepEqual(next.submit(),{});
    }
    const e=environment();e.api.grantOverride={receipt_id:['R'+'0'.repeat(42)]};e.start();await e.client.choice('allow',true);assert.deepEqual(e.submit(),{});
  });
  await test('Mapping disabled after use still honors stored revocations without creating a grant',async()=>{
    const e=environment();e.start();await e.client.choice('allow',true);
    const next=environment({choice:'deny',store:e.store,locks:lockManager(),api:e.api,config:{...config,enabled:false}});next.start();await tick();
    assert([...e.api.records.values()].every(r=>r.state==='revoked'));assert.deepEqual(next.submit(),{});
  });
  await test('Temporary exact QA harness always requests QA=true and uses only its fixed synthetic click',async()=>{
    const e=environment({config:{...config,qa_harness:true},search:'?analytics_test=1'});
    e.window.location.pathname='/_ppl-measurement-qa/';e.start();await e.client.choice('allow',true);
    const data=e.submit();assert.equal(data['fields[nr_ads_gclid]'],'QA_SYNTHETIC_NO_GOOGLE_MATCH_20261104');
    assert.equal(e.api.requests.find(r=>r.url.endsWith('/grant')).options.body.qa,true);
    assert.equal(e.store.has(STORE),false);assert(JSON.parse(e.store.get('nickrae_ppl_measurement_qa_receipts_v1')).receipts.every(r=>r.qa===true));
    assert([...e.api.records.values()].every(r=>r.qa===true));
  });
  await test('QA mode cannot weaken production path, consent, GPC, identifier or query guards',async()=>{
    for(const change of [e=>{},e=>{e.window.location.pathname='/_ppl-measurement-qa/';e.window.location.search='';},
      e=>{e.window.location.pathname='/_ppl-measurement-qa/';e.window.location.search='?analytics_test=0';},
      e=>{e.window.location.pathname='/_ppl-measurement-qa/';e.window.location.search='?analytics_test=1&gclid=other';},
      e=>{e.window.location.pathname='/_ppl-measurement-qa/';e.window.navigator.globalPrivacyControl=true;}]) {
      const e=environment({config:{...config,qa_harness:true},search:'?analytics_test=1'});change(e);e.start();await e.client.choice('allow',true);
      assert.deepEqual(e.submit(),{});assert.equal(e.api.requests.filter(r=>r.url.endsWith('/grant')).length,0);
    }
  });
  await test('QA receipt storage is isolated from production and an unexpected non-QA acknowledgement is unusable',async()=>{
    const e=environment({config:{...config,qa_harness:true},search:'?analytics_test=1'});e.window.location.pathname='/_ppl-measurement-qa/';
    e.start();await e.client.choice('allow',true);
    const production=environment({store:e.store,api:e.api});production.start();await tick();assert.deepEqual(production.submit(),{});
    const bad=environment({config:{...config,qa_harness:true},search:'?analytics_test=1'});bad.window.location.pathname='/_ppl-measurement-qa/';
    bad.api.grantOverride={qa:false};bad.start();await bad.client.choice('allow',true);assert.deepEqual(bad.submit(),{});
  });
  await test('Temporary QA page, when present, has no Google/site tags, is noindex and keeps the exact ordinary Kit form',async()=>{
    const qaPath=path.join(__dirname,'../_ppl-measurement-qa/index.html');
    if(!fs.existsSync(qaPath)) return; // Removal after the owner test is required.
    const html=fs.readFileSync(qaPath,'utf8');
    const scriptSources=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match=>match[1]);
    assert(html.includes('noindex,nofollow'));assert(!scriptSources.some(src=>/googletagmanager|google-analytics/.test(src)));
    assert(!html.includes('src="/assets/site.js'));assert(html.includes('"qa_harness":true'));
    assert.equal((html.match(/<form\b/g)||[]).length,1);assert(html.includes('data-sv-form="10042240"'));
    assert(html.includes('data-uid="899d974875"'));assert(html.includes('https://app.kit.com/forms/10042240/subscriptions'));
    assert(!html.includes('IMPORTER_TOKEN'));assert(!html.includes('revoke_capability'));
  });
  console.log(JSON.stringify({passed:results.length,tests:results,source:modulePath,
    scope:'Synthetic DOM/storage/WebLocks/HTTPS doubles only; no Google or Kit request, signup or conversion.'},null,2));
})().catch(error=>{console.error(error);process.exit(1);});
