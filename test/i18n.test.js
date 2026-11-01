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
    'アカウント', 'メール・銀行・SNSなどのアカウント1つ。地図の表の1行（広い画面の図では、左の列（パスワードやスマホなど）より右に並ぶ箱）',
    'Account', 'One email, bank, social media or other account; one row of the map table (in the diagram on wide screens, a box to the right of the left '
      + 'column of passwords, the phone and so on)'],
  ['termEntrance',
    '入口', '1つのアカウントに入る手段（ログインや復旧の方法）。ログインの入口と復旧の入口がある',
    'Entrance', 'A way into one account (a way to log in or recover): a log-in entrance or a recovery entrance'],
  ['termLine',
    '線', '図で、パスワードやメールなどの箱から、それを必要とする入口の行へ引いた線。実線はログイン、破線は復旧（広い画面の図だけ）',
    'Line', 'In the diagram, a line from a box (a password, an email and so on) to the row of an entrance that needs it. Solid = log-in, dashed = recovery '
      + '(wide screens only)'],
  ['termRequirement',
    '条件', '入口に入るのに必要なもの（パスワード・スマホ・SMSなど）。2つ以上あれば、すべて必要（かつ）。画面の文で「必要なもの」と書いているものと同じ',
    'Requirement', 'What an entrance needs (a password, the phone, SMS and so on). When there are two or more, all of them are needed (AND)'],
  ['termAndOr',
    'かつ／または', '1つの入口の条件はすべて要る／入口はどれか1つ開けばよい',
    'AND / OR', 'Every requirement of one entrance is needed / any one entrance is enough'],
  ['termFamily',
    'パスワードA・B・C',
    '人物ごとに、使っているパスワードに付けた記号。同じ記号は同じパスワード（少し変えただけのものを含む）。'
      + '変更で、そのアカウントだけに新しく作るパスワードは、まだ使っていない次の記号で表す（会社員ならD、高齢の親ならB、学生ならC）',
    'Password A, B, C',
    'Letters given to the passwords each person uses. The same letter means the same password (slight variations included). '
      + 'A new password made for one account only by a change is written with the next unused letter (D for the office worker, B for the older parent, '
      + 'C for the student)'],
  ['termAttackCard',
    '攻撃カード', '攻撃者が最初に手にするもの（漏えい・SIMスワップ・メールの乗っ取り・ソーシャルエンジニアリング）',
    'Attack card', 'What the attacker starts with (breach, SIM swap, email takeover, social engineering)'],
  ['termFalls',
    '倒れる', '攻撃者がそのアカウントに入れること',
    'Falls', 'The attacker can get into the account'],
  ['termStep',
    '段', '倒れていく順番。段0は攻撃者が最初に手にしたもの、段1はそれだけで倒れるアカウント、段2は段1までに倒れたものも使って倒れるアカウント（段3からも同じ）',
    'Step', 'The order of falling. Step 0 is what the attacker starts with, step 1 the accounts that fall with that alone, and step 2 the accounts that fall '
      + 'with the help of those that fell by step 1 (and so on)'],
  ['termEntranceUsed',
    '攻撃者が使った入口', '攻撃者がそのアカウントに入るのに使った入口（表のかっこの中と、図の「入られた」）',
    'Entrance the attacker used', 'The entrance through which the attacker got into the account (in brackets in the table, and “used” in the diagram)'],
  ['termBackdoor',
    '裏口', '復旧の入口を通って倒れたアカウント（途中のメールが復旧で倒れ、そのメールで入られた場合も含む）',
    'Backdoor', 'An account that fell through a recovery entrance (including one entered with an email that itself fell through recovery)'],
  ['termLossCard',
    '失うもの', 'なくしたり手放したりして、本人の手元からなくなるもの（スマホ・電話番号・メール・紙の回復コード）',
    'What the owner loses', 'What leaves the owner\'s hands because it is lost or given up (the phone, the phone number, an email account, the paper recovery '
      + 'codes)'],
  ['termLocked',
    '閉め出し（×）', '失ったあと、手元に残ったもので入れないこと',
    'Locked out (×)', 'After a loss, the owner cannot get in with what remains'],
  ['termGone',
    '消えた', 'メールのアカウントそのものがなくなった状態。閉め出しには数えない',
    'Gone', 'The email account itself no longer exists; it is not counted as locked out'],
  ['termOneMore',
    '△（あと1つ失うと×）', '閉め出しの表の印。いまは入れるが、もう1つ失うと入れなくなること（例：△（番号も失うと×））',
    '△ (one more loss locks you out)', 'A mark of the lockout table: the owner can get in now, but losing one more thing would lock them out (e.g. △ (× '
      + 'if the number goes too))'],
  ['termTwoAtOnce',
    '2つ同時', '2つを同時に失ったときだけ閉め出されること（1つだけなら入れる）',
    'Two at once', 'Locked out only when two things are lost together (losing one alone still lets the owner in)'],
  ['termChange',
    '変更', '入口を1つだけ変えること。ログインに認証アプリかパスキーを追加する、入口に必要なものを1つ切り替える、復旧の入口を1つ外す、の3種類',
    'Change', 'Changing just one entrance: adding an authenticator app or passkey to a log-in, switching one thing an entrance needs, or removing one '
      + 'recovery entrance'],
  ['termSaved',
    '守れた／新たに倒れる', '変更前は倒れ、変更後は倒れない／その逆',
    'Saved / Newly fallen', 'Fell before the change but not after / the reverse'],
  ['termUnlocked',
    '閉め出しがなくなる／閉め出しが増える', '変更前は入れず、変更後は入れる／その逆',
    'Lockout removed / Lockout added', 'Locked out before the change but not after / the reverse'],
  ['termSum',
    '4枚の合計', 'カード4枚それぞれで数えて足した数（1つのアカウントを最大4回数えるので、アカウントの数より大きくなることがある）',
    'Sum over the four cards', 'Counted for each of the four cards and added up (one account can be counted up to four times, so the sum can exceed the '
      + 'number of accounts)'],
  ['termImportant',
    '★', '重要なアカウント。人物ごとに、失うと困るものとして選んだ3つ（ふだん使うメールや、お金を扱うものなど）。上位の変更を並べるとき、守れる★の数を先に比べる',
    '★ Important', 'An important account: three per person, chosen as the ones they can least afford to lose (the main email, accounts that hold money, and '
      + 'so on). When top changes are ranked, the ★ accounts saved are compared first'],
  ['termHoldings',
    '手元', '本人が直接持っているもの（パスワード・スマホ・電話番号など）',
    'What the owner holds', 'What the owner holds directly (passwords, the phone, the phone number and so on)'],
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

// The one exception: the name of the language button on the English page starts with the word the button shows (日本語, which
// names Japanese in Japanese), because a name must start with the text shown (WCAG 2.5.3, label in name: a speech user says what
// they see). Only that first word may be Japanese; the rest of the name is English.
const LANGUAGE_LETTER = '日本語';
test('H: English values contain no Japanese characters or full-width marks (the letter at the start of the language button\'s '
  + 'name aside)', () => {
  for (const [key, value] of Object.entries(M.en)) {
    if (key === 'languageToggle') {
      assert.ok(value.startsWith(LANGUAGE_LETTER + ': '), key + ': ' + value);
      assert.doesNotMatch(value.slice(LANGUAGE_LETTER.length), JAPANESE, key);
    } else assert.doesNotMatch(value, JAPANESE, key);
  }
  // The Japanese page shows EN, and its name starts with EN as well
  assert.ok(M.ja.languageToggle.startsWith('EN：'), M.ja.languageToggle);
  // app.js writes exactly these two words on the button
  assert.match(read('app.js'), /\$\('language'\)\.textContent = state\.language === 'ja' \? 'EN' : '日本語';/);
});

test('H: index.html uses existing keys, and its first text equals the Japanese dictionary', () => {
  const keys = [...html.matchAll(/\bdata-i18n(?:-aria)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 50);
  for (const key of keys) assert.ok(Object.hasOwn(M.ja, key), key);
  // A static text may carry <wbr> (where a tab name may break between its words); it adds no character.
  const tags = [...html.matchAll(/<(?<tag>[a-z][a-z0-9]*)\b[^>]*\bdata-i18n="(?<key>[^"]+)"[^>]*>(?<text>(?:[^<]|<wbr>)*)<\/\k<tag>>/g)];
  assert.equal(tags.length, [...html.matchAll(/\bdata-i18n="/g)].length, 'every translated element has static text');
  for (const { groups } of tags) {
    assert.equal(decode(groups.text.replaceAll('<wbr>', '')), M.ja[groups.key], 'first Japanese text: ' + groups.key);
  }
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
  // The passwords of a person: how many, and their letters (A, B, C) in the order of the data
  const passwords = (p) => p.credentials.filter((c) => c.type === 'pw');
  for (const p of sample.personas) {
    assert.deepEqual(V.counts(D.personas.find((x) => x.id === p.id)), { accounts: p.services.length,
      families: new Set(passwords(p).map((c) => c.family)).size, symbols: passwords(p).map((c) => c.symbol) }, p.id);
  }
  const counts = (id) => V.counts(D.personas.find((p) => p.id === id));
  const worker = counts('worker');
  const first = fill(M.ja.personCounts, { n: worker.accounts, f: worker.families, symbols: worker.symbols.join(M.ja.sepList) });
  assert.equal(first, 'アカウント9つ・パスワード3つ（A・B・C）。架空の人物で、本物のアカウントの情報を入れる欄はありません。');
  assert.ok(html.includes('<p id="person-counts" class="person-counts">' + first + '</p>'));
  const parent = counts('parent');
  assert.equal(fill(M.en.personCounts, { n: parent.accounts, f: parent.families, symbols: parent.symbols.join(M.en.sepList) }),
    'Accounts: 7 · Passwords: 1 (A). These are fictional people; there are no fields for real account details.');
});

test('H: data-i18n, data-i18n-aria and data-label keep separate roles', () => {
  assert.doesNotMatch(html, /\bdata-label=/, 'stacked tables are built by JavaScript with the current language');
  const app = read('app.js');
  assert.match(app, /setAttribute\('aria-label', t\(el\.dataset\.i18nAria\)\)/);
  assert.doesNotMatch(app, /dataset\.label\b[^\n]*aria-label|aria-label[^\n]*dataset\.label\b/);
  for (const m of html.matchAll(/<[a-z]+\b[^>]*\baria-label="[^"]*"[^>]*>/g)) assert.match(m[0], /\bdata-i18n-aria="/, m[0]);
});

test('H: rule 5 says that a breach card stands for a password leaked as-is, in plain text', () => {
  assert.ok(M.ja.rule5.includes('そのまま（平文で）出回った'), M.ja.rule5);
  assert.ok(M.en.rule5.includes('leaked as-is'), M.en.rule5);
  // The rules table of index.html carries rule 5 (its first text is the Japanese one; render() puts the current language)
  assert.match(html, /<td data-i18n="rule5">[^<]*そのまま（平文で）出回った[^<]*<\/td>/);
});

test('H: no half-width space between Japanese and Latin letters or digits in Japanese values', () => {
  const ja = '[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff]';
  const pattern = new RegExp(`${ja} [A-Za-z0-9]|[A-Za-z0-9] ${ja}`);
  for (const [key, value] of Object.entries(M.ja)) {
    if (key.startsWith('lessonRef')) continue;
    assert.doesNotMatch(value.replace(/ ?\{[a-zA-Z0-9_]+\} ?/g, '\u0000'), pattern, key);
  }
});
