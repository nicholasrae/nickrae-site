#!/usr/bin/env node
'use strict';
// Exercise actual parsed page links and inline redirects, independently of the
// transformation used to make them origin-relative. No browser or network calls.
const assert = require('node:assert/strict');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const extract = String.raw`
import json,sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd() / 'scripts'))
from check_site import Page
manifest=json.loads(Path('.cloudflare/generated/manifest.json').read_text())
pages={}
for name in manifest['files']:
    if not name.endswith('.html'): continue
    page=Page(Path(name),name)
    pages[name]={
        'anchors':[a.attrs.get('href','') for a in page.anchors],
        'scripts':[s.text for s in page.tags('script') if not s.attrs.get('src')],
        'refreshes':[m.attrs.get('content','') for m in page.refreshes],
        'canonical':page.canonical,
    }
print(json.dumps(pages))
`;
const pages = JSON.parse(execFileSync('python3', ['-c', extract], {cwd: root, encoding: 'utf8'}));
const indexRedirects = {
  'index.html': '/',
  'aviation-workbooks/index.html': '/aviation-workbooks/',
  'blog/index.html': '/blog/',
  'feedfare/index.html': '/feedfare/',
  'flight-funded/index.html': '/flight-funded/',
  'ifr-scenario-pack/index.html': '/ifr-scenario-pack/',
  'ifr-scenario-pack/thanks/index.html': '/ifr-scenario-pack/thanks/',
  'inflection-point/index.html': '/inflection-point/',
  'openclaw-playbook/index.html': '/openclaw-playbook/',
};
const legacyRedirects = {
  'blog/blog-trajectory-learning.html': '/blog/self-improving-ai-agents.html',
  'blog/openclaw-setup.html': '/blog/blog-openclaw-setup.html',
  'inflection/index.html': '/inflection-point/',
};
const origins = ['https://nickrae-preview.pages.dev', 'https://another-preview.example.workers.dev', 'http://localhost:8899', 'https://nickrae.net', 'https://www.nickrae.net'];
const suffixes = ['', '?analytics_test=1#free-ppl-cards', '?term=%2F+%20&value=one%26two#encoded%20anchor'];
const run = (file, incoming) => {
  const url = new URL(incoming), calls = [];
  const location = {pathname: url.pathname, search: url.search, hash: url.hash, replace: value => calls.push(new URL(value, url).href)};
  for (const script of pages[file].scripts.filter(text => text.includes('window.location.replace'))) {
    vm.runInNewContext(script, {window: {location}}, {timeout: 1000, filename: file});
  }
  return calls;
};
let passed = 0;
const test = (name, fn) => {fn(); passed++; console.log('PASS ' + name);};
test('all public HTML is parsed and every existing navigation script is covered', () => {
  const ownerQaPage = Object.hasOwn(pages, 'ppl-measurement-qa/index.html');
  assert.equal(Object.keys(pages).length, 53 + (ownerQaPage ? 1 : 0));
  const actual = Object.entries(pages).filter(([, page]) => page.scripts.some(s => s.includes('window.location.replace'))).map(([file]) => file).sort();
  assert.deepEqual(actual, Object.keys({...indexRedirects, ...legacyRedirects}).sort());
});
test('same-site anchors remain on each reviewing origin with exact path/query/fragment semantics', () => {
  let rootRelative = 0;
  for (const [file, page] of Object.entries(pages)) for (const href of page.anchors) {
    const resolved = new URL(href, 'https://nickrae-preview.pages.dev/' + file);
    assert.ok(!['nickrae.net', 'www.nickrae.net'].includes(resolved.hostname), 'Own-site anchor escapes preview: ' + file + ' ' + href);
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    rootRelative++;
    const expected = new URL(href, origins[0]);
    for (const origin of origins) {
      const actual = new URL(href, origin + '/' + file + '?analytics_test=1#incoming');
      assert.equal(actual.origin, origin);
      assert.equal(actual.pathname + actual.search + actual.hash, expected.pathname + expected.search + expected.hash);
    }
  }
  assert.ok(rootRelative > 100, 'Expected the full site navigation, not an empty fixture');
});
test('actual index-alias scripts preserve origin and encoded queries/fragments', () => {
  for (const [file, destination] of Object.entries(indexRedirects)) for (const origin of origins) for (const suffix of suffixes) {
    assert.deepEqual(run(file, origin + '/' + file + suffix), [origin + destination + suffix], file);
  }
});
test('index-alias guards do not redirect normal canonical visits or create loops', () => {
  for (const [file, destination] of Object.entries(indexRedirects)) for (const origin of origins) for (const suffix of suffixes) {
    assert.deepEqual(run(file, origin + destination + suffix), [], file);
  }
});
test('all three legacy scripts preserve origin and encoded queries/fragments', () => {
  for (const [file, destination] of Object.entries(legacyRedirects)) for (const origin of origins) for (const suffix of suffixes) {
    assert.deepEqual(run(file, origin + '/' + file + suffix), [origin + destination + suffix], file);
    if (file.endsWith('.html')) assert.deepEqual(run(file, origin + '/' + file.slice(0, -5) + suffix), [origin + destination + suffix], file);
  }
});
test('legacy static refreshes and clickable fallbacks stay on origin at the same canonical destination', () => {
  for (const [file, destination] of Object.entries(legacyRedirects)) {
    const page = pages[file]; assert.equal(page.refreshes.length, 1);
    const match = /^\s*0\s*;\s*url\s*=\s*(.*?)\s*$/i.exec(page.refreshes[0]); assert.ok(match, file);
    assert.equal(match[1], destination, file);
    assert.ok(page.anchors.includes(destination), 'Missing accessible fallback: ' + file);
    assert.deepEqual(page.canonical, ['https://nickrae.net' + destination], file);
    for (const origin of origins) assert.equal(new URL(match[1], origin + '/' + file).href, origin + destination);
  }
});
console.log(JSON.stringify({ok: true, groups: passed, htmlPages: Object.keys(pages).length, scriptedRoutes: 12, origins: origins.length}));
