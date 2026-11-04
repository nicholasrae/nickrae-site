// Actual site.js bridge; no browser/provider/network session is used.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const site=path.join(__dirname,'../assets/site.js'),source=fs.readFileSync(site,'utf8');
const results=[];
function fixture({origin='https://nickrae.net',choice='allow',search='?utm_source=google&utm_medium=cpc&utm_campaign=free_ppl_cards&utm_content=ppl_search_v1&gclid=Case_Sensitive-Gclid_QA0001'}={}) {
  const nodes=[],scripts=[],store=new Map(choice?[['nickrae_analytics_consent_v1',choice]]:[]),listeners={};
  function element(tag) {return {tag,style:{},dataset:{},children:[],isConnected:true,
    setAttribute(k,v) {this[k]=v;},append(...children) {this.children.push(...children);},appendChild(child) {this.children.push(child);return child;},
    addEventListener(){},remove() {this.isConnected=false;},getBoundingClientRect:()=>({height:100})};}
  const doc={readyState:'loading',referrer:'',currentScript:{src:'https://nickrae.net/assets/site.js?v=123456abcdef'},
    body:element('body'),documentElement:{style:{setProperty(){},removeProperty(){}}},
    createElement(tag) {const e=element(tag);nodes.push(e);return e;},
    getElementById:id=>nodes.find(e=>e.id===id&&e.isConnected)||null,
    querySelectorAll:selector=>selector.includes('googletagmanager')?scripts.filter(s=>s.src?.includes('googletagmanager')):[],
    querySelector:()=>null,addEventListener(type,fn) {(listeners[type]||=[]).push(fn);}};
  doc.head={appendChild(e) {scripts.push(e);e.isConnected=true;}};
  const win={location:new URL(origin+'/aviation-workbooks/private-pilot/'+search),navigator:{},fetch(){throw Error('No real fetch');},
    localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},
    addEventListener(){},removeEventListener(){},getComputedStyle:()=>({bottom:'0'}),setTimeout(){},clearTimeout(){},
    dispatchEvent(){}};
  win.location.reload=()=>{};
  const marker=source.lastIndexOf('})();');
  const instrumented=source.slice(0,marker)+'window.bridgeTest={loadConfirmedSignupMatching,matchingLinkPresent};\n'+source.slice(marker);
  vm.runInNewContext(instrumented,{window:win,document:doc,URL,URLSearchParams,Set,Date,CustomEvent:class{}},{filename:site});
  const created=[],calls=[];
  win.NickRaeConfirmedSignup={create(options) {created.push(options);return {start(){options.onChoiceNeeded();},choice(...args){calls.push(args);return Promise.resolve();}};}};
  return {win,doc,nodes,scripts,store,created,calls};
}
function test(name,fn) {fn();results.push(name);}
test('Production loads only the versioned first-party matching library without forwarding private URL values',()=>{
  const e=fixture();e.win.bridgeTest.loadConfirmedSignupMatching();assert.equal(e.scripts.length,1);
  assert.equal(e.scripts[0].src,'/assets/confirmed-signup.js?v=123456abcdef');assert.equal(e.scripts[0].referrerPolicy,'no-referrer');
  assert(!e.scripts[0].src.includes('gclid'));assert.equal(e.created.length,0);
});
test('Local, preview, www, insecure and port-bearing hosts do not bootstrap production matching',()=>{
  for(const origin of ['http://localhost:8920','https://nickrae-preview.pages.dev','https://www.nickrae.net','http://nickrae.net','https://nickrae.net:8443']) {
    const e=fixture({origin});e.win.bridgeTest.loadConfirmedSignupMatching();assert.equal(e.scripts.length,0);
  }
});
test('A saved old allow is not silently a fresh matching choice and gets the existing consent dialog',()=>{
  const e=fixture();e.win.bridgeTest.loadConfirmedSignupMatching();e.scripts[0].onload();
  assert.equal(e.calls.length,0);assert(e.doc.getElementById('privacy-consent'));
  assert(e.doc.getElementById('privacy-consent-description').textContent.includes('email-confirmed signup'));
});
test('A fresh allow during library loading is applied once without asking twice',()=>{
  const e=fixture();e.win.bridgeTest.loadConfirmedSignupMatching();e.win.NickRaePrivacy.allow();e.scripts[0].onload();
  assert.deepEqual(JSON.parse(JSON.stringify(e.calls)),[['allow',true]]);assert.equal(e.doc.getElementById('privacy-consent'),null);
});
test('A denial before library loading synchronously records withdrawal and cannot be replayed as allowance',()=>{
  const e=fixture();e.win.bridgeTest.loadConfirmedSignupMatching();e.win.NickRaePrivacy.allow();e.win.NickRaePrivacy.deny();
  assert.equal(e.store.get('nickrae_ppl_measurement_withdrawal_v1'),'1');
  e.scripts[0].onload();assert.equal(e.calls.length,0);
});
test('Matching-specific explanation is restricted to the exact non-QA ad landing with one valid click ID',()=>{
  assert.equal(fixture().win.bridgeTest.matchingLinkPresent(),true);
  for(const extra of ['&analytics_test=1','&gclid=duplicate','&utm_source=google']) {
    const e=fixture();e.win.location.search+=extra;assert.equal(e.win.bridgeTest.matchingLinkPresent(),false);
  }
});
console.log(JSON.stringify({passed:results.length,tests:results,source:site,scope:'Synthetic site.js bridge only; no real requests.'},null,2));
