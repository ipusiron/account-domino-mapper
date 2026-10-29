'use strict';
// H: static structure of index.html and the scripts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const SCRIPTS = ['theme-init.js', 'domino-core.js', 'domino-data.js', 'domino-view.js', 'messages.js', 'app.js'];
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
  + "base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'";

test('H: strict offline CSP, referrer, icon, noscript and no inline code', () => {
  assert.ok(html.includes(`<meta http-equiv="Content-Security-Policy" content="${CSP}">`));
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /<link rel="icon" href="data:,">/);
  assert.match(html, /<noscript>[^<]+<\/noscript>/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline script');
  assert.doesNotMatch(html, /<script[^>]*\btype=/, 'classic scripts only (no modules)');
  assert.doesNotMatch(html, /<style\b|\sstyle=/, 'no inline style');
  assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline event handlers');
  assert.equal((html.match(/role="tab"/g) || []).length, 4);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 4);
  // Each panel can take the focus right after its tab (WAI-ARIA tabs pattern); hidden panels drop out of the Tab order.
  for (const m of html.matchAll(/<section\b[^>]*\brole="tabpanel"[^>]*>/g)) assert.match(m[0], /\btabindex="0"/, m[0]);
  assert.match(html, /<dialog id="help-dialog" aria-labelledby="help-title">/);
});

test('H: the script order is fixed; theme-init.js is synchronous and the rest are deferred', () => {
  const tags = [...html.matchAll(/<script\b([^>]*)><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(tags.map((attributes) => attributes.match(/\bsrc="([^"]+)"/)[1]), SCRIPTS);
  assert.equal(tags[0], ' src="theme-init.js"');
  for (const attributes of tags.slice(1)) assert.match(attributes, /^ src="[^"]+" defer$/);
});

test('H: UMD globals, and the calculation reads no other file', () => {
  const globals = [['domino-core.js', 'DominoCore'], ['domino-data.js', 'DominoData'], ['domino-view.js', 'DominoView'],
    ['messages.js', 'DominoMessages']];
  for (const [file, name] of globals) {
    assert.match(read(file), new RegExp('root\\.' + name + ' = factory\\('), file);
    assert.equal(typeof require('../' + file), 'object', file);
  }
  assert.doesNotMatch(read('domino-core.js'), /\brequire\s*\(|\bimport\b|root\.Domino(?!Core\b)/);
  assert.match(read('domino-view.js'), /module\.exports = factory\(require\('\.\/domino-core\.js'\)\)/);
  assert.match(read('domino-view.js'), /root\.DominoView = factory\(root\.DominoCore\)/);
  for (const file of ['domino-data.js', 'messages.js']) assert.doesNotMatch(read(file), /\brequire\s*\(/, file);
});

test('H: no random numbers, network, HTML injection, inline styles or URL state in the scripts', () => {
  for (const file of SCRIPTS) {
    const code = read(file);
    assert.doesNotMatch(code, /Math\.random\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|innerHTML/, file);
    assert.doesNotMatch(code, /\.style\.|setAttribute\(\s*['"]style['"]/, file);
    assert.doesNotMatch(code, /history\.(?:pushState|replaceState)|location\.hash\s*=/, file);
  }
});

test('H: only the language and theme preferences are stored', () => {
  const code = SCRIPTS.map(read).join('\n');
  const keys = [...code.matchAll(/localStorage\.setItem\(\s*'([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(keys, ['account-domino-mapper.language', 'account-domino-mapper.theme']);
  assert.equal((code.match(/localStorage\.setItem\(/g) || []).length, 2, 'every stored key is a literal');
  assert.doesNotMatch(code, /sessionStorage|indexedDB|document\.cookie/);
  assert.match(read('style.css'), /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('H: no input fields: only radio and checkbox inputs would be allowed; no textarea or contenteditable', () => {
  for (const m of html.matchAll(/<input\b[^>]*>/g)) assert.match(m[0], /\btype="(?:radio|checkbox)"/, m[0]);
  assert.doesNotMatch(html, /<textarea|contenteditable/i);
  for (const file of SCRIPTS) {
    assert.doesNotMatch(read(file), /createElement\(\s*['"](?:input|textarea)['"]|contentEditable|contenteditable/, file);
  }
});

test('H: the step function is named stepReach', () => {
  assert.equal(typeof require('../domino-core.js').stepReach, 'function');
  for (const file of ['domino-core.js', 'domino-data.js', 'domino-view.js', 'app.js', 'messages.js', 'index.html']) {
    assert.doesNotMatch(read(file), /ripple/i, file);
  }
});

test('H: no local paths in index.html, the scripts and the tests', () => {
  const local = new RegExp(['D:[\\\\/]', 'C:[\\\\/]Users', 'ipusiron' + '-work', 'App' + 'Data'].join('|'));
  const files = ['index.html', ...fs.readdirSync(root).filter((f) => f.endsWith('.js')),
    ...fs.readdirSync(__dirname).filter((f) => /\.(js|py)$/.test(f)).map((f) => 'test/' + f)];
  assert.ok(files.includes('test/interface.browser.py'));
  for (const file of files) assert.doesNotMatch(read(file), local, file);
});

test('H: external links in index.html open in a new tab without opener or referrer', () => {
  const links = [...html.matchAll(/<a\b[^>]*\bhref="http[^"]*"[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length >= 1);
  for (const link of links) {
    assert.match(link, /\btarget="_blank"/, link);
    assert.match(link, /\brel="noopener noreferrer"/, link);
  }
});

test('H: the header has no decorative Day line, and the footer has the GitHub link only', () => {
  const header = html.slice(html.indexOf('<header class="page-header">'), html.indexOf('</header>'));
  assert.match(header, /<h1>Account Domino <span>Mapper<\/span><\/h1>/);
  assert.doesNotMatch(header, /day\s*\d|eyebrow|<p\b/i);
  const footer = html.match(/<footer>([\s\S]*?)<\/footer>/)[1];
  assert.equal(footer, '<a href="https://github.com/ipusiron/account-domino-mapper" data-i18n="footerLink" target="_blank" '
    + 'rel="noopener noreferrer">GitHub（ipusiron/account-domino-mapper）</a>');
  const M = require('../messages.js');
  assert.equal(M.ja.footerLink, 'GitHub（ipusiron/account-domino-mapper）');
  assert.equal(M.en.footerLink, 'GitHub (ipusiron/account-domino-mapper)');
});
