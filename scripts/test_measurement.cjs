// Dependency-free behavioral tests of the actual site.js functions.
// No network requests or real subscribers. Run from the repository root: node scripts/test_measurement.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const site = path.resolve(__dirname, '../assets/site.js');
const source = fs.readFileSync(site, 'utf8');
const tests = [];
// Substituted only inside the VM. Never written into website source.
const TEST_GA4_ID = 'G-TEST000001';

class Events {
  constructor() { this.listeners = {}; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  dispatchEvent(event) { for (const fn of this.listeners[event.type] || []) fn(event); }
}
class Element extends Events {
  constructor() {
    super(); this.isConnected = true; this.hidden = false;
    this.style = {display: 'block', visibility: 'visible', opacity: '1'};
    this.rect = {left: 0, top: 100, right: 500, bottom: 400, width: 500, height: 300};
  }
  getClientRects() { return this.hidden ? [] : [this.rect]; }
  getBoundingClientRect() { return this.rect; }
}
function environment({allowed = false, initialConsent = allowed ? 'allow' : null, origin = 'https://nickrae.net', ga4Id = TEST_GA4_ID, autoLoad = true} = {}) {
  const storage = new Map(initialConsent ? [['nickrae_analytics_consent_v1', initialConsent]] : []);
  const scripts = [], createdScripts = [], observers = [], intersections = [], cookieWrites = [], reloads = [];
  const document = new Events();
  Object.assign(document, {
    readyState: 'loading', referrer: 'https://example.com/article?email=secret@example.com#token',
    body: {dataset: {}, classList: {contains() {return false;}}},
    documentElement: {style: {removeProperty() {}}},
    getElementById() { return null; },
    createElement(tag) {
      const el = {tag, isConnected: false, remove() { this.isConnected = false; const i = scripts.indexOf(el); if (i >= 0) scripts.splice(i, 1); }};
      if (tag === 'script') createdScripts.push(el);
      return el;
    },
    head: {appendChild(el) { el.isConnected = true; scripts.push(el); if (autoLoad && !el.loaded) { el.loaded = true; el.onload?.(); } }},
    querySelectorAll(selector) { return selector.includes('googletagmanager') ? scripts : []; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  });
  Object.defineProperty(document, 'cookie', {
    get() { return '_ga=test; _ga_EXAMPLE=test'; }, set(v) { cookieWrites.push(v); }
  });
  const window = new Events();
  Object.assign(window, {
    location: new URL(origin + '/aviation-workbooks/private-pilot/?email=secret@example.com#private-token'),
    innerWidth: 1000, innerHeight: 800,
    localStorage: {getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k)},
    getComputedStyle: e => e.style
  });
  window.location.reload=()=>reloads.push({
    consent: window.NickRaePrivacy.consent(),
    savedConsent: storage.get('nickrae_analytics_consent_v1') || null,
    disabled: window[`ga-disable-${ga4Id}`],
    scriptCount: scripts.length,
    clearedCookies: cookieWrites.length,
    lastConsent: Array.from(window.dataLayer || []).filter(x=>x[0]==='consent').at(-1)?.[2]
  });
  class Observer {
    constructor(fn) { this.fn = fn; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() {}
  }
  class Intersection {
    constructor(fn) { this.fn = fn; intersections.push(this); }
    observe() {} unobserve() {}
  }
  const context = {window, document, URL, URLSearchParams, Set, Date, MutationObserver: Observer,
    IntersectionObserver: Intersection, CustomEvent: class {constructor(type) {this.type = type;}}, console};
  const idPattern = /const GA4_ID = (?:null|'G-[A-Z0-9]+'|\"G-[A-Z0-9]+\");/;
  assert(idPattern.test(source), 'Expected exactly one explicit GA4 configuration constant');
  const fixtureSource = source.replace(idPattern, `const GA4_ID = ${JSON.stringify(ga4Id)};`);
  const marker = fixtureSource.lastIndexOf('})();');
  assert(marker > 0);
  const instrumented = fixtureSource.slice(0, marker) +
    'window.testAPI = {attachGlobalTracking, measurePplSignup};\n' + fixtureSource.slice(marker);
  vm.runInNewContext(instrumented, context, {filename: site});
  const allEvents = () => Array.from(window.dataLayer || []).filter(x => x[0] === 'event').map(x => ({name: x[1], params: x[2]}));
  const events = () => allEvents().filter(x => x.name !== 'page_view');
  const commands = name => Array.from(window.dataLayer || []).filter(x => x[0] === name);
  const finishLoading = () => { const script = createdScripts.at(-1); script.loaded = true; script.onload?.(); };
  const click = (href, dataset = {}, text = 'Do not collect this text') => {
    const link = {href, dataset, textContent: text, closest() {return this;}};
    document.dispatchEvent({type: 'click', target: link});
  };
  return {window, document, scripts, createdScripts, observers, intersections, cookieWrites, reloads, events, allEvents, commands, click, finishLoading};
}
function signupFixture() {
  const signup = new Element(), form = new Element();
  const statuses = [];
  form.matches = selector => selector === 'form[data-uid="899d974875"]';
  // Any attempt to read the entered email fails this test immediately.
  Object.defineProperty(form, 'value', {get() {throw Error('PII read');}});
  signup.querySelector = selector => selector.startsWith('form') ? form : statuses[0] || null;
  signup.querySelectorAll = () => statuses;
  const submit = () => signup.dispatchEvent({type: 'submit', target: form});
  const complete = () => {
    const event = {type: 'ckjs:submission:complete', target: form};
    Object.defineProperty(event, 'detail', {get() {throw Error('Kit event PII read');}});
    signup.dispatchEvent(event);
  };
  const addSuccess = (hidden = false) => {const node = new Element();node.hidden = hidden;statuses.push(node);return node;};
  return {signup, form, statuses, submit, complete, addSuccess};
}
function test(name, fn) { fn(); tests.push(name); }

test('Fresh no-consent state loads no Google script and queues no clicks', () => {
  const e = environment(); e.window.testAPI.attachGlobalTracking();
  e.click('https://www.amazon.com/dp/B0GN81JP9R');
  assert.equal(e.scripts.length, 0); assert.equal(e.events().length, 0);
});
test('Localhost, loopback, dev hosts and insecure HTTP never load production measurement', () => {
  for (const origin of ['http://localhost:8080','http://127.0.0.1:8080','https://preview.nickrae.net','http://nickrae.net']) {
    const e=environment({origin});e.window.testAPI.attachGlobalTracking();e.window.NickRaePrivacy.allow();
    e.click('https://www.amazon.com/dp/B0GN81JP9R');
    assert.equal(e.scripts.length,0,origin);assert.equal(e.events().length,0,origin);
  }
});
test('Allow loads once and strips URL/referrer query and fragment', () => {
  const e = environment();e.window.NickRaePrivacy.allow();e.window.NickRaePrivacy.allow();
  assert.equal(e.scripts.length, 1);
  const configs = e.commands('config');
  assert.deepEqual(configs.map(x=>x[1]), ['AW-18126210838', TEST_GA4_ID]);
  configs.forEach(config => {
    assert.equal(config[2].page_location, 'https://nickrae.net/aviation-workbooks/private-pilot/');
    assert.equal(config[2].page_referrer, 'https://example.com/article');
    assert.equal(config[2].send_page_view, false);
    assert.equal(config[2].allow_google_signals, false);
    assert.equal(config[2].allow_ad_personalization_signals, false);
  });
  assert.equal(e.commands('js').length,1);
  const globalConfig=e.commands('set')[0][1];assert.equal(globalConfig.send_page_view,false);
  const views=e.allEvents().filter(x=>x.name==='page_view');assert.equal(views.length,1);
  assert.equal(views[0].params.send_to,TEST_GA4_ID);
  assert.equal(views[0].params.page_location,'https://nickrae.net/aviation-workbooks/private-pilot/');
});
test('One event per CTA click, including previously untagged previews and products', () => {
  const e = environment();e.window.testAPI.attachGlobalTracking();e.window.NickRaePrivacy.allow();
  const rows = [
    ['https://www.amazon.com/dp/B0GN81JP9R?email=secret@example.com', {}, 'amazon_click'],
    ['https://nickrae.net/aviation-workbooks/commercial-pilot/', {}, 'product_detail_click'],
    ['https://nickrae.net/aviation-workbooks/private-pilot/#preview', {}, 'workbook_preview_click'],
    ['https://nickrae.net/assets/workbooks/previews/private-pilot-question.webp', {}, 'workbook_preview_open'],
    ['https://nickrae.net/assets/workbook-previews/commercial-pilot-sample.pdf', {}, 'workbook_sample_download'],
    ['https://nick-rae.kit.com/899d974875', {}, 'ppl_signup_fallback_click'],
    ['https://nickrae.net/#free-ppl-cards', {}, 'ppl_signup_click'],
    ['https://nicholasrae.gumroad.com/l/openclaw-playbook?wanted=true', {track:'checkout',placement:'hero-primary'}, 'openclaw_checkout_click'],
    ['https://nickrae.net/aviation-workbooks/#instrument-sample', {event:'workbook_sample_view'}, 'workbook_preview_click']
  ];
  rows.forEach(([href, data, expected], i) => {
    e.click(href, data, 'secret@example.com');assert.equal(e.events().length, i+1);assert.equal(e.events().at(-1).name, expected);assert.equal(e.events().at(-1).params.send_to,TEST_GA4_ID);
  });
  const payload = JSON.stringify(e.events());
  assert(!payload.includes('secret@'));assert(!payload.includes('private-token'));assert(!payload.includes('wanted='));
  e.click('mailto:secret@example.com');assert.equal(e.events().length, rows.length);
});
test('Withdrawal stops clicks, disables Google and clears cookies before requesting one reload', () => {
  const e = environment();e.window.testAPI.attachGlobalTracking();e.window.NickRaePrivacy.allow();
  e.click('https://www.amazon.com/dp/B0GN81JP9R');e.window.NickRaePrivacy.deny();
  e.click('https://www.amazon.com/dp/B0GN81JP9R');assert.equal(e.events().length, 1);
  assert.equal(e.scripts.length, 0);assert(e.cookieWrites.some(v => v.startsWith('_ga=;')));
  assert.equal(e.window[`ga-disable-${TEST_GA4_ID}`],true);
  assert.equal(e.commands('consent').at(-1)[1],'update');
  assert.equal(e.commands('consent').at(-1)[2].analytics_storage,'denied');
  assert.equal(e.reloads.length,1);
  const state=e.reloads[0];assert.equal(state.consent,'deny');assert.equal(state.savedConsent,'deny');
  assert.equal(state.disabled,true);assert.equal(state.scriptCount,0);assert(state.clearedCookies>0);
  assert.equal(state.lastConsent.ad_storage,'denied');assert.equal(state.lastConsent.analytics_storage,'denied');
  e.window.NickRaePrivacy.deny();assert.equal(e.reloads.length,1);
});
test('Form impression requires visibility and consent, and fires once per placement', () => {
  const e = environment(), f = signupFixture();f.form.hidden = true;
  e.window.testAPI.measurePplSignup(f.signup, 0);e.window.NickRaePrivacy.allow();assert.equal(e.events().length,0);
  f.form.hidden=false;e.intersections[0].fn();e.intersections[0].fn();
  assert.deepEqual(e.events().map(x=>x.name),['ppl_form_view']);
  assert.equal(e.events()[0].params.placement, '/aviation-workbooks/private-pilot/:ppl-1');
});
test('Submit is an attempt; completion signal plus NEW visible success means acceptance once', () => {
  const e = environment(),f=signupFixture();e.window.testAPI.measurePplSignup(f.signup,0);e.window.NickRaePrivacy.allow();
  f.submit();e.observers[0].fn();assert.equal(e.events().filter(x=>x.name==='ppl_form_accepted').length,0);
  f.complete();e.observers[0].fn();assert.equal(e.events().filter(x=>x.name==='ppl_form_accepted').length,0);
  const success=f.addSuccess(true);e.observers[0].fn();assert.equal(e.events().filter(x=>x.name==='ppl_form_accepted').length,0);
  success.hidden=false;e.observers[0].fn();e.observers[0].fn();
  assert.deepEqual(e.events().map(x=>x.name),['ppl_form_view','ppl_form_submit','ppl_form_accepted']);
  assert(!JSON.stringify(e.events()).includes('email'));
});
test('Pre-existing success, success without submit, and success without Kit completion are not acceptance', () => {
  for (const kind of ['existing','no-submit','no-completion']) {
    const e=environment(),f=signupFixture();if(kind==='existing')f.addSuccess();
    e.window.testAPI.measurePplSignup(f.signup,0);e.window.NickRaePrivacy.allow();
    if(kind!=='no-submit')f.submit();if(kind!=='no-completion')f.complete();
    if(kind!=='existing')f.addSuccess();e.observers[0].fn();
    assert.equal(e.events().filter(x=>x.name==='ppl_form_accepted').length,0,kind);
  }
});
test('Non-consented submit and a submit invalidated by withdrawal are never backfilled', () => {
  for(const kind of ['without-consent','withdraw']) {
    const e=environment(),f=signupFixture();e.window.testAPI.measurePplSignup(f.signup,0);
    if(kind==='withdraw')e.window.NickRaePrivacy.allow();f.submit();
    if(kind==='withdraw')e.window.NickRaePrivacy.deny();
    e.window.NickRaePrivacy.allow();f.complete();f.addSuccess();e.observers[0].fn();
    assert.equal(e.events().filter(x=>x.name==='ppl_form_accepted').length,0,kind);
  }
});

test('Unset or invalid GA4 ID preserves Ads configuration without emitting custom or pageview events', () => {
  for (const ga4Id of [null, '', 'AW-18126210838', 'G-bad-id']) {
    const e=environment({ga4Id});e.window.testAPI.attachGlobalTracking();e.window.NickRaePrivacy.allow();
    e.click('https://www.amazon.com/dp/B0GN81JP9R');
    assert.equal(e.window.NickRaeMeasurement.track('flight_hour_calculator_use'),false);
    assert.deepEqual(e.commands('config').map(x=>x[1]),['AW-18126210838']);
    assert.equal(e.scripts.length,1);assert.equal(e.allEvents().length,0);
  }
});
test('Consent withdrawal during script loading cannot queue or replay custom events', () => {
  const e=environment({autoLoad:false});e.window.testAPI.attachGlobalTracking();e.window.NickRaePrivacy.allow();
  assert.equal(e.commands('config').length,0);assert.equal(e.commands('set').length,0);
  assert.equal(e.commands('consent')[0][2].ad_storage,'denied');
  assert.equal(e.commands('consent')[0][2].analytics_storage,'denied');
  e.click('https://www.amazon.com/dp/B0GN81JP9R');assert.equal(e.allEvents().length,0);
  e.window.NickRaePrivacy.deny();e.finishLoading();assert.equal(e.allEvents().length,0);
  assert.equal(e.commands('config').length,0);assert.equal(e.commands('set').length,0);
  assert(!e.commands('consent').some(x=>x[2].ad_storage==='granted'));
  assert.equal(e.window[`ga-disable-${TEST_GA4_ID}`],true);
  e.window.NickRaePrivacy.allow();
  assert.equal(e.createdScripts.length,1);assert.equal(e.scripts.length,1);
  assert.equal(e.commands('config').length,2);
  assert.deepEqual(e.allEvents().map(x=>x.name),['page_view']);
  e.click('https://www.amazon.com/dp/B0GN81JP9R');assert.equal(e.events().length,1);
});
test('A regrant before navigation completes reuses the loader without duplicate pageviews or events', () => {
  const e=environment();e.window.testAPI.attachGlobalTracking();e.window.NickRaePrivacy.allow();
  const script=e.scripts[0];
  for(let i=0;i<3;i++) {
    e.window.NickRaePrivacy.deny();assert.equal(e.scripts.length,0);
    e.window.NickRaePrivacy.allow();assert.equal(e.scripts[0],script);
    assert.equal(e.window[`ga-disable-${TEST_GA4_ID}`],false);
    e.click('https://www.amazon.com/dp/B0GN81JP9R');
  }
  assert.equal(e.createdScripts.length,1);assert.equal(e.commands('config').length,2);
  assert.equal(e.commands('js').length,1);
  assert.equal(e.allEvents().filter(x=>x.name==='page_view').length,1);
  assert.equal(e.events().length,3);
});
test('A failed loader can retry without reconfiguring or duplicating pageviews', () => {
  const e=environment({autoLoad:false});e.window.NickRaePrivacy.allow();
  e.scripts[0].onerror();assert.equal(e.scripts.length,0);assert.equal(e.allEvents().length,0);
  e.window.NickRaePrivacy.allow();e.finishLoading();
  assert.equal(e.createdScripts.length,2);assert.equal(e.scripts.length,1);
  assert.equal(e.commands('config').length,2);assert.equal(e.allEvents().length,1);
});
test('Cross-tab withdrawal disables GA4 and invalidates a pending accepted form', () => {
  const e=environment(),f=signupFixture();e.window.testAPI.measurePplSignup(f.signup,0);
  e.window.NickRaePrivacy.allow();f.submit();
  e.window.localStorage.setItem('nickrae_analytics_consent_v1','deny');
  e.window.dispatchEvent({type:'storage',key:'nickrae_analytics_consent_v1'});
  assert.equal(e.window[`ga-disable-${TEST_GA4_ID}`],true);assert.equal(e.scripts.length,0);
  assert.equal(e.reloads.length,1);assert.equal(e.reloads[0].savedConsent,'deny');
  assert.equal(e.reloads[0].disabled,true);assert.equal(e.reloads[0].lastConsent.ad_storage,'denied');
  e.window.localStorage.setItem('nickrae_analytics_consent_v1','allow');
  e.window.dispatchEvent({type:'storage',key:'nickrae_analytics_consent_v1'});
  f.complete();f.addSuccess();e.observers[0].fn();
  assert.equal(e.window[`ga-disable-${TEST_GA4_ID}`],false);
  assert.equal(e.events().filter(x=>x.name==='ppl_form_accepted').length,0);
  assert.equal(e.allEvents().filter(x=>x.name==='page_view').length,1);
});
test('Reset revokes consent and clears measurement before reload, invalidating pending acceptance', () => {
  const e=environment(),f=signupFixture();e.window.testAPI.measurePplSignup(f.signup,0);
  e.window.NickRaePrivacy.allow();f.submit();
  let reloadCalls=0;
  e.window.location.reload=()=>{
    reloadCalls+=1;
    assert.equal(e.window.NickRaePrivacy.consent(),null);
    assert.equal(e.window[`ga-disable-${TEST_GA4_ID}`],true);
    assert.equal(e.scripts.length,0);
    assert(e.cookieWrites.some(v=>v.startsWith('_ga=;')));
    const consent=e.commands('consent').at(-1);
    assert.equal(consent[1],'update');
    for(const key of ['ad_storage','analytics_storage','ad_user_data','ad_personalization']) {
      assert.equal(consent[2][key],'denied');
    }
    assert.equal(e.window.NickRaeMeasurement.track('flight_hour_calculator_use'),false);
  };
  e.window.NickRaePrivacy.reset();assert.equal(reloadCalls,1);
  // Simulate a delayed navigation: an old Kit callback must not become valid
  // if permission is granted again before the browser replaces the document.
  e.window.NickRaePrivacy.allow();f.complete();f.addSuccess();e.observers[0].fn();
  assert.equal(e.events().filter(x=>x.name==='ppl_form_accepted').length,0);
});
test('Fresh denial does not reload, and the actual replacement-page init loads no measurement', () => {
  const fresh=environment();fresh.window.NickRaePrivacy.deny();
  assert.equal(fresh.reloads.length,0);assert.equal(fresh.createdScripts.length,0);
  const previous=environment();previous.window.NickRaePrivacy.allow();previous.window.NickRaePrivacy.deny();
  const replacement=environment({initialConsent:previous.reloads[0].savedConsent});
  replacement.document.dispatchEvent({type:'DOMContentLoaded'});
  replacement.click('https://www.amazon.com/dp/B0GN81JP9R');
  assert.equal(replacement.createdScripts.length,0);assert.equal(replacement.allEvents().length,0);
  assert.equal(replacement.reloads.length,0);assert.equal(replacement.window.NickRaePrivacy.consent(),'deny');
  replacement.window.NickRaePrivacy.allow();
  assert.equal(replacement.createdScripts.length,1);assert.equal(replacement.allEvents().length,1);
});
test('Cross-tab removal or storage clear shuts down a loaded tag and reloads once', () => {
  for(const key of ['nickrae_analytics_consent_v1',null]) {
    const e=environment();e.window.NickRaePrivacy.allow();
    e.window.localStorage.removeItem('nickrae_analytics_consent_v1');
    e.window.dispatchEvent({type:'storage',key});
    assert.equal(e.reloads.length,1);assert.equal(e.reloads[0].savedConsent,null);
    assert.equal(e.reloads[0].disabled,true);assert.equal(e.reloads[0].scriptCount,0);
    e.window.dispatchEvent({type:'storage',key});assert.equal(e.reloads.length,1);
  }
});
test('Failed or silently ignored deny/reset writes keep this page off and never reload into saved allow', () => {
  for(const action of ['deny','reset']) for(const failure of ['throw','ignore']) {
    const e=environment(),f=signupFixture();e.window.testAPI.measurePplSignup(f.signup,0);
    e.window.NickRaePrivacy.allow();f.submit();
    const eventsBefore=e.allEvents().length;
    const method=action==='deny'?'setItem':'removeItem';
    const original=e.window.localStorage[method];
    e.window.localStorage[method]=()=>{if(failure==='throw')throw Error('Storage unavailable');};
    e.window.NickRaePrivacy[action]();
    assert.equal(e.window.localStorage.getItem('nickrae_analytics_consent_v1'),'allow');
    assert.equal(e.window.NickRaePrivacy.consent(),action==='deny'?'deny':null);
    assert.equal(e.window[`ga-disable-${TEST_GA4_ID}`],true);assert.equal(e.scripts.length,0);
    assert.equal(e.reloads.length,0);assert(e.cookieWrites.length>0);
    // An old storage notification or late load callback cannot restore consent.
    e.window.dispatchEvent({type:'storage',key:'nickrae_analytics_consent_v1'});e.finishLoading();
    assert.equal(e.window.NickRaeMeasurement.track('flight_hour_calculator_use'),false);
    assert.equal(e.window[`ga-disable-${TEST_GA4_ID}`],true);
    assert.equal(e.allEvents().length,eventsBefore);assert.equal(e.reloads.length,0);
    e.window.localStorage[method]=original;e.window.NickRaePrivacy.allow();
    f.complete();f.addSuccess();e.observers[0].fn();
    assert.equal(e.events().filter(x=>x.name==='ppl_form_accepted').length,0);
  }
});
test('Withdrawal during loading reloads safely and a late load cannot configure either destination', () => {
  const e=environment({autoLoad:false});e.window.NickRaePrivacy.allow();e.window.NickRaePrivacy.deny();
  assert.equal(e.reloads.length,1);assert.equal(e.reloads[0].savedConsent,'deny');
  e.finishLoading();assert.equal(e.commands('config').length,0);assert.equal(e.allEvents().length,0);
  assert.equal(e.window[`ga-disable-${TEST_GA4_ID}`],true);
});
test('Shared helper fixes destination and URLs and excludes unknown input/identity parameters', () => {
  const e=environment();e.window.NickRaePrivacy.allow();
  e.window.NickRaeMeasurement.track('flight_hour_calculator_use', {
    event_category:'site_tool',product:'flight_hour_calculator',placement:'cheapest-flight-hours',
    link_url:'https://example.com/path?email=secret@example.com#token',
    page_location:'https://example.com/?private-token',send_to:'AW-WRONG',
    email:'secret@example.com',user_id:'secret',calculator_input:393.1
  });
  const event=e.events()[0];assert.equal(event.params.send_to,TEST_GA4_ID);
  assert.equal(event.params.link_url,'https://example.com/path');
  assert.equal(event.params.page_location,'https://nickrae.net/aviation-workbooks/private-pilot/');
  assert(!JSON.stringify(event).includes('secret'));assert(!('calculator_input' in event.params));
});
test('Actual calculator callback uses shared consent guard and sends no entered values', () => {
  const html=fs.readFileSync(path.resolve(path.dirname(site),'../blog/blog-cheapest-flight-hours.html'),'utf8');
  assert(!html.includes("gtag('event', 'flight_hour_calculator_use'"));
  const call=html.match(/window\.NickRaeMeasurement\.track\('flight_hour_calculator_use', \{[\s\S]*?\}\);/);
  assert(call,'Calculator must use the shared helper');
  const e=environment();const run=()=>vm.runInNewContext(call[0],{window:e.window});
  run();assert.equal(e.events().length,0);
  e.window.NickRaePrivacy.allow();run();assert.equal(e.events().length,1);
  assert.equal(e.events()[0].params.product,'flight_hour_calculator');
  assert.equal(e.events()[0].params.send_to,TEST_GA4_ID);
  assert(!JSON.stringify(e.events()).includes('393.1'));
  e.window.NickRaePrivacy.deny();run();assert.equal(e.events().length,1);
});

console.log(JSON.stringify({passed: tests.length, tests, source: site, scope: 'Node VM DOM doubles with an isolated test Measurement ID; no real Google or Kit network traffic. The test ID is never written to website source.'},null,2));
