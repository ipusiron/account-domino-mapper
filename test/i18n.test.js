'use strict';
// H: the Japanese and English dictionaries, the first Japanese text in index.html and the roles of the attributes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../messages.js');
const D = require('../domino-data.js');
const V = require('../domino-view.js');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('index.html');
const sample = JSON.parse(read('test/sample.json'));
// Hiragana, katakana, CJK ideographs, CJK punctuation and full-width forms.
const JAPANESE = /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿！-｠]/;
const placeholders = (s) => [...s.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
const decode = (value) => value.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"')
  .replaceAll('&amp;', '&').trim();
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, name) => (name in values ? String(values[name]) : m));
// The 22 help terms in the order of the terms table, written out here rather than read from messages.js or index.html:
// key, then the term and its meaning in Japanese, then the term and its meaning in English.
const TERMS = [
  ['termAccount',
    'アカウント', 'メール・銀行・SNSなどの1つ。地図の表の1行（広い画面の図では、資格情報より右に並ぶ箱）',
    'Account', 'One email, bank, social media or other account; '
      + 'one row of the map table (a box to the right of the credentials in the diagram on wide screens)'],
  ['termEntrance',
    '入口', '1つのアカウントに入る手段。ログインの入口と復旧の入口がある',
    'Entrance', 'A way into one account: a log-in entrance or a recovery entrance'],
  ['termRequirement',
    '条件', '入口に要るもの。2つ以上なら「かつ」',
    'Requirement', 'What an entrance needs; two or more are joined by AND'],
  ['termAndOr',
    'かつ／または', '1つの入口の条件はすべて要る／入口はどれか1つ開けばよい',
    'AND / OR', 'Every requirement of one entrance is needed / any one entrance is enough'],
  ['termFamily',
    '系統', 'パスワードを色と英字で表したもの（赤A）。同じ系統は使い回し（少し変えたものを含む）',
    'Password family', 'A password shown as a color and a letter (Red A). The same family means reuse, small variations included'],
  ['termLineType',
    '線の種類', 'パスワードの系統・多要素・メール・SMS・窓口・紙の回復コードの6種',
    'Line type', 'Six kinds: password family, multi-factor, email, SMS, help desk and paper recovery codes'],
  ['termAttackCard',
    '攻撃カード', '攻撃者が最初に手にするもの（漏えい・SIMスワップ・メールの乗っ取り・窓口のなりすまし）',
    'Attack card', 'What the attacker starts with (breach, SIM swap, email takeover, help-desk impersonation)'],
  ['termFalls',
    '倒れる', '攻撃者がそのアカウントに入れるようになること',
    'Falls', 'The attacker can get into the account'],
  ['termStep',
    '段', '段0はカードが渡したもの。段rは、条件がすべて段r−1までにそろった入口で開いたもの',
    'Step', 'Step 0 is what the card gives. Step r is what opens through an entrance whose requirements were all met by step r−1'],
  ['termEntranceUsed',
    '開けた入口', 'そのアカウントを開いた入口',
    'Entrance used', 'The entrance that opened the account'],
  ['termBackdoor',
    '裏口', 'そのカードで倒れるが、復旧の入口をすべて外すと倒れないアカウント。開けた入口がログインでも、その条件のメールが復旧の線で倒れていれば裏口',
    'Backdoor', 'An account that falls to the card but would not fall if every recovery entrance were removed. '
      + 'This includes an account opened through log-in whose required email fell through a recovery line'],
  ['termLossCard',
    '喪失カード', '本人が失うもの（スマホをなくした・電話番号を手放した・メールが消えた・紙の回復コードをなくした）',
    'Loss card', 'What the owner loses (the phone, the phone number, an email account or the paper recovery codes)'],
  ['termLocked',
    '閉め出し（×）', '失ったあと、手元に残ったもので入れないこと',
    'Locked out (×)', 'After a loss, the owner cannot get in with what remains'],
  ['termGone',
    '消', 'メールのアカウントそのものが消えた状態。閉め出しには数えない',
    'Gone', 'The email account itself has disappeared; it is not counted as locked out'],
  ['termOneMore',
    'あと1つ失うと×', '○の後ろの「（＋番号で×）」。それも一緒に失うと入れない',
    'One more loss locks you out', 'The “(× if the number goes too)” after ○: losing that as well locks the owner out'],
  ['termTwoAtOnce',
    '2つ同時', '2つを同時に失ったときだけ閉め出される',
    'Two at once', 'Locked out only when two things are lost together'],
  ['termChange',
    '1手', '足す・付け替える・外すのどれか1つで、入口を1つ変える（条件が2つの入口を外すと、線は2本なくなる）',
    'One change', 'Add, replace or remove: one entrance changes (removing an entrance with two requirements removes two lines)'],
  ['termSaved',
    '守れた／新たに倒れる', '手の前は倒れ、手のあとは倒れない／その逆',
    'Saved / Newly fallen', 'Fell before the change but not after / the reverse'],
  ['termUnlocked',
    '解ける／新たに×', '手の前は閉め出され、手のあとは入れる／その逆',
    'Unlocked / Newly locked out', 'Locked out before the change but not after / the reverse'],
  ['termSum',
    '延べ', '4枚のカードごとに数えて足した数（同じアカウントを2回以上数えることがある）',
    'Sum over the four cards', 'Counted for each of the four cards and added up (the same account can be counted more than once)'],
  ['termImportant',
    '★', '重要なアカウント（並べ方で先に数える）',
    '★ Important', 'An important account (counted first when ranking)'],
  ['termHoldings',
    '手元', '本人が直接持つもの',
    'What the owner holds', 'What the owner holds directly'],
];

test('H: Japanese and English have the same keys and the same placeholders per key', () => {
  assert.deepEqual(Object.keys(M.ja).sort(), Object.keys(M.en).sort());
  for (const key of Object.keys(M.ja)) {
    assert.equal(typeof M.ja[key], 'string', key);
    assert.equal(typeof M.en[key], 'string', key);
    assert.ok(M.ja[key].trim() && M.en[key].trim(), key);
    assert.deepEqual(placeholders(M.ja[key]), placeholders(M.en[key]), key);
  }
});

test('H: English values contain no Japanese characters or full-width marks', () => {
  for (const [key, value] of Object.entries(M.en)) assert.doesNotMatch(value, JAPANESE, key);
});

test('H: index.html uses existing keys, and its first text equals the Japanese dictionary', () => {
  const keys = [...html.matchAll(/\bdata-i18n(?:-aria)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 50);
  for (const key of keys) assert.ok(Object.hasOwn(M.ja, key), key);
  const tags = [...html.matchAll(/<(?<tag>[a-z][a-z0-9]*)\b[^>]*\bdata-i18n="(?<key>[^"]+)"[^>]*>(?<text>[^<]*)<\/\k<tag>>/g)];
  assert.equal(tags.length, [...html.matchAll(/\bdata-i18n="/g)].length, 'every translated element has static text');
  for (const { groups } of tags) assert.equal(decode(groups.text), M.ja[groups.key], 'first Japanese text: ' + groups.key);
  // aria-labels start in Japanese; the two startup groups carry both languages until the application is ready.
  const labelled = [...html.matchAll(/<[a-z]+\b[^>]*\bdata-i18n-aria="([^"]+)"[^>]*>/g)];
  assert.ok(labelled.length >= 6);
  for (const m of labelled) {
    const label = decode((m[0].match(/\baria-label="([^"]*)"/) || [])[1] ?? '');
    assert.ok(label === M.ja[m[1]] || label === M.ja[m[1]] + ' / ' + M.en[m[1]], m[1] + ': ' + label);
  }
});

test('H: the help lists the 22 terms in order, each followed by its meaning, in Japanese and English', () => {
  assert.equal(TERMS.length, 22);
  const list = html.match(/<dl id="help-terms"[^>]*>([\s\S]*?)<\/dl>/)[1];
  const items = [...list.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)].map((m) => [m[1], (m[2].match(/\bdata-i18n="([^"]*)"/) || [])[1]]);
  assert.deepEqual(items, TERMS.flatMap(([key]) => [['dt', key], ['dd', key + 'Meaning']]));
  for (const [key, ja, jaMeaning, en, enMeaning] of TERMS) {
    assert.deepEqual([M.ja[key], M.ja[key + 'Meaning']], [ja, jaMeaning], key);
    assert.deepEqual([M.en[key], M.en[key + 'Meaning']], [en, enMeaning], key);
  }
});

test('H: the first person line is filled in, and the counts follow the data', () => {
  const families = (p) => new Set(p.credentials.filter((c) => c.type === 'pw').map((c) => c.family)).size;
  for (const p of sample.personas) {
    assert.deepEqual(V.counts(D.personas.find((x) => x.id === p.id)), { accounts: p.services.length, families: families(p) }, p.id);
  }
  const counts = (id) => V.counts(D.personas.find((p) => p.id === id));
  const worker = counts('worker');
  const first = fill(M.ja.personCounts, { n: worker.accounts, f: worker.families });
  assert.ok(html.includes('<p id="person-counts" class="person-counts">' + first + '</p>'));
  const parent = counts('parent');
  assert.equal(fill(M.en.personCounts, { n: parent.accounts, f: parent.families }),
    'Accounts: 7 · Password families: 1. These are fictional people; there are no fields for real account details.');
});

test('H: data-i18n, data-i18n-aria and data-label keep separate roles', () => {
  assert.doesNotMatch(html, /\bdata-label=/, 'stacked tables are built by JavaScript with the current language');
  const app = read('app.js');
  assert.match(app, /setAttribute\('aria-label', t\(el\.dataset\.i18nAria\)\)/);
  assert.doesNotMatch(app, /dataset\.label\b[^\n]*aria-label|aria-label[^\n]*dataset\.label\b/);
  for (const m of html.matchAll(/<[a-z]+\b[^>]*\baria-label="[^"]*"[^>]*>/g)) assert.match(m[0], /\bdata-i18n-aria="/, m[0]);
});

test('H: no half-width space between Japanese and Latin letters or digits in Japanese values', () => {
  const ja = '[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff]';
  const pattern = new RegExp(`${ja} [A-Za-z0-9]|[A-Za-z0-9] ${ja}`);
  for (const [key, value] of Object.entries(M.ja)) {
    if (key.startsWith('lessonRef')) continue;
    assert.doesNotMatch(value.replace(/ ?\{[a-zA-Z0-9_]+\} ?/g, '\u0000'), pattern, key);
  }
});
