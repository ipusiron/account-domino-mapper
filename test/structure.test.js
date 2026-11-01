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
    assert.doesNotMatch(code, /location\.hash\s*=|location\.(?:assign|replace)\s*\(|location\.href\s*=/, file);
    if (file !== 'app.js') assert.doesNotMatch(code, /history\.(?:pushState|replaceState)/, file);
  }
  // The address keeps the tab only (#chain, #lockout, #compare or #rules), so that the
  // browser's back button returns to the tab before. app.js writes the history in one function: a new entry with the tab in the
  // address, or the current entry without changing the address. The highlight, the place and the focus stay in the entry (never
  // stored, never in the address).
  const app = read('app.js');
  assert.deepEqual([...app.matchAll(/history\.(pushState|replaceState)\(([^)]*)\)/g)].map((m) => m[1] + '(' + m[2] + ')'),
    ["pushState(entry, '', '#' + entry.tab)", "replaceState(entry, '')"]);
  assert.match(app, /const hashTab = \(\) => \(TABS\.includes\(location\.hash\.slice\(1\)\) \? location\.hash\.slice\(1\) : null\);/);
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

// Local paths, in any case: a drive letter (a letter, a colon, then a slash or a backslash; not the end of a scheme such as
// https://), an MSYS drive (a slash, one letter and a slash with a name after it, as Git Bash writes a Windows drive) that is not
// part of an http(s) address or of another path (the character before it is not a letter, digit or one of . _ ~ % / -), and the
// work folders of this machine by name. The http(s) addresses are blanked out (with spaces, so that the positions stay) before
// the MSYS form is looked for. An address is made of letters, digits and -._~:/?#[]@!$&()*+,;=% (the ASCII characters an
// address may hold, but the quote '), so it ends at a space, a quote or a Japanese character: a Japanese sentence that goes on
// right after an address or a link, without a space, is still read. Returns the first one found as a match (with its index), or null. The
// examples of the next test are written in pieces, so that this file does not carry the paths it looks for.
const DRIVE = /(?<![A-Za-z0-9])[A-Za-z]:[\\/]/;
const MSYS_DRIVE = /(?<![\w.~%/-])\/[A-Za-z]\/(?=[^\s/])/;
const WORK_FOLDERS = new RegExp(['ipusiron' + '-work', 'App' + 'Data'].join('|'), 'i');
const ADDRESS = /https?:\/\/[\w\-.~:\/?#[\]@!$&()*+,;=%]+/gi;
function localPath(text) {
  const blanked = text.replace(ADDRESS, (address) => ' '.repeat(address.length));
  return text.match(DRIVE) || blanked.match(MSYS_DRIVE) || text.match(WORK_FOLDERS);
}

test('H: the check for local paths finds drive letters, MSYS drives and the work folders in any case, also right after an address '
  + 'in a Japanese sentence, and leaves addresses alone', () => {
  const slash = (...parts) => parts.join('/'), back = (...parts) => parts.join('\\');
  const found = [slash('', 'c', 'Users', 'alice', 'x'), slash('', 'D', 'work', 'x'), 'cd ' + slash('', 'd', 'projects', 'tool'),
    '（' + slash('', 'e', '作業', 'x') + '）', '`' + slash('', 'c', 'Users', 'a') + '`', 'path=' + slash('', 'c', 'x'),
    'see https://example.com/ and ' + slash('', 'c', 'x'), back('C:', 'Users', 'x'), slash('d:', 'work'), slash('file:', '', '', 'E:', 'x'),
    'x ' + 'ipusiron' + '-work', 'App' + 'data',
    // Japanese right after a link or an address (no space), and a quote that ends an address in code
    '[x](' + slash('https:', '', 'example.com', '') + ')の写しは' + slash('', 'd', 'try200', 'x'),
    '// 手順は' + slash('https:', '', 'example.com', '') + 'の通りで、写しは' + slash('', 'd', 'try200', 'x', 'y'),
    '出典：[M](' + slash('https:', '', 'example.org', 'x') + ')、手元では' + slash('', 'c', 'Users', 'alice', 'x'),
    '[\'' + slash('https:', '', 'example.com', 'a') + '\',\'' + slash('', 'c', 'Users', 'x') + '\']'];
  const kept = [slash('https:', '', 'example.com', 'c', 'x'), '[link](' + slash('https:', '', 'example.com', 'c', 'x') + ')',
    '[x](' + slash('https:', '', 'example.com', 'c', 'x') + ')の写し', slash('https:', '', 'example.com', 'd', 'x') + '、手順',
    slash('https:', '', 'example.com', 'search?q=') + slash('', 'c', 'x'), slash('http:', '', '127.0.0.1:8000', 'D', 'x'),
    slash('HTTPS:', '', 'example.com', 'C', 'Users'), 'AND/OR', 'and/or', 'A/B', '1/2/3', 'assets/en/screenshot.png',
    '.github/workflows/test.yml', 'file://', 'Day124/Day125', slash('https:', '', 'doi.org', '10.1016', '0743-1066(84)90014-1')];
  for (const text of found) assert.notEqual(localPath(text), null, 'found: ' + text);
  for (const text of kept) assert.equal(localPath(text), null, 'left alone: ' + text);
  assert.equal(localPath('（' + slash('', 'c', 'x') + '）').index, 1, 'the index of the path');
});

// Every text file of the repository: all files but the PNGs, and the READMEs, which the README check below reads line by line
// (.git is left out: a folder, or a file in a linked work tree)
function textFiles(dir = root, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.name !== '.git').flatMap((entry) => {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) return textFiles(path.join(dir, entry.name), relative + '/');
    return /\.png$/i.test(entry.name) || /^README(?:\.en)?\.md$/.test(relative) ? [] : [relative];
  });
}

test('H: no local paths in index.html, the scripts, the style, the tests and the other text files of the repository', () => {
  const files = textFiles();
  for (const file of ['index.html', 'style.css', 'app.js', 'package.json', '.github/workflows/test.yml', 'test/interface.browser.py',
    'test/structure.test.js', 'test/vectors.json']) assert.ok(files.includes(file), file);
  for (const file of files) {
    const m = localPath(read(file));
    assert.equal(m, null, m && `${file}: ${m[0]} | ${m.input.slice(Math.max(0, m.index - 40), m.index + 40)}`);
  }
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

// The map after a change (tab 3): app.js keeps its steps and its diagram in the two caches made by View.recentCache (the part that
// view.test checks: the eight entries used last), keyed per person, change and card and per person, change and language, and
// makes them nowhere else. A cache of its own in app.js (one that drops the oldest entry, say) would pass the heap check of the
// browser, so the source is read here.
test('H: app.js keeps the steps and the diagram after a change in two caches of View.recentCache (eight entries each, keyed per '
  + 'person, change and card / language) and makes them nowhere else', () => {
  const app = read('app.js');
  assert.match(app, /\bconst AFTER_CACHE_SIZE = 8;/);
  assert.deepEqual([...app.matchAll(/\bconst (\w+) = View\.recentCache\(AFTER_CACHE_SIZE\);/g)].map((m) => m[1]),
    ['afterCache', 'afterLayoutCache']);
  assert.equal((app.match(/recentCache\(/g) || []).length, 2, 'View.recentCache is used for these two only');
  assert.ok(app.includes("return afterCache(id + '|' + moveId + '|' + card, () => View.afterMap(persona(id), moveId, card));"),
    'the steps after a change, per person, change and card');
  assert.ok(app.includes("return afterLayoutCache(id + '|' + moveId + '|' + language, () => View.layout(persona(id), q, Messages, language));"),
    'the diagram after a change, per person, change and language');
  // The steps after a change come only through afterCache; the other View.layout draws a person without a change (per person and
  // language, in the Map layoutCache next to the Map of personaVectors)
  assert.equal((app.match(/View\.afterMap\(/g) || []).length, 1, 'View.afterMap only inside afterFor');
  assert.equal((app.match(/View\.layout\(/g) || []).length, 2, 'View.layout in layoutFor and afterLayoutFor only');
  assert.ok(app.includes('layoutCache.set(key, View.layout(persona(id), null, Messages, language))'), 'the diagram without a change');
  assert.equal([...app.matchAll(/\bnew (?:Weak)?Map\(/g)].length, 2, 'no other Map');
  assert.deepEqual([...app.matchAll(/\bconst (\w+) = new Map\(\);/g)].map((m) => m[1]), ['vectorsCache', 'layoutCache']);
  // Tab 3 draws the map after a change from them, with the map's own card (state.mapCard, apart from the card of tab 1)
  assert.match(app, /= afterFor\(state\.persona, state\.move, state\.mapCard\);/);
  assert.match(app, /= afterLayoutFor\(state\.persona, state\.move, state\.language, after\.person\);/);
});

// The map after a change keeps its own card and its own chosen account. Nothing in tab 3
// writes the card or the account of "Follow the chain": the card is set in setCard only (tab 1's cards, a highlight of tab 1), the
// account by the person, a name of tab 1 and a highlight; the map's card and account are set when a change is shown (setMove) and by
// the map's own controls
test('H: the map after a change has its own card and account; tab 3 never changes the card or the account of "Follow the chain"', () => {
  const app = read('app.js');
  const assigned = (name) => [...app.matchAll(new RegExp('state\\.' + name + ' = ([^;]+);', 'g'))].map((m) => m[1]);
  assert.deepEqual(assigned('card'), ['card']);
  assert.deepEqual(assigned('account'), ['DEFAULT_ACCOUNT[id]', 'id', 's.account']);
  assert.deepEqual(assigned('mapCard'), ['View.afterCardFor(p, pv, id, state.mode)', 'card']);
  assert.deepEqual(assigned('mapAccount'), ['pv.moves.find((mv) => mv.id === id).service', 'id']);
  // setCard is called by tab 1's card buttons and by a highlight that names a card (W1, P1, S1, S2: none of them in tab 3)
  assert.equal((app.match(/\bsetCard\(/g) || []).length, 3, 'the definition, selectCard and pressHighlight');
  const view = require('../domino-view.js');
  for (const h of view.highlights.filter((x) => x.state.tab === 'compare')) assert.equal(h.state.card, undefined, h.id);
  // The four card buttons of the map are its own (after-card-…), in the order of tab 1's
  const cards = (prefix) => [...html.matchAll(new RegExp('<button id="' + prefix + '-(\\w+)"', 'g'))].map((m) => m[1]);
  assert.deepEqual(cards('after-card'), cards('card'));
  assert.deepEqual(cards('after-card'), ['leak', 'simswap', 'mail', 'desk']);
});

test('H: the help has, in order, the buttons to its sections, the first steps, the controls, the 22 terms, the ten lessons and the note '
  + 'on this learning aid', () => {
  const body = html.match(/<div class="help-body"[^>]*>([\s\S]*?)<\/div>\s*<\/dialog>/)[1];
  const order = [...body.matchAll(/data-i18n="(help\w+|lessonsHeading)"|<dl id="help-terms"|<div id="lessons"/g)].map((m) => m[1] || m[0]);
  assert.deepEqual(order, ['helpNavLabel', 'helpNavFirst', 'helpNavOps', 'helpNavTerms', 'helpNavLessons', 'helpNavAbout', 'helpFirst',
    'helpFirstText', 'helpKeysHeading', 'helpOpsPerson', 'helpOpsChain', 'helpOpsLockout', 'helpOpsCompare', 'helpOpsRules', 'helpOpsHelp', 'helpKeys',
    'helpTermsHeading', '<dl id="help-terms"', 'lessonsHeading', '<div id="lessons"', 'helpAboutHeading', 'helpAbout']);
  // Each button at the top moves to a heading of the help (the heading can take the focus)
  const targets = [...body.matchAll(/<button type="button" data-target="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(targets, ['help-first', 'help-ops', 'help-terms-heading', 'lessons-heading', 'help-about']);
  for (const id of targets) assert.match(body, new RegExp('<h3 id="' + id + '" tabindex="-1"'), id);
  // Ten <details>, each with a summary (its title is written by app.js in the current language) and a body filled by app.js
  const lesson = /<details id="lesson-(\d+)" class="lesson"><summary><\/summary>\s*<div id="lesson-(\d+)-body" class="lesson-body"><\/div><\/details>/g;
  const lessons = [...body.matchAll(lesson)];
  assert.deepEqual(lessons.map((m) => [m[1], m[2]]), Array.from({ length: 10 }, (_, i) => [String(i + 1), String(i + 1)]));
  assert.match(html, /<h3 id="lessons-heading" tabindex="-1" data-i18n="lessonsHeading">座学<\/h3>/);
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

// The shared summary (OGP) read by sites that do not run JavaScript: the six tags, each once in <head>. The description is the
// description_ja of the README front matter, the same as the meta description. The scripts never rewrite them.
const DESCRIPTION_JA = '架空の3人のアカウントで、1つの攻撃（漏えい・SIMスワップ・メールの乗っ取り・ソーシャルエンジニアリング）が、ログインや復旧を'
  + '通じて広がる様子を順に見る教材。スマホ・電話番号・メールを失ったときの閉め出しと、入口を1つ変えたとき（認証アプリかパスキーを追加する・必要なものを'
  + '切り替える・復旧の入口を外す）の前後も比べられる。自分のアカウントの情報は入力せず、外部へは何も送らない。日英対応。';
const OGP = [['property', 'og:title', 'Account Domino Mapper'], ['property', 'og:description', DESCRIPTION_JA],
  ['property', 'og:url', 'https://ipusiron.github.io/account-domino-mapper/'],
  ['property', 'og:image', 'https://ipusiron.github.io/account-domino-mapper/assets/screenshot.png'],
  ['property', 'og:type', 'website'], ['name', 'twitter:card', 'summary_large_image']];
const entities = (value) => value.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');
const metas = (source) => [...source.matchAll(/<meta\b([^>]*)>/g)].map((m) => Object.fromEntries(
  [...m[1].matchAll(/([a-z:-]+)="([^"]*)"/g)].map((a) => [a[1], entities(a[2])])));

test('H: the six OGP tags (og:title, og:description, og:url, og:image, og:type, twitter:card), each once in <head>', () => {
  const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
  const all = metas(html), inHead = metas(head);
  for (const [attribute, key, value] of OGP) {
    const found = all.filter((tag) => tag.property === key || tag.name === key);
    assert.equal(found.length, 1, key + ' exactly once');
    assert.equal(found[0][attribute], key, key + ' is given by the ' + attribute + ' attribute');
    assert.equal(found[0].content, value, key);
    assert.equal(inHead.filter((tag) => tag[attribute] === key).length, 1, key + ' in <head>');
  }
  assert.equal(all.filter((tag) => /^(?:og|twitter):/.test(tag.property || tag.name || '')).length, OGP.length, 'no other og: or twitter: tag');
  const description = all.filter((tag) => tag.name === 'description');
  assert.equal(description.length, 1);
  assert.equal(description[0].content, DESCRIPTION_JA, 'the meta description and og:description are the same text');
  // Switching the language keeps the shared summary as written: no script names a meta tag, the description or the head
  // (the browser check reads the tags again after a language switch)
  for (const file of SCRIPTS) {
    assert.doesNotMatch(read(file), /\b(?:og|twitter):[a-z]|<meta\b|['"]meta['"]|meta\[|description|document\.head\b|getElementsByName/i, file);
  }
});

test('H: og:description and the meta description are the description_ja of the README.md front matter', () => {
  const front = read('README.md').match(/^<!--[ \t]*\r?\n---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n!?-->/);
  assert.ok(front, 'README.md starts with the front matter inside an HTML comment');
  const line = front[1].split(/\r?\n/).filter((l) => l.startsWith('description_ja:'));
  assert.equal(line.length, 1, 'one description_ja');
  const value = line[0].match(/^description_ja: "(.*)"\s*$/);
  assert.ok(value, 'description_ja is double-quoted: ' + line[0]);
  for (const key of ['description', 'og:description']) {
    assert.equal(metas(html).find((tag) => tag.name === key || tag.property === key).content, value[1], key);
  }
});

// README.md and README.en.md: the forbidden wording (the Japanese list for README.md, the English list for README.en.md), and in
// both the words of how the work went, the word ripple and local paths. A hit names its file, line and word. No line of the
// READMEs is left out (the bibliography keys lessonRef… of messages.js are the only place where forbidden words may appear).
// The words of how the work went: those of the screen, and those of the reviews and the steps of the work, with the ids of
// review findings (joined at run time so that this file does not carry the words it looks for)
const README_HISTORY = [...HISTORY_WORDS, ...[['査', '読'], ['点', '検'], ['外部', 'レビュー'], ['本人の', '決定'], ['段階', '1'], [String.fromCodePoint(0x6e1a)],
  ['Co', 'dex'], ['external ', 'review'], ['internal ', 'review']].map((parts) => parts.join(''))];
const README_COMMON = [...README_HISTORY.map((w) => new RegExp(literal(w).source, 'i')), /ripple/i,
  /\b(?:O|SP|T|IT|CR|SPEC|R1B|C1b|S1C|ST)-\d{2}\b/,
  // Local paths in any case (localPath above: a drive letter, an MSYS drive outside the http(s) addresses, the work folders)
  localPath];
// The screen calls the checkups of other tools 点検 (the title and the second paragraph of lesson 10), a word that this
// check of the READMEs counts among the words of how the work went. A README may quote those sentences of the screen word
// for word: each quote is taken out of its line before the patterns are looked for, so the word anywhere else in the line
// is still found. The screen sentences themselves are checked with messages.js above.
const screenQuotes = (lang) => Object.entries(M[lang])
  .filter(([, value]) => README_HISTORY.some((w) => value.toLowerCase().includes(w.toLowerCase())));
// A pattern is a regular expression, or a function (localPath) that returns a match like String.prototype.match
const matchOf = (text, pattern) => (typeof pattern === 'function' ? pattern(text) : text.match(pattern));
function readmeHits(file, patterns, joiner, quotes = []) {
  const lines = read(file).split(/\r?\n/);
  const text = lines.map((line) => quotes.reduce((rest, quote) => rest.split(quote).join('\u0000'), line));
  const hits = [];
  text.forEach((line, i) => {
    for (const re of patterns) {
      let m = matchOf(line, re);
      // A phrase broken over two lines is reported on the line where it starts
      if (!m && i + 1 < text.length) {
        const joined = matchOf(line + joiner + text[i + 1], re);
        if (joined && joined.index < line.length) m = joined;
      }
      if (m) hits.push(`${file}:${i + 1}: ${m[0]} | ${lines[i].trim().slice(0, 100)}`);
    }
  });
  return hits;
}

test('H: no forbidden wording, history words, ripple or local paths in README.md and README.en.md', (t) => {
  // The quotes allowed: lesson 10 alone (its title and second paragraph in Japanese); none in English
  assert.deepEqual(screenQuotes('ja').map(([key]) => key), ['lesson10Title', 'lesson10Text2']);
  assert.deepEqual(screenQuotes('en'), []);
  const quotes = (lang) => screenQuotes(lang).map(([, value]) => value);
  const hits = [...readmeHits('README.md', [...FORBIDDEN_JA, ...README_COMMON], '', quotes('ja')),
    ...readmeHits('README.en.md', [...FORBIDDEN_EN, ...README_COMMON], ' ', quotes('en'))];
  t.diagnostic(`patterns: README.md ${FORBIDDEN_JA.length + README_COMMON.length}, README.en.md ${FORBIDDEN_EN.length
    + README_COMMON.length}; no line left out`);
  assert.deepEqual(hits, [], 'forbidden wording in the READMEs:\n' + hits.join('\n'));
});

// ===== タブ2・タブ4・ヘルプ・印刷 =====
test('H: the buttons at the top of the rules tab move to its sections, each of which can take the focus; the print button and the '
  + 'lockout legend are in place', () => {
  const start = html.indexOf('<section id="panel-rules"');
  const panel = html.slice(start, html.indexOf('</section>', start));
  const targets = [...panel.matchAll(/<button type="button"[^>]*\bdata-target="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(targets, ['rules-table', 'symbol-table', 'notes-heading', 'paper-heading']);
  for (const id of targets) {
    assert.match(panel, new RegExp('\\bid="' + id + '"[^>]*\\btabindex="-1"|\\btabindex="-1"[^>]*\\bid="' + id + '"'), id);
  }
  assert.match(panel, /<button id="print-button" class="print-button"/);
  const lockout = html.slice(html.indexOf('<section id="panel-lockout"'), html.indexOf('<section id="panel-compare"'));
  for (const id of ['lock-legend-mail', 'lock-legend-marks', 'lock-story', 'lock-map']) assert.ok(lockout.includes('id="' + id + '"'), id);
  assert.ok(!html.includes('id="lock-entrances"'), 'the entrances go under the row chosen, not under the table');
});
