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

// The words and names the screen must not use. The data labels are the labels of credentials, accounts, entrances and cards and
// loss cards (the names and stories of the people are not shown; the screen uses messages.js for them).
const M = require('../messages.js');
const DATA = require('../domino-data.js');
const dataLabels = () => DATA.personas.flatMap((p) => [p.credentials, p.services, p.services.flatMap((s) => s.methods), p.cards, p.losses]
  .flat().flatMap((item) => [['label.ja', item.label.ja], ['label.en', item.label.en]]));
const allDataStrings = (value, at = 'personas') => (typeof value === 'string' ? [[at, value]]
  : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => allDataStrings(v, at + '.' + k)) : []);
const literal = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const FORBIDDEN_JA = [...['照合', '突き合わせ', '効く', '走る', '分かる', '既に', '全て', '初めて', '唯一', '世界初', 'どこにもない',
  'パスキーにすれば安全', 'パスキーなら乗っ取られない', '絶対に安全', '消せば安全', '外せば安全', '誰でも簡単', '被害額', '全滅', '致命的', '最悪',
  '危険', '急増', '42〜51', '42～51', '42-51', '見張', '結論は、', '乗っ取られ放題', '本人確認が甘い', '78%', '39/50', 'SMSを禁止', 'SMSは禁止',
  '秘密の質問を禁', '249件が乗っ取', '249件のアカウントが乗っ取', '83人分', 'パスキーが破られ', '再実装', '1,223万人のパスワード', '74%', '半数のサイト',
  'そのまま奪われ', '法律で義務', 'すべてパスキー必須', '9割', '診断でき', '深刻', '甚大', '壊滅', '一網打尽', '芋づる', '丸裸', '筒抜け', '向き', '表向き',
  '断定', '踏み込', '構図', '落とし穴', '破綻', '土台', '線引き', '定石', '核心', '素通り', '静かに', '黙って', '率直に', '正直に', '注目すべき',
  '重要なのは', 'ポイントは', '興味深い', '理由は、', '問題は、', 'まさに', '浮き彫り', '端的に', '決定的な', '無い', '様々', 'オススメ', '寄りかか']
  .map(literal), /(?<!最)初の/, /潰[さしすせそ]/, /(?<!変)更に/, /てみ[るたまよ]/];
const FORBIDDEN_EN = [...['first ever', 'first-ever', 'world\'s first', 'first tool', 'the only tool', 'only tool that', 'no other tool',
  'nowhere else', 'passkeys are safe', 'passkeys are secure', 'cannot be hijacked', 'completely safe', 'absolutely safe', 'perfectly safe',
  '100% safe', 'you are safe', 'makes you safe', 'anyone can easily', 'damage amount', 'wiped out', 'fatal', 'dangerous', 'catastroph',
  'skyrocket', 'diagnose your', '9 in 10', '78%', '39/50', '42–51', '42-51', 'free-for-all']
  .map((s) => new RegExp(literal(s).source, 'i')), /\bworst\b/i, /\bsurg(e|es|ed|ing)\b/i, /re-?implement/i, /half of (the )?sites/i];
// Joined at run time so that this file itself does not carry the words it looks for.
const HISTORY_WORDS = [['第', '1弾'], ['第', '2弾'], ['第', '1版'], ['第', '2版'], ['反', '証'], ['旧', '仮名'], ['（仮', '）'],
  ['provi', 'sional']].map((parts) => parts.join(''));
const REAL_CASE_SENSITIVE = ['LINE', 'Edge', 'Safari', 'Signal', 'Threads', 'Steam', 'Windows', 'Wired', 'Outlook'];
const REAL_EN = ['Gmail', 'Google', 'Apple', 'iCloud', 'Amazon', 'Microsoft', 'Chrome', 'Android', 'iPhone', 'Yahoo', 'Twitter', 'Facebook',
  'Instagram', 'Netflix', 'PayPay', 'docomo', 'au', 'KDDI', 'SBI', 'Palo Alto', 'Unit 42', 'AT&T', 'T-Mobile', 'Verizon', 'Tracfone', 'US Mobile',
  'Scattered Spider', 'eBay', 'Binance', 'Alexa', 'PayPal', 'Firefox', 'Mozilla', 'Dropbox', 'OneDrive', 'macOS', 'iOS', '1Password', 'Bitwarden',
  'LastPass', 'KeePass', 'Dashlane', 'Watchtower', 'Have I Been Pwned', 'HIBP', 'Authy', 'YubiKey', 'Okta', 'Nintendo', 'PlayStation', 'Sony',
  'YouTube', 'TikTok', 'Discord', 'WhatsApp', 'Hulu', 'Rakuten', 'Mercari', 'SoftBank', 'NTT', 'UQ', 'LINEMO', 'ahamo', 'povo', 'OCN', 'BIGLOBE',
  'nifty', 'Japan Post', 'AppleCare', 'me.com', 'Honan', 'Olshtein', 'BleepingComputer', 'ITmedia'];
const REAL_JA = ['楽天', 'メルカリ', 'ドコモ', 'ソフトバンク', '松井', 'マネックス', 'ゆうちょ', 'ゆうID', '日本郵政', '日本郵便', 'ゆうゆうポイント', '郵便局アプリ',
  'グーグル', 'アップル', 'アマゾン', 'マイクロソフト', 'ヤフー', 'ツイッター', 'フェイスブック', 'インスタグラム', 'ネットフリックス', 'ペイペイ', 'ワイモバイル',
  '三菱UFJ', '三井住友', 'みずほ', 'りそな', 'ソニー', '任天堂', 'ニフティ', 'ラクマ'];
const word = (name, flags) => new RegExp('(?<![A-Za-z0-9])' + literal(name).source + '(?![A-Za-z0-9])', flags);
const REAL_NAMES = [...REAL_CASE_SENSITIVE.map((n) => word(n, '')), ...REAL_EN.map((n) => word(n, 'i')), ...REAL_JA.map(literal)];
const messageValues = () => ['ja', 'en'].flatMap((lang) => Object.entries(M[lang]).map(([key, value]) => [lang + '.' + key, value]));
const htmlText = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');

test('H: no forbidden wording in messages.js and the data labels (the bibliography keys lessonRef… are the only exception)', (t) => {
  const allowed = [];
  const sources = [...messageValues(), ...dataLabels()];
  assert.ok(sources.length > 500);
  assert.ok(sources.filter(([where]) => /\.lesson\d/.test(where)).length >= 100, 'the lessons are checked too');
  for (const [where, value] of sources) {
    if (/\.lessonRef/.test(where)) {
      for (const re of [...FORBIDDEN_JA, ...FORBIDDEN_EN]) if (re.test(value)) allowed.push(where + ' ' + re.source);
      continue;
    }
    for (const re of FORBIDDEN_JA) assert.doesNotMatch(value, re, where);
    for (const re of FORBIDDEN_EN) assert.doesNotMatch(value, re, where);
  }
  // The words found in the bibliography (titles as published), the only place where they are allowed: none at present
  t.diagnostic(`forbidden words in the bibliography (lessonRef…): ${allowed.length} ${JSON.stringify(allowed)}`);
  assert.deepEqual(allowed, []);
  for (const source of [read('messages.js'), html]) for (const w of HISTORY_WORDS) assert.ok(!source.includes(w), w);
});

test('H: the screen says アカウント, not 口座 (only 証券口座 and 銀行口座 in the lessons)', () => {
  for (const [where, value] of messageValues()) {
    const key = where.split('.')[1];
    if (key.startsWith('lessonRef')) continue;
    const rest = key.startsWith('lesson') ? value.replace(/証券口座|銀行口座/g, '') : value;
    assert.ok(!rest.includes('口座'), where);
  }
  assert.ok(!htmlText.includes('口座'), 'index.html');
  for (const [where, value] of dataLabels()) assert.ok(!value.includes('口座'), where);
});

test('H: no real service, company or product names in messages.js or the data (bibliography keys lessonRef… excepted)', (t) => {
  const data = allDataStrings(DATA.personas);
  assert.ok(data.length > 300);
  for (const [where, value] of [...messageValues().filter(([where]) => !/\.lessonRef/.test(where)), ...data]) {
    for (const re of REAL_NAMES) assert.doesNotMatch(value, re, where);
  }
  for (const re of REAL_NAMES) assert.doesNotMatch(htmlText, re, 'index.html');
  // The names found in the bibliography (the authors' and publishers' names of the sources), the only place where they are allowed
  const found = [];
  for (const [where, value] of messageValues().filter(([where]) => /\.lessonRef/.test(where))) {
    for (const name of [...REAL_CASE_SENSITIVE, ...REAL_EN, ...REAL_JA]) {
      const re = REAL_JA.includes(name) ? literal(name) : word(name, REAL_CASE_SENSITIVE.includes(name) ? '' : 'i');
      if (re.test(value)) found.push(where + ': ' + name);
    }
  }
  t.diagnostic(`real names in the bibliography (lessonRef…): ${found.length} ${JSON.stringify(found)}`);
  assert.deepEqual([...new Set(found.map((f) => f.split(': ')[1]))].sort(),
    ['Amazon', 'Apple', 'Honan', 'Japan Post', 'Olshtein', 'Palo Alto', 'Unit 42', 'Wired', '日本郵政'].sort());
});

test('H: links made by app.js open in a new tab without opener or referrer, like the links of index.html', () => {
  const app = read('app.js');
  const anchors = [...app.matchAll(/E\('a',[^)]*\)/g)].map((m) => m[0]);
  assert.ok(anchors.length >= 1);
  for (const anchor of anchors) assert.match(anchor, /target: '_blank', rel: 'noopener noreferrer'/, anchor);
  assert.doesNotMatch(app, /window\.open\(|\.opener\b|createElement\(\s*['"]a['"]/);
  // The links of the lessons: HTTPS addresses kept in domino-view.js (no address is written in messages.js)
  assert.doesNotMatch(read('messages.js'), /https?:\/\//);
  const view = require('../domino-view.js');
  for (const href of [...Object.values(view.lessonRefs), ...view.relatedTools.map((tool) => tool.href)]) assert.match(href, /^https:\/\//);
});

test('H: the help has, in order, the first steps, the controls, the 22 terms, the ten lessons and the note on this learning aid', () => {
  const body = html.match(/<div class="help-body"[^>]*>([\s\S]*?)<\/div>\s*<\/dialog>/)[1];
  const order = [...body.matchAll(/data-i18n="(help\w+|lessonsHeading)"|<dl id="help-terms"|<div id="lessons"/g)].map((m) => m[1] || m[0]);
  assert.deepEqual(order, ['helpFirst', 'helpFirstText', 'helpKeysHeading', 'helpKeys', 'helpTermsHeading', '<dl id="help-terms"',
    'lessonsHeading', '<div id="lessons"', 'helpAboutHeading', 'helpAbout']);
  // Ten <details>, each with a summary (its title is written by app.js in the current language) and a body filled by app.js
  const lesson = /<details id="lesson-(\d+)" class="lesson"><summary><\/summary>\s*<div id="lesson-(\d+)-body" class="lesson-body"><\/div><\/details>/g;
  const lessons = [...body.matchAll(lesson)];
  assert.deepEqual(lessons.map((m) => [m[1], m[2]]), Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)]));
  assert.match(html, /<h3 id="lessons-heading" data-i18n="lessonsHeading">座学<\/h3>/);
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
