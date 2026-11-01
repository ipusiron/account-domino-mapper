'use strict';
// G: the sentences built by domino-view.js (known sentences, the forms with two or more groups, and every change in both languages).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../domino-core.js');
const D = require('../domino-data.js');
const V = require('../domino-view.js');
const M = require('../messages.js');
const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors.json'), 'utf8'));

const PEOPLE = ['worker', 'parent', 'student'];
const persona = (id) => D.personas.find((p) => p.id === id);
const cache = {};
const pv = (id) => (cache[id] ||= C.personaVectors(persona(id)));
const move = (id, moveId) => pv(id).moves.find((m) => m.id === moveId);
const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/;
const ONE_PLURAL = /\b1 (?:accounts|password families|families|cards|changes|lockouts|entrances|lines|steps)\b/;

// The known cells of the usual lockout tables: person, column (loss card), account, Japanese, English.
const USUAL_CELLS = [
  ['worker', 'device', 'bank', '△（番号も失うと×）', '△ (× if the number goes too)'],
  ['worker', 'device', 'sec', '△（番号も失うと×）', '△ (× if the number goes too)'],
  ['worker', 'number', 'bank', '△（スマホも失うと×）', '△ (× if the phone goes too)'],
  ['worker', 'number', 'sec', '△（スマホも失うと×）', '△ (× if the phone goes too)'],
  ['parent', 'device', 'bank', '△（番号も失うと×）', '△ (× if the number goes too)'],
  ['parent', 'device', 'msg', '△（番号も失うと×）', '△ (× if the number goes too)'],
  ['parent', 'device', 'sec', '△（番号かプロバイダーのメールも失うと×）', '△ (× if the number or the ISP email goes too)'],
  ['parent', 'number', 'msg', '△（スマホも失うと×）', '△ (× if the phone goes too)'],
  ['parent', 'number', 'sec', '△（スマホも失うと×）', '△ (× if the phone goes too)'],
  ['parent', 'mail', 'bank', '△（番号も失うと×）', '△ (× if the number goes too)'],
  ['parent', 'mail', 'sec', '△（スマホも失うと×）', '△ (× if the phone goes too)'],
  ['student', 'device', 'sub', '△（大学のメールも失うと×）', '△ (× if the university email goes too)'],
  ['student', 'number', 'sub', '△（大学のメールも失うと×）', '△ (× if the university email goes too)'],
];
// The known two-at-once lines of the changes: person, change, Japanese, English.
const PAIR_LINES = [
  ['worker', 'replace:sns.recMail:mailMain>mailOld',
    '番号と古いメールを一緒に失うと、SNSに入れなくなる',
    'Losing the number and the old email together now locks you out of Social media'],
  ['worker', 'replace:sns.recMail:mailMain>paper:sns',
    '番号と紙の回復コードを一緒に失うと、SNSに入れなくなる',
    'Losing the number and the paper codes together now locks you out of Social media'],
  ['worker', 'replace:flea.recMail:mailMain>mailOld',
    '番号と古いメールを一緒に失うと、フリマアプリ（売上金）に入れなくなる',
    'Losing the number and the old email together now locks you out of Flea-market app (sales balance)'],
  ['worker', 'replace:cloud.recMail:mailMain>mailOld',
    'スマホと古いメールを一緒に失うと、写真のクラウドに入れなくなる',
    'Losing the phone and the old email together now locks you out of Photo cloud'],
  ['worker', 'replace:cloud.recMail:mailMain>paper:cloud',
    'スマホと紙の回復コードを一緒に失うと、写真のクラウドに入れなくなる',
    'Losing the phone and the paper codes together now locks you out of Photo cloud'],
  ['worker', 'replace:bank.recSmsDesk:phone>paper:bank',
    '一緒に失うとネット銀行に入れなくなる組み合わせが、「スマホと番号」から「スマホと紙の回復コード」に変わる',
    'The pair of losses that locks you out of Online bank changes from the phone and the number to the phone and the paper codes'],
  ['worker', 'replace:bank.recSmsDesk:phone>idcheck',
    'ネット銀行は、スマホと番号を一緒に失っても入れる（変更前は入れなかった）',
    'You can now get into Online bank even after losing the phone and the number together; before the change, you could not'],
  ['worker', 'replace:bank.recSmsDesk:info>paper:bank',
    'スマホと紙の回復コードを一緒に失うと、ネット銀行に入れなくなる',
    'Losing the phone and the paper codes together now locks you out of Online bank'],
  ['worker', 'replace:sec.recMailSms:mailMain>mailOld',
    'スマホと古いメールを一緒に失うと、ネット証券に入れなくなる',
    'Losing the phone and the old email together now locks you out of Online brokerage'],
  ['worker', 'replace:sec.recMailSms:mailMain>paper:sec',
    'スマホと紙の回復コードを一緒に失うと、ネット証券に入れなくなる',
    'Losing the phone and the paper codes together now locks you out of Online brokerage'],
  ['worker', 'replace:sec.recMailSms:phone>paper:sec',
    '一緒に失うとネット証券に入れなくなる組み合わせが、「スマホと番号」から「スマホと紙の回復コード」に変わる',
    'The pair of losses that locks you out of Online brokerage changes from the phone and the number to the phone and the paper codes'],
  ['worker', 'replace:sec.recMailSms:phone>idcheck',
    'ネット証券は、スマホと番号を一緒に失っても入れる（変更前は入れなかった）',
    'You can now get into Online brokerage even after losing the phone and the number together; before the change, you could not'],
  ['parent', 'add:shop.login:+device',
    'スマホとプロバイダーのメールを一緒に失うと、通販に入れなくなる',
    'Losing the phone and the ISP email together now locks you out of Online shop'],
  ['parent', 'add:photo.login:+device',
    'スマホとプロバイダーのメールを一緒に失うと、写真のクラウドに入れなくなる',
    'Losing the phone and the ISP email together now locks you out of Photo cloud'],
  ['parent', 'replace:sec.recMailSms:mailIsp>paper:sec',
    '一緒に失うとネット証券（NISA）に入れなくなる組み合わせが、「スマホとプロバイダーのメール」から「スマホと紙の回復コード」に変わる',
    'The pair of losses that locks you out of Online brokerage (NISA) changes from the phone and the ISP email to the phone and the paper codes'],
  ['parent', 'replace:sec.recMailSms:phone>paper:sec',
    '一緒に失うとネット証券（NISA）に入れなくなる組み合わせが、「スマホと番号」から「スマホと紙の回復コード」に変わる',
    'The pair of losses that locks you out of Online brokerage (NISA) changes from the phone and the number to the phone and the paper codes'],
  ['parent', 'replace:sec.recMailSms:phone>idcheck',
    'ネット証券（NISA）は、スマホと番号を一緒に失っても入れる（変更前は入れなかった）',
    'You can now get into Online brokerage (NISA) even after losing the phone and the number together; before the change, you could not'],
  ['student', 'add:sns.login:+device',
    'スマホと大学のメールを一緒に失うと、SNSに入れなくなる',
    'Losing the phone and the university email together now locks you out of Social media'],
  ['student', 'replace:flea.recMail:mailFree>mailUni',
    '番号と大学のメールを一緒に失うと、フリマアプリに入れなくなる',
    'Losing the number and the university email together now locks you out of Flea-market app'],
  ['student', 'replace:sec.recMail:mailFree>mailUni',
    'スマホと大学のメールを一緒に失うと、ネット証券（つみたて）に入れなくなる',
    'Losing the phone and the university email together now locks you out of Online brokerage (monthly investing)'],
  ['student', 'replace:sec.recMail:mailFree>paper:sec',
    'スマホと紙の回復コードを一緒に失うと、ネット証券（つみたて）に入れなくなる',
    'Losing the phone and the paper codes together now locks you out of Online brokerage (monthly investing)'],
];
// The changes after which the lockout table shows the paper codes as a partner (worker 6, parent 2, student 1).
const PAPER_PARTNER_MOVES = {
  worker: ['replace:sns.recMail:mailMain>paper:sns', 'replace:cloud.recMail:mailMain>paper:cloud', 'replace:bank.recSmsDesk:phone>paper:bank',
    'replace:bank.recSmsDesk:info>paper:bank', 'replace:sec.recMailSms:mailMain>paper:sec', 'replace:sec.recMailSms:phone>paper:sec'],
  parent: ['replace:sec.recMailSms:mailIsp>paper:sec', 'replace:sec.recMailSms:phone>paper:sec'],
  student: ['replace:sec.recMail:mailFree>paper:sec'],
};

test('G: the known cells of the usual lockout tables (13), and no other cell has a partner', () => {
  assert.equal(USUAL_CELLS.length, 13);
  for (const id of PEOPLE) {
    const tables = { ja: V.lockTable(persona(id), pv(id).lossTable, M, 'ja'), en: V.lockTable(persona(id), pv(id).lossTable, M, 'en') };
    const plus = [];
    for (const row of tables.ja.rows) {
      row.cells.forEach((cell, i) => {
        if (cell.mark === 'plus') plus.push([row.id, cell.loss, cell.text, tables.en.rows.find((r) => r.id === row.id).cells[i].text]);
      });
    }
    const expected = USUAL_CELLS.filter((c) => c[0] === id).map(([, loss, account, ja, en]) => [account, loss, ja, en]);
    const order = (list) => [...list].sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
    assert.deepEqual(order(plus), order(expected), id);
  }
  assert.deepEqual(PEOPLE.map((id) => USUAL_CELLS.filter((c) => c[0] === id).length), [4, 7, 2]);
});

test('G: the known two-at-once lines of the changes (21), and no other change has one', () => {
  assert.equal(PAIR_LINES.length, 21);
  for (const id of PEOPLE) {
    const got = [];
    for (const mv of pv(id).moves) {
      const ja = V.pairLines(persona(id), mv, M, 'ja'), en = V.pairLines(persona(id), mv, M, 'en');
      assert.equal(ja.length, en.length, mv.id);
      ja.forEach((line, i) => got.push([mv.id, line, en[i]]));
    }
    assert.deepEqual(got, PAIR_LINES.filter((l) => l[0] === id).map((l) => l.slice(1)), id);
  }
  assert.deepEqual(PEOPLE.map((id) => PAIR_LINES.filter((l) => l[0] === id).length), [12, 5, 4]);
});

test('G: the changes after which the lockout table shows the paper codes as a partner, and the cells with paper', () => {
  for (const id of PEOPLE) {
    const ids = pv(id).moves.filter((mv) => Object.values(mv.lossTable.cells).some((col) => Object.values(col).some((c) => c.plus.includes('paper'))))
      .map((mv) => mv.id);
    assert.deepEqual(ids, PAPER_PARTNER_MOVES[id], id);
  }
  const cell = (id, moveId, loss, account, lang) => V.lockTable(persona(id), move(id, moveId).lossTable, M, lang)
    .rows.find((r) => r.id === account).cells.find((c) => c.loss === loss);
  const known = [
    ['worker', 'replace:sns.recMail:mailMain>paper:sns', 'number', 'sns', '△（紙の回復コードも失うと×）', '△ (× if the paper codes go too)'],
    ['worker', 'replace:bank.recSmsDesk:info>paper:bank', 'device', 'bank', '△（番号か紙の回復コードも失うと×）', '△ (× if the number or the paper codes go too)'],
    ['parent', 'replace:sec.recMailSms:phone>paper:sec', 'device', 'sec', '△（プロバイダーのメールか紙の回復コードも失うと×）',
      '△ (× if the ISP email or the paper codes go too)'],
  ];
  for (const [id, moveId, loss, account, ja, en] of known) {
    assert.equal(cell(id, moveId, loss, account, 'ja').text, ja, moveId);
    assert.equal(cell(id, moveId, loss, account, 'en').text, en, moveId);
  }
  // Read aloud without the plus sign: "can get in; losing the number or the paper codes too would lock you out".
  assert.equal(cell('worker', 'replace:bank.recSmsDesk:info>paper:bank', 'device', 'bank', 'ja').sr, '入れる。番号か紙の回復コードも失うと入れない');
  assert.equal(cell('worker', 'replace:bank.recSmsDesk:info>paper:bank', 'device', 'bank', 'en').sr,
    'Can get in; losing the number or the paper codes too would lock you out');
});

test('G: known sentences of changes (titles, single losses, one to two at once, summaries)', () => {
  const s = (id, moveId, lang) => V.sentences(persona(id), pv(id), moveId, M, lang);
  const titles = [
    ['worker', 'replace:mailMain.recMail:mailOld>paper:mailMain', 'メインのメール：復旧で使う古いメールを、紙の回復コードに切り替える',
      'Main email: for recovery, use paper recovery codes instead of the old email'],
    ['worker', 'remove:sec.recMailSms', 'ネット証券：復旧（メール＋SMSでパスキーを再登録）を外す',
      'Online brokerage: remove recovery (Re-register passkey by email + SMS)'],
    ['parent', 'replace:bank.recSms:phone>idcheck', '銀行のネットバンキング：復旧で使う電話番号（SMS）を、書類での本人確認に切り替える',
      'Online banking: for recovery, use a document check instead of the phone number (SMS)'],
    ['worker', 'replace:points.login:pw:red>pw:own-points', 'ポイントアプリ：ログインで使うパスワードAを、このアカウントだけのパスワードDに切り替える',
      'Points app: for log-in, use a new Password D (this account only) instead of Password A'],
  ];
  for (const [id, moveId, ja, en] of titles) {
    assert.equal(s(id, moveId, 'ja').title, ja);
    assert.equal(s(id, moveId, 'en').title, en);
  }
  assert.deepEqual(s('worker', 'remove:sec.recMailSms', 'ja').lossOne, ['スマホをなくすと、ネット証券に入れなくなる']);
  assert.deepEqual(s('worker', 'remove:sec.recMailSms', 'en').lossOne, ['If you lose the phone, you can no longer get into: Online brokerage']);
  assert.deepEqual(s('parent', 'replace:bank.recSms:phone>idcheck', 'ja').lossOne, ['銀行のネットバンキングは、番号を手放しても入れる（変更前は入れなかった）']);
  assert.deepEqual(s('parent', 'replace:bank.recSms:phone>idcheck', 'en').lossOne,
    ['Even after giving up the number, you can now get into Online banking; before the change, you could not']);
  // One to two at once (the parent's bank): instead of "can now get in"; the two-at-once row says it in its own words
  // (only when both are lost together, and that the number alone locked the owner out before), not the same sentence again.
  const oneToPair = ['銀行のネットバンキングは、番号を手放しても入れる（変更前は入れなかった）。ただし、スマホと番号を一緒に失うと入れない',
    'Online banking: giving up the number no longer locks you out (it did before the change), but losing the phone and the number together still does'];
  assert.deepEqual(s('parent', 'replace:bank.login:phone>device', 'ja').lossOne, [oneToPair[0]]);
  assert.deepEqual(s('parent', 'replace:bank.login:phone>device', 'en').lossOne, [oneToPair[1]]);
  assert.deepEqual(s('parent', 'replace:bank.login:phone>device', 'ja').lossTwo,
    ['銀行のネットバンキングは、スマホと番号を一緒に失ったときだけ入れない（変更前は、番号を手放しただけで入れなかった）']);
  assert.deepEqual(s('parent', 'replace:bank.login:phone>device', 'en').lossTwo, ['Online banking: now locked out only when the phone and '
    + 'the number are lost together (before the change, giving up the number alone locked you out)']);
  const oneToPairMoves = PEOPLE.flatMap((id) => pv(id).moves.filter((mv) => V.lossLines(persona(id), mv, M, 'ja').oneToPair.length)
    .map((mv) => id + ' ' + mv.id));
  assert.deepEqual(oneToPairMoves, ['parent replace:bank.login:phone>device']);
  // Summaries: W3, W2 (four or more accounts) and the student's change that only makes an account fall. The account is the
  // subject of the attack line (指摘5: "Online brokerage no longer falls to SIM swap", not "saved with SIM swap").
  assert.deepEqual(s('worker', 'remove:sec.recMailSms', 'ja').summary, ['攻撃：ネット証券は、SIMスワップでは倒れなくなる', '閉め出し：スマホをなくすと、ネット証券に入れなくなる']);
  assert.deepEqual(s('worker', 'remove:sec.recMailSms', 'en').summary,
    ['Attack: Online brokerage no longer falls to SIM swap', 'Lockout: If you lose the phone, you can no longer get into: Online brokerage']);
  assert.deepEqual(s('worker', 'replace:mailMain.recMail:mailOld>paper:mailMain', 'ja').summary,
    ['攻撃：メインのメールなど6つは、メールの乗っ取りでもソーシャルエンジニアリングでも倒れなくなる', '閉め出し：変わらない']);
  assert.deepEqual(s('worker', 'replace:mailMain.recMail:mailOld>paper:mailMain', 'en').summary,
    ['Attack: Main email and others (6 in all) no longer fall to Email takeover or Social engineering', 'Lockout: No change']);
  assert.deepEqual(s('student', 'replace:sub.login:mailUni>mailFree', 'ja').summary,
    ['攻撃：動画のサブスクは、漏えいでもSIMスワップでも新たに倒れるようになる', '閉め出し：動画のサブスク（学割）は、大学のメールが消えても入れる（変更前は入れなかった）']);
  assert.deepEqual(s('student', 'replace:sub.login:mailUni>mailFree', 'en').summary, ['Attack: Video subscription now falls to Breach or SIM swap',
    'Lockout: Even after the university email is gone, you can now get into Video subscription (student plan); before the change, you could not']);
  // A change with a two-at-once difference gets the third summary line.
  assert.deepEqual(s('worker', 'replace:sec.recMailSms:phone>paper:sec', 'ja').summary.slice(1),
    ['閉め出し：変わらない', '2つ同時：一緒に失うとネット証券に入れなくなる組み合わせが、「スマホと番号」から「スマホと紙の回復コード」に変わる']);
  // The rows of the comparison: the attack, the lockout after one loss and after two at once, "no change" where nothing changes
  assert.deepEqual(s('worker', 'replace:mailMain.recMail:mailOld>paper:mailMain', 'ja').rows, [
    { id: 'attack', label: '攻撃', lines: ['メインのメールなど6つは、メールの乗っ取りでもソーシャルエンジニアリングでも倒れなくなる'] },
    { id: 'lockOne', label: '閉め出し（スマホ・番号・メールのどれか1つを失ったとき）', lines: ['変わらない'] },
    { id: 'lockTwo', label: '閉め出し（2つを同時に失ったとき）', lines: ['変わらない'] }]);
  assert.deepEqual(s('worker', 'remove:sec.recMailSms', 'en').rows.map((row) => [row.label, row.lines]), [
    ['Attack', ['Online brokerage no longer falls to SIM swap']],
    ['Lockout (losing one of the phone, the number or the email)', ['If you lose the phone, you can no longer get into: Online brokerage']],
    ['Lockout (losing two at once)', ['No change']]]);
});

test('G: the forms with two or more groups (built values passed to the sentence parts)', () => {
  const p = persona('worker');
  const empty = () => ({ newlyLocked: [], unlocked: [] });
  const pairsWith = (entries) => Object.fromEntries(C.lossPairs(p).map((pr) => C.pairKey(pr))
    .map((k) => [k, { ...empty(), ...(entries[k] || {}) }]));
  const twoNew = { pairLosses: pairsWith({ 'device+number': { newlyLocked: ['sec'] }, 'device+mail': { newlyLocked: ['sec'] } }) };
  assert.deepEqual(V.pairLines(p, twoNew, M, 'ja'), ['スマホと番号、スマホと古いメールを一緒に失うと、ネット証券に入れなくなる']);
  assert.deepEqual(V.pairLines(p, twoNew, M, 'en'),
    ['Losing the phone and the number, or the phone and the old email together now locks you out of Online brokerage']);
  const twoUnlocked = { pairLosses: pairsWith({ 'device+number': { unlocked: ['bank'] }, 'number+mail': { unlocked: ['bank'] } }) };
  assert.deepEqual(V.pairLines(p, twoUnlocked, M, 'ja'), ['ネット銀行は、スマホと番号、番号と古いメールを一緒に失っても入れる（変更前は入れなかった）']);
  assert.deepEqual(V.pairLines(p, twoUnlocked, M, 'en'), ['You can now get into Online bank even after losing the phone and the number, '
    + 'or the number and the old email together; before the change, you could not']);
  const moved = { pairLosses: pairsWith({ 'device+number': { unlocked: ['sec'] }, 'number+mail': { unlocked: ['sec'] },
    'device+paper': { newlyLocked: ['sec'] } }) };
  assert.deepEqual(V.pairLines(p, moved, M, 'ja'), ['一緒に失うとネット証券に入れなくなる組み合わせが、「スマホと番号・番号と古いメール」から「スマホと紙の回復コード」に変わる']);
  assert.deepEqual(V.pairLines(p, moved, M, 'en'), ['The pair of losses that locks you out of Online brokerage changes from '
    + 'the phone and the number, the number and the old email to the phone and the paper codes']);
  // One to two at once with two groups.
  const losses = Object.fromEntries(p.losses.map((l) => [l.id, empty()]));
  losses.number = { newlyLocked: [], unlocked: ['bank'] };
  const lossTable = { columns: ['device', 'number', 'mail'], pairOnly: { ...Object.fromEntries(C.lossPairs(p).map((pr) => [C.pairKey(pr), []])),
    'device+number': ['bank'], 'number+mail': ['bank'] } };
  assert.deepEqual(V.lossLines(p, { losses, lossTable }, M, 'ja').one,
    ['ネット銀行は、番号を手放しても入れる（変更前は入れなかった）。ただし、スマホと番号、番号と古いメールを一緒に失うと入れない']);
  assert.deepEqual(V.lossLines(p, { losses, lossTable }, M, 'en').one, ['Online bank: giving up the number no longer locks you out (it did '
    + 'before the change), but losing the phone and the number, or the number and the old email together still does']);
  // The attack line: a breach saves A, a SIM swap saves B, and social engineering makes C newly fall.
  const card = (saved, exposed) => ({ saved, exposed });
  const attack = { cards: { leak: card(['points'], []), simswap: card(['flea'], []), mail: card([], []), desk: card([], ['bank']) } };
  assert.equal(V.attackLine(p, attack, M, 'ja'),
    '攻撃：ポイントアプリは、漏えいでは倒れなくなる。フリマアプリは、SIMスワップでは倒れなくなる。ネット銀行は、ソーシャルエンジニアリングで新たに倒れるようになる');
  assert.equal(V.attackLine(p, attack, M, 'en'),
    'Attack: Points app no longer falls to Breach. Flea-market app no longer falls to SIM swap. Online bank now falls to Social engineering');
  // Two to four cards: AでもBでも, A・B・Cのどれでも and 4枚のどのカードでも ("と" would read as "both together");
  // two or three accounts are joined with "and" in English
  const all4 = { cards: { leak: card(['points', 'shop'], []), simswap: card(['points', 'shop'], []), mail: card(['points', 'shop'], []),
    desk: card(['points', 'shop'], []) } };
  assert.equal(V.attackLine(p, all4, M, 'ja'), '攻撃：ポイントアプリ・通販は、4枚のどのカードでも倒れなくなる');
  assert.equal(V.attackLine(p, all4, M, 'en'), 'Attack: Points app and Online shop no longer fall to any of the four cards');
});

test('G: the attack table names accounts by their full names; the attack summary uses the short names', () => {
  // Full name = the data label; short name = the label without a trailing (…). Both come from the data here.
  const label = (id, account, lang) => persona(id).services.find((s) => s.id === account).label[lang];
  let suffixed = 0;
  for (const id of PEOPLE) {
    for (const mv of pv(id).moves) {
      for (const lang of ['ja', 'en']) {
        const rows = V.sentences(persona(id), pv(id), mv.id, M, lang).attack;
        for (const card of ['leak', 'simswap', 'mail', 'desk']) {
          const row = rows.find((r) => r.card === card);
          const { saved, exposed } = vectors.personas[id].moves.find((m) => m.id === mv.id).cards[card];
          assert.deepEqual(row.savedNames, saved.map((s) => label(id, s, lang)), id + ' ' + mv.id + ' ' + card);
          assert.deepEqual(row.newlyNames, exposed.map((s) => label(id, s, lang)), id + ' ' + mv.id + ' ' + card);
          suffixed += [...saved, ...exposed].filter((s) => /[)）]$/.test(label(id, s, lang))).length;
        }
      }
    }
  }
  assert.ok(suffixed > 0, 'some rows name an account whose full name ends in (…)');
  // Known rows and summaries: the same account, full in the table and short in the summary.
  const s = (id, moveId, lang) => V.sentences(persona(id), pv(id), moveId, M, lang);
  const cases = [
    ['worker', 'replace:shop.recMail:mailMain>paper:shop', 'simswap', 'savedNames', '通販（クレジットカード登録あり）', 'Online shop (credit card saved)',
      '攻撃：通販は、SIMスワップ・メールの乗っ取り・ソーシャルエンジニアリングのどれでも倒れなくなる',
      'Attack: Online shop no longer falls to any of SIM swap, Email takeover or Social engineering'],
    ['worker', 'remove:flea.recMail', 'leak', 'savedNames', 'フリマアプリ（売上金）', 'Flea-market app (sales balance)',
      '攻撃：フリマアプリは、漏えい・メールの乗っ取り・ソーシャルエンジニアリングのどれでも倒れなくなる',
      'Attack: Flea-market app no longer falls to any of Breach, Email takeover or Social engineering'],
    ['student', 'replace:sub.login:mailUni>mailFree', 'simswap', 'newlyNames', '動画のサブスク（学割）', 'Video subscription (student plan)',
      '攻撃：動画のサブスクは、漏えいでもSIMスワップでも新たに倒れるようになる', 'Attack: Video subscription now falls to Breach or SIM swap'],
  ];
  for (const [id, moveId, card, field, ja, en, summaryJa, summaryEn] of cases) {
    assert.deepEqual(s(id, moveId, 'ja').attack.find((r) => r.card === card)[field], [ja], moveId);
    assert.deepEqual(s(id, moveId, 'en').attack.find((r) => r.card === card)[field], [en], moveId);
    assert.equal(s(id, moveId, 'ja').summary[0], summaryJa, moveId);
    assert.equal(s(id, moveId, 'en').summary[0], summaryEn, moveId);
  }
  // W2: the mail takeover row of the table names all six accounts in full; the summary counts them from the first short name
  const w2 = (lang) => s('worker', 'replace:mailMain.recMail:mailOld>paper:mailMain', lang);
  assert.ok(w2('ja').attack.find((r) => r.card === 'mail').savedNames.includes('フリマアプリ（売上金）'));
  assert.ok(w2('en').attack.find((r) => r.card === 'mail').savedNames.includes('Online shop (credit card saved)'));
});

test('G: the step line under the step buttons: what the card gives at step 0, then the accounts that fall at each step', () => {
  // Built from the known vectors (gives, rank) and the data labels: a credential by its label (personal details by the
  // short tag), an email taken over as the whole account (its short name and "account"); the sentence types are those of the
  // screen text. A step line says that the accounts fell, then the last step (or that this is the last step); in English a list
  // ends with "and", and one account "falls".
  const all = (items, sep, last) => (items.length < 2 ? items.join('') : items.slice(0, -1).join(sep) + last + items[items.length - 1]);
  const forms = {
    ja: { zero: (g) => '段0：攻撃者が最初に手にしたのは、' + g,
      step: (r, m, a) => '段' + r + '：' + all(a, '・', '・') + 'が倒れた' + (r === m ? '（ここが最後の段）' : '（最後は段' + m + '）'), sep: '・',
      info: '個人情報', account: (name) => name + 'のアカウント' },
    en: { zero: (g) => 'Step 0: the attacker starts with ' + g,
      step: (r, m, a) => 'Step ' + r + ': ' + all(a, ', ', ' and ') + (a.length === 1 ? ' falls' : ' fall')
        + (r === m ? ' (this is the last step)' : ' (last step: ' + m + ')'), sep: ', ',
      info: 'Personal details', account: (name) => 'the ' + (/^[A-Z](?![A-Z])/.test(name) ? name[0].toLowerCase() + name.slice(1) : name) + ' account' },
  };
  const short = (s, lang) => s.label[lang].replace(/\s*[（(][^（）()]*[）)]$/, '');
  let lines = 0;
  for (const id of PEOPLE) {
    const p = persona(id);
    for (const card of ['leak', 'simswap', 'mail', 'desk']) {
      const known = vectors.personas[id].cards[card];
      const last = Math.max(0, ...Object.values(known.rank));
      for (const lang of ['ja', 'en']) {
        const f = forms[lang];
        const gives = known.gives.map((node) => {
          const credential = p.credentials.find((c) => c.id === node);
          if (!credential) return f.account(short(p.services.find((s) => s.id === node), lang));
          return credential.type === 'info' ? f.info : credential.label[lang];
        }).join(f.sep);
        for (let step = 0; step <= last; step++) {
          const accounts = p.services.filter((s) => known.rank[s.id] === step).map((s) => short(s, lang));
          const expected = step === 0 ? f.zero(gives) : f.step(step, last, accounts);
          assert.equal(V.stepLine(p, pv(id).cards[card], card, step, M, lang), expected, id + ' ' + card + ' ' + step + ' ' + lang);
          // The sentence read aloud is the same, followed by the summary at the last step
          const read = V.stepStatus(p, pv(id).cards[card], card, step, M, lang);
          assert.ok(step < last ? read === expected : read.startsWith(expected + (lang === 'ja' ? '。' : '. ')), read);
          lines++;
        }
      }
    }
  }
  assert.ok(lines > 24);
});

// How changes are ranked, word for word: what the top changes leave out (a list), the order in which the rest
// are compared (a numbered list), then a note. Card modes and the sum of the four cards share one, the lockouts have their own.
// (the Japanese counts summed over the four cards are named with the mode's name 4枚の合計, as on the buttons)
const RANKING = {
  cards: {
    ja: { excludeLead: '上位には、次の変更を出しません。',
      exclude: ['1つ失ったときの閉め出しを増やす変更',
        '解約や卒業で消えるメール（「閉め出し」のタブで、失うものに入っているメール）へ切り替える変更。「変更を自分で選ぶ」では選べる'],
      orderLead: '残りの変更を、次の順に比べて並べます。',
      order: ['★のアカウントを守れる変更が先（★のアカウントを守れない変更は後）', '各段の中は、守れるアカウントの数が多い変更が先',
        '閉め出しが減る数が多い変更が先', '4枚のカードで新たに倒れる数の合計が少ない変更が先', 'それでも同じなら、追加→切り替え→外すの順'],
      note: '1と2は、守れた数から、同じカード（4枚の合計では4枚）で新たに倒れた数を引いた差で比べます。ボタンの「守れる」は引く前の数です。'
        + '2つを同時に失ったときの閉め出しは、並べ方に使っていません。同じ入口の変更は、いちばん上の1つだけを出します。' },
    en: { excludeLead: 'These changes are left out of the top changes:',
      exclude: ['changes that add a lockout after a single loss', 'changes to an email that will be gone (one the Lockout tab counts as a loss, '
        + 'gone when an ISP is canceled or the owner graduates); “Choose a change yourself” still lists them'],
      orderLead: 'The other changes are compared in this order:',
      order: ['changes that protect a ★ account come first (changes that do not come second)', 'within each group, more accounts saved first',
        'larger decrease in lockouts first', 'fewer accounts newly falling, summed over the four cards, first',
        'if still tied: add, then replace, then remove'],
      note: 'Items 1 and 2 count the accounts saved minus those newly falling to the same card (all four for the sum). The “Saves” on each button '
        + 'is before that subtraction. Losing two things at once is not used for ranking. Only the highest change for each entrance is shown.' },
  },
  lockout: {
    ja: { excludeLead: '上位には、次の変更を出しません。',
      exclude: ['閉め出しが減らない変更', '解約や卒業で消えるメール（「閉め出し」のタブで、失うものに入っているメール）へ切り替える変更。「変更を自分で選ぶ」では選べる'],
      orderLead: '残りの変更を、次の順に比べて並べます。',
      order: ['閉め出しが減る数が多い変更が先', '4枚のカードで新たに倒れる数の合計が少ない変更が先', '守れる★の数（4枚の合計）が多い変更が先',
        '守れるアカウントの数（4枚の合計）が多い変更が先', 'それでも同じなら、追加→切り替え→外すの順'],
      note: '3と4は、守れた数から新たに倒れた数を引いた差で比べます。同じ入口の変更は、いちばん上の1つだけを出します。' },
    en: { excludeLead: 'These changes are left out of the top changes:',
      exclude: ['changes that do not reduce lockouts', 'changes to an email that will be gone (one the Lockout tab counts as a loss, gone when an '
        + 'ISP is canceled or the owner graduates); “Choose a change yourself” still lists them'],
      orderLead: 'The other changes are compared in this order:',
      order: ['larger decrease in lockouts first', 'fewer accounts newly falling, summed over the four cards, first',
        'more ★ accounts saved, summed over the four cards, first', 'more accounts saved, summed over the four cards, first',
        'if still tied: add, then replace, then remove'],
      note: 'Items 3 and 4 count the accounts saved minus those newly falling. Only the highest change for each entrance is shown.' },
  },
};

test('G: the ranking note follows the mode, and the one-account step summary is singular in English', () => {
  // The whole note in each mode (the two lists and the note), in both languages
  for (const mode of ['leak', 'simswap', 'mail', 'desk', 'all', 'lockout']) {
    const known = RANKING[mode === 'lockout' ? 'lockout' : 'cards'];
    assert.deepEqual(V.rankingNote(mode, M, 'ja'), known.ja, mode);
    assert.deepEqual(V.rankingNote(mode, M, 'en'), known.en, mode);
  }
  const summary = (id, card, lang) => V.stepSummary(persona(id), pv(id).cards[card], M, lang, card);
  assert.equal(summary('parent', 'simswap', 'en'), 'With this card, 1 of the 7 accounts falls by the last step (1 of them important ★).');
  assert.equal(summary('parent', 'simswap', 'ja'), 'このカードでは、最後の段までに、7つのうち1つのアカウントが倒れます（うち、★を付けた重要なアカウントは1つ）。');
  assert.equal(summary('worker', 'leak', 'en'), 'With this card, 6 of the 9 accounts fall by the last step (1 of them important ★).');
  // The email taken over is counted, and said so; all the accounts; no account falls (the student has no help-desk entrance)
  assert.equal(summary('worker', 'mail', 'ja'), 'このカードでは、最後の段までに、最初に乗っ取られた古いメールを含めて、9つのうち7つのアカウントが倒れます'
    + '（うち、★を付けた重要なアカウントは1つ）。');
  assert.equal(summary('student', 'mail', 'ja'), 'このカードでは、最後の段までに、最初に乗っ取られた大学のメールを含めて、7つすべてのアカウントが倒れます'
    + '（うち、★を付けた重要なアカウントは3つ）。');
  assert.equal(summary('student', 'mail', 'en'), 'With this card, counting the university email taken over first, all 7 accounts fall by the last step '
    + '(3 of them important ★).');
  assert.equal(summary('student', 'desk', 'ja'), 'ミオの入口には、個人情報を必要とするものがありません。このため、ソーシャルエンジニアリングのカードでは何も倒れません。');
  assert.equal(summary('student', 'desk', 'en'), 'None of Mio\'s entrances needs personal details, so nothing falls to the social-engineering card.');
  assert.equal(V.stepSummary(persona('student'), pv('student').cards.desk, M, 'ja'), 'このカードでは、倒れるアカウントはありません。');
  const counts = V.counts(persona('parent'));
  assert.equal(V.fill(M.en.personCounts, { n: counts.accounts, f: counts.families, symbols: counts.symbols.join(M.en.sepList) }),
    'Accounts: 7 · Passwords: 1 (A). Fictional people; no fields for real account details.');
});

test('G: the chain tab texts (card line, step status, map cells, cards needed) for the known scenes', () => {
  const p = persona('worker');
  assert.equal(V.cardLine(p, 'leak', M, 'ja'), 'ポイントアプリの漏えい（IDとパスワードが漏れた）。攻撃者が最初に手にするもの：ポイントアプリのIDとパスワード（パスワードA）');
  assert.equal(V.cardLine(p, 'leak', M, 'en'),
    'Points-app breach (ID and password leaked). The attacker starts with: the Points app ID and password (Password A)');
  // The email taken over is the whole account (it can read what arrives), not an address
  assert.equal(V.cardLine(p, 'mail', M, 'ja'), '古いメールの乗っ取り。攻撃者が最初に手にするもの：古いメールのアカウント');
  assert.equal(V.cardLine(p, 'mail', M, 'en'), 'Old email taken over. The attacker starts with: the old email account');
  const result = pv('worker').cards.leak;
  assert.equal(V.stepStatus(p, result, 'leak', 0, M, 'ja'), '段0：攻撃者が最初に手にしたのは、パスワードA');
  assert.equal(V.stepStatus(p, result, 'leak', 1, M, 'ja'), '段1：メインのメール・ポイントアプリ・通販が倒れた（最後は段2）');
  assert.equal(V.stepStatus(p, result, 'leak', 2, M, 'ja'), '段2：SNS・フリマアプリ・写真のクラウドが倒れた（ここが最後の段）。'
    + 'このカードでは、最後の段までに、9つのうち6つのアカウントが倒れます（うち、★を付けた重要なアカウントは1つ）。');
  assert.equal(V.stepStatus(p, result, 'leak', 1, M, 'en'), 'Step 1: Main email, Points app and Online shop fall (last step: 2)');
  assert.equal(V.mapCaption(p, 'leak', 2, M, 'ja'), '会社員 ハルトの地図（漏えい・段2）');
  assert.equal(V.mapCaption(p, 'leak', 0, M, 'en'), 'Map: Haruto, office worker (Breach, step 0)');
  // W1 at step 2: three accounts fell at step 1 by log-in and three at step 2 through "Reset via registered email" (backdoors).
  // The cell names the entrance as the entrances column writes it; the sentence read aloud names it by its label
  const rows = V.mapRows(p, result, 2, M, 'ja');
  const cell = (id) => rows.find((r) => r.id === id).cell;
  assert.equal(cell('mailMain').text, '●1（ログイン：パスワードA）');
  assert.equal(cell('sns').text, '●2（復旧：メインのメール）');
  assert.equal(cell('sns').sr, '段2で倒れる。攻撃者が使った入口：復旧の「登録メールで再設定」');
  assert.equal(V.mapRows(p, result, 2, M, 'en').find((r) => r.id === 'sns').cell.text, '●2 (Recovery: Main email)');
  assert.equal(cell('sns').backdoor, true);
  assert.equal(cell('sns').thisStep, true);
  assert.equal(cell('bank').text, '－');
  assert.equal(cell('bank').sr, '倒れない');
  assert.equal(V.mapRows(p, result, 1, M, 'ja').find((r) => r.id === 'bank').cell.sr, 'まだ倒れていない');
  assert.deepEqual(rows.find((r) => r.id === 'sec').entrances, ['ログイン：スマホ', '復旧：メインのメール＋SMS']);
  assert.deepEqual(rows.find((r) => r.id === 'sns').entrances, ['ログイン：パスワードA＋SMS', '復旧：メインのメール']);
  assert.deepEqual(V.mapRows(p, result, 2, M, 'en').find((r) => r.id === 'sec').entrances, ['Log-in: Phone', 'Recovery: Main email + SMS']);
  // The mail card gives the old email directly (step 0).
  assert.equal(V.mapRows(p, pv('worker').cards.mail, 0, M, 'ja').find((r) => r.id === 'mailOld').cell.text, '●0（最初に乗っ取られた）');
  const need = (id, account, lang) => V.needText(persona(id), pv(id), account, M, lang);
  // Always a noun phrase; two cards that make an account fall together are joined with ＋, as the entrances are
  assert.equal(need('worker', 'bank', 'ja'), '倒すのに要るカード：SIMスワップ＋ソーシャルエンジニアリングの2枚の組（1枚では倒れない）');
  assert.equal(need('parent', 'sec', 'ja'), '倒すのに要るカード：次のどれかの組（1枚では倒れない）：漏えい＋SIMスワップ、'
    + 'SIMスワップ＋メールの乗っ取り、SIMスワップ＋ソーシャルエンジニアリング');
  assert.equal(need('worker', 'mailMain', 'ja'), '倒すのに要るカード：4枚のどれか1枚（どのカードでも倒れる）');
  assert.equal(need('worker', 'sec', 'ja'), '倒すのに要るカード：SIMスワップのカード1枚');
  assert.equal(need('worker', 'mailOld', 'ja'), '倒すのに要るカード：メールの乗っ取りかソーシャルエンジニアリングのどちらか1枚');
  // One card alone or combinations (none of the three people has this today; the wording is ready for it)
  const mixed = { cardBase: { bank: [['simswap'], ['leak', 'desk'], ['mail', 'desk']] } };
  assert.equal(V.needText(persona('worker'), mixed, 'bank', M, 'ja'), '倒すのに要るカード：SIMスワップのカード1枚、または次のどれかの組：'
    + '漏えい＋ソーシャルエンジニアリング、メールの乗っ取り＋ソーシャルエンジニアリング');
  assert.equal(V.needText(persona('worker'), mixed, 'bank', M, 'en'), 'Cards needed: SIM swap alone, or any of these combinations: '
    + 'Breach + Social engineering; Email takeover + Social engineering');
  assert.equal(need('worker', 'mailOld', 'en'), 'Cards needed: either Email takeover or Social engineering');
  // A combination comes with the note that the page shows one card at a time
  assert.ok(V.detail(persona('worker'), pv('worker'), 'leak', 'bank', M, 'ja').notes.includes(M.ja.needComboNote));
  assert.ok(!V.detail(persona('worker'), pv('worker'), 'leak', 'mailMain', M, 'ja').notes.includes(M.ja.needComboNote));
  // P1: the parent's bank falls only through the SMS reset at step 1, as a backdoor.
  const p1 = V.detail(persona('parent'), pv('parent'), 'simswap', 'bank', M, 'ja');
  assert.equal(p1.falls, 'このカードでは、段1で倒れました（攻撃者が使った入口：復旧の「SMSで再設定」）。');
  // The detail follows the step shown: before its step, the account has not fallen yet (and no backdoor is told)
  const early = V.detail(persona('worker'), pv('worker'), 'leak', 'sns', M, 'ja', 1);
  assert.equal(early.falls, 'このカードでは、段2で倒れます（いまは段1で、まだ倒れていません）。');
  assert.equal(early.backdoor, null);
  assert.equal(p1.backdoor, '裏口（復旧の入口を通って倒れた）');
  // The entrances of the detail box: each one with its name and what it needs (the name and the letter of a password do not repeat)
  assert.deepEqual(p1.entrances, ['ログイン（パスワード＋SMSのワンタイムパスワード）に必要なもの：パスワードA＋SMS', '復旧（SMSで再設定）に必要なもの：SMS']);
  assert.deepEqual(V.detail(persona('parent'), pv('parent'), 'simswap', 'bank', M, 'en').entrances,
    ['Log-in (Password + SMS one-time password) needs: Password A + SMS', 'Recovery (Reset by SMS) needs: SMS']);
  assert.equal(p1.need, '倒すのに要るカード：SIMスワップのカード1枚');
  // S1: the brokerage note for the student has the second sentence.
  assert.equal(V.detail(persona('student'), pv('student'), 'leak', 'sec', M, 'ja').notes.length, 2);
  assert.equal(V.detail(persona('worker'), pv('worker'), 'leak', 'sec', M, 'ja').notes.length, 1);
});

test('G: every change in both languages: lines are present, filled and free of Japanese in English; notes only where they apply', () => {
  const noNotes = {};
  let count = 0;
  for (const id of PEOPLE) {
    noNotes[id] = 0;
    for (const mv of pv(id).moves) {
      const ja = V.sentences(persona(id), pv(id), mv.id, M, 'ja');
      const en = V.sentences(persona(id), pv(id), mv.id, M, 'en');
      for (const key of ['summary', 'lossOne', 'lossTwo', 'notes']) assert.equal(ja[key].length, en[key].length, id + ' ' + mv.id + ' ' + key);
      for (const s of [ja, en]) {
        assert.ok(s.title && s.summary.length >= 2 && s.lossOne.length >= 1 && s.lossTwo.length >= 1, id + ' ' + mv.id);
        for (const line of [s.title, ...s.summary, ...s.lossOne, ...s.lossTwo, ...s.notes]) {
          assert.ok(line.trim(), id + ' ' + mv.id);
          assert.doesNotMatch(line, /[{}]/, id + ' ' + mv.id + ': ' + line);
          assert.doesNotMatch(line, /この口座だけの系統|系統|Own family \(|\b(?:a |password )famil(?:y|ies)\b/, id + ' ' + mv.id);
        }
      }
      for (const line of [en.title, ...en.summary, ...en.lossOne, ...en.lossTwo, ...en.notes]) {
        assert.doesNotMatch(line, JAPANESE, id + ' ' + mv.id + ': ' + line);
        assert.doesNotMatch(line, ONE_PLURAL, id + ' ' + mv.id + ': ' + line);
      }
      if (!ja.notes.length) noNotes[id]++;
      count++;
    }
  }
  assert.equal(count, 89);
  assert.deepEqual(noNotes, { worker: 5, parent: 1, student: 6 });
  // The changes that change nothing (18) carry the note, and the two that only change the cards needed are among them.
  const nothing = PEOPLE.flatMap((id) => pv(id).moves.filter((mv) => V.moveNotes(persona(id), mv, M, 'en').includes(M.en.noteNoChange))
    .map((mv) => id + ' ' + mv.id));
  assert.equal(nothing.length, 18);
  assert.ok(nothing.includes('parent add:bank.login:+device'));
  assert.ok(nothing.includes('worker replace:bank.recSmsDesk:info>idcheck'));
  assert.ok(nothing.includes('parent replace:msg.recMove:pw:yellow>pw:own-msg'));
});

// The notes after a change, from the spec (the note on a change to a document check — the tab 3 sentences, not the
// help-desk note of the card in tab 1 —, the 2nd to 4th sentences of the paper note, the removal note, the note on a password of
// its own, the phone note of the lockout tab, and the note for a change that changes nothing)
const NOTES = {
  desk: ['このシミュレーションには、書類での本人確認を破るカードも、本人が書類をなくす場合もありません。そのため、再設定を書類での本人確認に切り替えても、'
    + '攻撃で倒れるアカウントも閉め出しも増えません。実際には、書類は偽造されることがあり、窓口での再設定には日数もかかります。',
  'This model has no card that defeats a document check and no case of the owner losing their documents, so switching a reset to a document '
    + 'check adds neither fallen accounts nor lockouts. In reality, documents can be forged, and a reset at a desk takes days.'],
  paper: ['このシミュレーションには、攻撃者が紙の回復コードを手にするカードがありません。そのため、紙の回復コードに切り替えても、攻撃で倒れるアカウントは増えません。'
    + '実際には、紙の置き場所が新しい弱点になります。また、回復コードは手で入力するので、偽サイトに入力すると盗まれます。本人の側では、紙をほかのもの（スマホなど）と'
    + '一緒になくすと、入れなくなることがあります。',
  'No card here gives the attacker the paper codes, so switching to paper codes never adds fallen accounts. In reality, where you keep the paper '
    + 'becomes a new weak point, and since the codes are typed by hand, typing them into a fake site gives them away. For the owner, losing the '
    + 'paper together with something else (such as the phone) can lock you out.'],
  remove: ['復旧の入口を外したときの閉め出しは、スマホ・電話番号・メールを失った場合だけで数えています。パスワードを忘れた場合は数えていないので、'
    + 'パスワードでログインするアカウントでは、外しても閉め出しが増えないように見えます。実際には、パスワードを忘れたときに戻る手段がなくなります。',
  'Lockout after removing a recovery entrance is counted only for losing the phone, the phone number or the email. Forgetting a password is not '
    + 'counted, so for accounts that log in with a password, removing a recovery entrance can look as if it adds no lockout. In reality, you lose '
    + 'your way back in if you forget the password.'],
  own: ['漏れたサービスのパスワードをほかと別のものにすると、漏えいで攻撃者が手にするのはその新しいパスワードだけになり、使い回し先へは広がりません。',
    'If the breached service gets a password of its own, the breach gives the attacker only that new password, '
      + 'and it no longer spreads to the accounts that reused the old one.'],
  sync: ['スマホを失ったときの結果は、認証アプリやパスキーを、ほかの端末やクラウドに同期・バックアップしていない場合のものです。',
    'The results for losing the phone assume the authenticator app and passkeys are not synced or backed up to another device or the cloud.'],
  none: ['この変更では、どのカードの攻撃も、閉め出しも変わりません。', 'This change affects neither any single card\'s attack nor the lockout.'],
};

test('G: the notes after a change, in their order (help desk, paper, removal, password of its own, phone, nothing changes)', () => {
  const cases = [
    ['worker', 'replace:mailMain.recMail:mailOld>paper:mailMain', ['paper']],
    ['worker', 'remove:sec.recMailSms', ['remove', 'sync']],
    ['parent', 'replace:bank.recSms:phone>idcheck', ['desk']],
    ['worker', 'replace:points.login:pw:red>pw:own-points', ['own']],
    ['worker', 'add:mailMain.login:+device', ['sync']],
    ['parent', 'add:bank.login:+device', ['sync', 'none']],
    ['worker', 'replace:sec.recMailSms:phone>paper:sec', ['paper', 'sync']],
    ['worker', 'replace:sec.recMailSms:phone>idcheck', ['desk', 'sync']],
    ['parent', 'replace:bank.login:phone>device', ['sync']],
  ];
  for (const [id, moveId, keys] of cases) {
    for (const [i, lang] of [[0, 'ja'], [1, 'en']]) {
      assert.deepEqual(V.sentences(persona(id), pv(id), moveId, M, lang).notes, keys.map((key) => NOTES[key][i]), id + ' ' + moveId + ' ' + lang);
    }
  }
  // Every note is one of these six, and no change carries the same note twice
  const all = new Set(Object.values(NOTES).flatMap((pair) => pair));
  for (const id of PEOPLE) {
    for (const mv of pv(id).moves) {
      for (const lang of ['ja', 'en']) {
        const notes = V.moveNotes(persona(id), mv, M, lang);
        assert.ok(notes.every((note) => all.has(note)) && new Set(notes).size === notes.length, id + ' ' + mv.id);
      }
    }
  }
});

test('G: the screen text of tab 3 is the text of the spec', () => {
  // key, Japanese, English (the table "タブ3 1つ変えて比べる" of the screen text)
  const rows = [
    ['modeHeading', '並べ替えの基準', 'Rank changes by'],
    ['modeLeak', '漏えい', 'Breach'], ['modeSimswap', 'SIMスワップ', 'SIM swap'], ['modeMail', 'メールの乗っ取り', 'Email takeover'],
    ['modeDesk', 'ソーシャルエンジニアリング', 'Social engineering'], ['modeAll', '4枚の合計', 'All four cards'],
    ['modeLockout', '閉め出し', 'Lockouts'],
    // The button of the email takeover names the email of the person taken over (the old email, the ISP email, the university email)
    ['cardMailButton', 'メールの乗っ取り（{mail}）', 'Email takeover ({mail})'],
    // The heading says what the list is (the top changes by the counts of this simulation), not a recommendation
    ['candidatesHeading', 'このシミュレーションでの上位の変更', 'Top changes in this model'],
    // The introduction ends at "three kinds", which follow as a list
    ['compareIntro', 'ログインか復旧の入口を1つだけ変えて、攻撃で倒れるアカウントと閉め出しが、変更前と変更後でどう変わるかを比べます。変え方は次の3種類です。',
      'Change just one log-in or recovery entrance and compare, before and after the change, which accounts fall to the attacks and which '
        + 'lockouts occur. There are three kinds of change:'],
    ['compareKindAdd', 'ログインに、スマホの認証アプリかパスキーを追加する', 'Add an authenticator app or passkey on the phone to a log-in'],
    ['compareKindReplace', '入口に必要なもの（パスワード・SMSなど）を1つ、別のものに切り替える',
      'Switch one thing an entrance needs (a password, SMS and so on) to something else'],
    ['compareKindRemove', '復旧の入口を1つ外す', 'Remove one recovery entrance'],
    // What the six buttons do and what the list holds (by mode)
    ['modeHelp', '減らしたい攻撃（または閉め出し）を選ぶと、下の上位の変更がその基準で並び替わり、1位の変更が選ばれます。',
      'Choose the attack (or lockouts) you want to reduce: the top changes below are ranked again by it, and the change ranked first is selected.'],
    ['candidatesHelpCards', '攻撃で倒れるアカウントを減らし、1つ失ったときの閉め出しを増やさない変更を、効果の大きい順に3つまで出します（同じ入口の変更は1つだけ）。'
      + '押すと、下に変更前と変更後を比べた結果が出ます。',
    'Up to three changes that make fewer accounts fall to the attack without adding a lockout after a single loss, largest effect first (one per '
      + 'entrance). Press one to compare before and after below.'],
    ['candidatesHelpLockout', '閉め出しを減らす変更を、減る数の多い順に3つまで出します（同じ入口の変更は1つだけ）。押すと、下に変更前と変更後を比べた結果が出ます。',
      'Up to three changes that reduce lockouts, largest decrease first (one per entrance). Press one to compare before and after below.'],
    // The legend above the candidates: one item per line, the items the buttons of the mode use
    ['legendSaved', '守れる＝変更前は倒れ、変更後は倒れないアカウントの数（うち★＝そのうちの重要なアカウントの数）',
      'Saves = accounts that fall before the change but not after (including ★ = the important ones among them)'],
    ['legendUnlocked', '閉め出しがなくなる＝変更前は入れず、変更後は入れるアカウントの数', 'Lockouts removed = accounts the owner cannot get into before the change but can after'],
    ['legendExposed', '新たに倒れる＝変更前は倒れず、変更後は倒れるアカウントの数', 'Newly fallen = accounts that do not fall before the change but do after'],
    ['legendPairNew', '閉め出し（2つ同時）が増える＝2つを一緒に失ったときにだけ入れなくなるアカウントが、変更で増える（並べ方には使わない）',
      'Two-at-once lockouts added = accounts that become locked out only when two things are lost together (not used for ranking)'],
    // Why 7 comes after 6 in the worker's list (★ first)
    ['legendOrderCards', '並び＝「★のアカウントを守れる変更」が先、「★のアカウントを守れない変更」が後。各段の中は、守れる数が多い順',
    'Order = changes that protect a ★ account first, then changes that do not. Within each group, more saved first'],
    ['legendOrderLockout', '並び＝閉め出しが減る数が多い順。同じなら、新たに倒れる数が少ない順',
      'Order = larger decrease in lockouts first; if equal, fewer newly fallen first'],
    // A candidate: its rank (read as 1位), what its count is, and the important accounts among them
    ['candRank', '{n}位', 'Rank {n}'], ['faceSaved', '守れる', 'Saves'], ['faceSavedAll', '守れる（4枚の合計）', 'Saves (sum over 4 cards)'],
    ['faceUnlocked', '閉め出しがなくなる', 'Lockouts removed'], ['faceImp', 'うち★{imp}', 'including ★{imp}'],
    // The parent only: the bank change of her story, when it is second or third
    ['storyMoveNote', '{name}のネットバンキングの変更は{rank}位です（「{tab}」の見どころの{n}つ目と同じ変更）。',
      '{name}\'s online banking change is number {rank} in this list (the same change as highlight {n} in “{tab}”).'],
    // Without candidates: the given name, and where the two-at-once lockouts are shown
    ['noFall', '{name}には、このカードで倒れるアカウントがないので、守るための変更もありません。',
      'None of {name}\'s accounts falls to this card, so there is no change to protect them.'],
    ['noLockout', '{name}には、1つ失っただけで入れなくなるアカウントがないので、閉め出しを減らす変更もありません。2つを同時に失ったときの変化は、下の'
      + '「変更を自分で選ぶ」で変更を選ぶと、比べた結果の「閉め出し（2つを同時に失ったとき）」に出ます。',
    '{name} has no account that a single loss locks them out of, so there is no change that reduces lockouts. To see what happens when two things '
      + 'are lost at once, choose a change under “Choose a change yourself” below: the comparison shows it under “Lockout (losing two at once)”.'],
    ['noSafeMove', '閉め出しを増やさずに守れる変更は、この人の設定の中にはありません。', 'No change in this person\'s settings saves an account without adding a lockout.'],
    ['rankingSummary', '並べ方', 'How changes are ranked'],
    ['chooseLabel', '変更を自分で選ぶ', 'Choose a change yourself'], ['choosePlaceholder', '（変更を選ぶ）', '(choose a change)'],
    ['chooseHint', '（アカウントごとに、変えられるものがすべて並びます）', '(every possible change, grouped by account)'],
    // Shown only when the mode has no candidate: the guidance points to the select alone (there is nothing above to pick)
    ['noMove', '「変更を自分で選ぶ」で変更を選ぶと、変更前と変更後の結果を並べて出します。', 'Pick a change from “Choose a change yourself” to compare before and after.'],
    // The comparison: the tag of its heading, the first line of the summary and its rows
    ['compareRankTag', '{rank}位の変更を表示中', 'Showing the change ranked {rank}'],
    ['summaryLead', 'この変更で変わること（変更前→変更後）', 'What this change does (before → after)'], ['rowAttack', '攻撃', 'Attack'],
    ['attackCaption', 'カードごとに倒れるアカウントの数（変更前と変更後）', 'Accounts that fall, per card (before and after the change)'],
    ['attackColCard', 'カード', 'Card'], ['attackColBeforeAfter', '倒れる数（変更前→変更後）', 'Fallen (before → after)'],
    ['attackColSaved', '守れた', 'Saved'], ['attackColNewly', '新たに倒れる', 'Newly fallen'],
    ['attackTotal', '4枚の合計', 'Total'], ['attackMode', '選んだカード', 'selected card'],
    ['attackNames', '守れた・新たに倒れるアカウントの名前を見る', 'See the account names'],
    // The legend of the attack table
    ['attackLegendSaved', '守れた＝変更前は倒れ、変更後は倒れない', 'Saved = fell before the change, not after'],
    ['attackLegendNewly', '新たに倒れる＝変更前は倒れず、変更後は倒れる', 'Newly fallen = did not fall before the change, falls after'],
    ['attackLegendFrame', '枠の行＝上の「並べ替えの基準」で選んだカード', 'Framed row = the card chosen under “Rank changes by” above'],
    ['attackLegendTotal', '4枚の合計＝4つの行を足した数（同じアカウントを何度も数える）', 'Total = the four rows added up (the same account counts more than once)'],
    // The two lockout rows of the summary
    ['lockOneHeading', '閉め出し（スマホ・番号・メールのどれか1つを失ったとき）', 'Lockout (losing one of the phone, the number or the email)'],
    ['lockTwoHeading', '閉め出し（2つを同時に失ったとき）', 'Lockout (losing two at once)'],
    ['beforeAfterTable', '閉め出しのタブの表で、変更前と変更後を見る', 'See the table of the Lockout tab before and after the change'],
    ['lockChangesHelp', '変更の前後で印が変わったアカウントだけを出します。印の読み方は「閉め出し」のタブの表と同じです。',
      'Only the accounts whose marks change are listed. The marks read as in the table of the Lockout tab.'],
    // The columns of that table: the loss, then before or after the change
    ['phaseBefore', '変更前', 'before'], ['phaseAfter', '変更後', 'after'],
    ['sameHeading', '同じ入口のほかの変え方と比べる', 'Compare other changes to the same entrance'],
    ['sameHelp', '選んだ変更と同じ入口を、ほかのやり方で変えた場合を並べます。変え方を押すと、その変更の結果が出ます（上の比べた結果も、その変更に替わります）。',
      'Other ways to change the same entrance as the chosen change. Press one to see its result (the comparison above switches to it as well).'],
    ['sameColMove', '変え方', 'Change'], ['sameColSaved', '守れた（4枚の合計）', 'Saved (sum over 4 cards)'],
    ['sameColNewly', '新たに倒れる（4枚の合計）', 'Newly fallen (sum over 4 cards)'], ['sameColLock', '閉め出し（1つ失う）', 'Lockout (one loss)'],
    ['sameColPair', '閉め出し（2つ同時）', 'Lockout (two at once)'],
    ['sameResultLabel', '選んだ変更の結果', 'Result of the chosen change'],
    // The way back up names where it goes (a ▲ before it, hidden from screen readers)
    ['backToCompare', '比べた結果（上）へ戻る', 'Back up to the comparison'],
    ['afterMap', '変更後の地図を見る', 'See the map after the change'],
    ['mapBefore', '変更前', 'Before'], ['mapAfter', '変更後', 'After'],
    ['openTag', '入られた', 'used'], ['srLockMark', '閉め出し', 'locked out'],
    // The map after a change: what it compares and how its card is chosen, the card
    // buttons, the line on the card (the cards the change affects; with a card it does not affect, the cards to switch to; no card),
    // the count with the card and how to compare, the captions, the table, the tags of the changed entrance and the detail
    ['afterMapHelp', '選んだ変更の前と後で、攻撃カード1枚で倒れるアカウントを、地図で比べます（段を最後まで進めた結果です）。'
      + '最初は、この変更で守れるアカウントがいちばん多いカードを選んでいます。カードは下のボタンで替えます。',
    'Compare on the map which accounts fall to one attack card before and after the chosen change (the result at the last step). The card '
      + 'selected first is the one this change saves the most accounts from; switch cards with the buttons below.'],
    ['afterCardsLabel', 'この地図の攻撃カード', 'Attack card on this map'],
    ['afterCardsLine', 'この変更で倒れ方が変わるカード：{cards}', 'Cards this change affects: {cards}'],
    ['afterNoneHere', 'このカードでは、変更前と変更後で倒れるアカウントは変わりません。違いが出るのは、次のカードです。',
      'With this card, the same accounts fall before and after the change. The change makes a difference with these cards:'],
    ['afterNoneAny', 'この変更では、4枚のどのカードでも、倒れるアカウントは変わりません。',
      'With this change, the same accounts fall before and after it, whichever of the four cards is used.'],
    ['afterShowCard', '{card}で見る', 'Show {card}'],
    ['afterCountDown', '{card}では、倒れるアカウントが{before}つから{after}つに減ります。',
      'With {card}, the number of accounts that fall goes down from {before} to {after}.'],
    ['afterCompareHowto', '「変更前」と「変更後」を交互に押して、印の付いたアカウントを見比べます。',
      'Press “Before” and “After” in turn to compare the marked accounts.'],
    ['afterMapCaption', '{person}の地図（{card}・{phase}）', 'Map: {person} ({card}, {phase} the change)'],
    ['afterTableCaption', '{person}の地図の表（{card}・{phase}）', 'Map table: {person} ({card}, {phase} the change)'],
    ['afterTableHowto', 'アカウントの名前を押すと、その行のすぐ下に、変更前と変更後の倒れ方が出ます。',
      'Press an account name to see how it falls before and after the change, right under its row.'],
    ['mapBadgeSaved', '守れた', 'saved'], ['mapBadgeNewly', '新たに倒れる', 'newly fallen'],
    ['changedTagBefore', 'ここを変える', 'to change'], ['changedTagAfter', '変えた', 'changed'],
    ['removedTagBefore', 'ここを外す', 'to remove'], ['removedTagAfter', '外した', 'removed'],
    ['boxOwnSub', '{account}だけ', '{account} only'], ['boxPaperSub', '{account}用', 'for {account}'],
    ['afterDetailHeading', '{account}の倒れ方（{card}）', '{account}: how it falls to {card}'],
    ['afterDetailChanged', '変えた入口', 'Entrance changed'], ['afterDetailRemoved', '外した入口', 'Entrance removed'],
  ];
  // The word 手 (move) is not used for a change any more, nor おすすめ (a recommendation)
  for (const [key, value] of Object.entries(M.ja)) {
    if (!key.startsWith('lessonRef')) assert.doesNotMatch(value, /1手|手の前|手のあと|上位の手|付け替|おすすめ/, key);
  }
  for (const [key, ja, en] of rows) assert.deepEqual([M.ja[key], M.en[key]], [ja, en], key);
});

test('G: the step hint, the step buttons and the entrances under the lockout table are the text of the spec', () => {
  // The hint at the last step (a card or person starts there), the English last-step button that is not read as "previous
  // step", and the line under the lockout table
  const rows = [
    ['stepFirst', '最初から', 'Start over'], ['stepNext', '次の段 ▶', 'Next step ▶'], ['stepLast', '最後まで', 'Skip to end'],
    ['stepHint', '「最初から」を押すと、段0から1段ずつ追えます。', 'Press “Start over” to follow the chain one step at a time from step 0.'],
    ['lockEntrances', '{account}の入口：{entrances}', '{account}: {entrances}'],
    // On that line the SMS requirement names the phone number, the column the line explains
    ['lockTagPhone', 'SMS（電話番号）', 'SMS (phone number)'],
  ];
  for (const [key, ja, en] of rows) assert.deepEqual([M.ja[key], M.en[key]], [ja, en], key);
});

test('G: ★ and the counts summed over the four cards are explained in visible words, and the screen names that sum as the mode does', () => {
  // The legend above the map tables (tab 1 and the map after a change, one item per line) says what makes an account important
  // with ★ and defines a backdoor without a double negative; the map after a change uses the same items, and no item of "this step"
  // (that map is always at its last step)
  assert.equal(M.ja.legendStar, '★＝人物ごとに、失うと困るものとして選んだ3つのアカウント（ふだん使うメールや、お金を扱うものなど）');
  assert.equal(M.en.legendStar, '★ = three accounts chosen for each person as the ones they can least afford to lose (the main email, accounts that hold '
    + 'money, and so on)');
  assert.deepEqual([M.ja.legendBackdoor, M.en.legendBackdoor], ['裏口＝復旧の入口を通って倒れた', 'backdoor = fell through a recovery entrance']);
  for (const lang of ['ja', 'en']) {
    const p = persona('worker'), after = V.afterMap(p, 'replace:mailMain.recMail:mailOld>paper:mailMain', 'mail');
    const items = V.afterLegend(p, pv('worker'), after, 'after', M, lang).flatMap((group) => group.items.map((item) => item.text));
    for (const key of ['legendStar', 'legendBackdoor', 'legendRank', 'legendVia', 'attackLegendSaved', 'attackLegendNewly']) {
      assert.ok(items.includes(M[lang][key]), lang + ': ' + key);
    }
    assert.ok(!items.includes(M[lang].legendThisStep) && !items.includes(M[lang].legendNone), lang + ': no step in the legend after a change');
  }
  // The legend above the candidates of tab 3 defines ★ and the sum with the terms of the help (termImportantMeaning's three
  // accounts, and termSum with its meaning)
  for (const lang of ['ja', 'en']) {
    const T = M[lang], define = lang === 'ja' ? '＝' : ' = ';
    assert.ok(T.legendImportant.startsWith('★' + define), lang);
    const meaning = T.termSumMeaning[0].toLowerCase() + T.termSumMeaning.slice(1);
    assert.equal(T.legendSum, T.termSum + define + (lang === 'ja' ? T.termSumMeaning : meaning), lang);
  }
  assert.equal(M.ja.legendImportant, '★＝人物ごとに、失うと困るものとして選んだ3つのアカウント（ふだん使うメールや、お金を扱うものなど）');
  // Japanese: the help term is the mode's name, and every count summed over the four cards on the screen says （4枚の合計）;
  // no value says 延べ any more
  assert.equal(M.ja.termSum, M.ja.modeAll);
  for (const key of ['effectSavedAll', 'effectSavedAllImp', 'effectExposed', 'sameColSaved', 'sameColNewly', 'faceSavedAll']) {
    assert.ok(M.ja[key].includes('（' + M.ja.modeAll + '）'), key + ': ' + M.ja[key]);
  }
  assert.equal(M.ja.attackTotal, M.ja.modeAll);
  for (const [key, value] of Object.entries(M.ja)) assert.doesNotMatch(value, /延べ/, key);
  // The known effect of W2 (the office worker's suggestion for the sum of the four cards), as one line and on its button
  assert.equal(V.effectText(persona('worker'), pv('worker'), 'replace:mailMain.recMail:mailOld>paper:mailMain', 'all', M, 'ja'),
    '守れる（4枚の合計）12（うち★2）');
  assert.deepEqual(V.effectFace(persona('worker'), pv('worker'), 'replace:mailMain.recMail:mailOld>paper:mailMain', 'all', M, 'ja'),
    { label: '守れる（4枚の合計）', n: 12, imp: 'うち★2', extras: [] });
  assert.deepEqual(V.effectFace(persona('student'), pv('student'), 'replace:sub.login:mailUni>mailFree', 'lockout', M, 'ja'),
    { label: '閉め出しがなくなる', n: 1, imp: null, extras: ['新たに倒れる（4枚の合計）2'] });
  assert.deepEqual(V.effectFace(persona('worker'), pv('worker'), 'replace:sns.recMail:mailMain>paper:sns', 'leak', M, 'en'),
    { label: 'Saves', n: 1, imp: null, extras: ['Two-at-once lockouts added: 1'] });
  // Every button says the same as its one-line effect (the count, the important accounts and what else the change does)
  for (const id of PEOPLE) {
    for (const mode of ['leak', 'simswap', 'mail', 'desk', 'all', 'lockout']) {
      for (const moveId of V.candidates(persona(id), pv(id), mode).ids) {
        for (const lang of ['ja', 'en']) {
          const face = V.effectFace(persona(id), pv(id), moveId, mode, M, lang), T = M[lang];
          const first = mode === 'lockout' ? V.fill(T.effectUnlocked, { n: face.n })
            : V.fill(T[(mode === 'all' ? 'effectSavedAll' : 'effectSaved') + (face.imp ? 'Imp' : '')], { n: face.n, imp: (face.imp || '').replace(/\D/g, '') });
          assert.equal([first, ...face.extras].join(T.effectSep), V.effectText(persona(id), pv(id), moveId, mode, M, lang), id + ' ' + mode + ' ' + moveId);
        }
      }
    }
  }
});

test('G: the first steps of the help go from the office worker\'s breach to the parent\'s lockout (×), then one change', () => {
  assert.equal(M.ja.helpFirstText, '最初に「連鎖を追う」のタブで、会社員の「漏えい」のカードを選び、「次の段 ▶」で1段ずつ進めます。'
    + '次に人物を高齢の親に替え、見どころの「電話番号を手放すと、ネットバンキングに入れない」を押して、「閉め出し」の表の×を見ます。'
    + '最後に「1つ変えて比べる」のタブで、同じ高齢の親について上位の変更を押し、変更前と変更後を比べてください。');
  assert.equal(M.en.helpFirstText, 'Start in the “Follow the chain” tab: with the office worker\'s “Breach” card, press “Next step ▶” to go one step at a '
    + 'time. Next, switch the person to the older parent, press the highlight “Give up the number, and you are locked out of online banking” and see the '
    + '× in the “Lockout” table. Finally, in the “Try one change” tab, press a top change for the same older parent and compare before and after the change.');
  // The route names the tabs and the parent's highlight as the screen names them, and that highlight opens the lockout tab
  // on the parent's bank, which is locked out after giving up the number (×)
  const p2 = V.highlights.find((h) => h.id === 'P2');
  assert.deepEqual([p2.person, p2.state.tab, p2.state.account], ['parent', 'lockout', 'bank']);
  assert.equal(pv('parent').lossTable.cells.number.bank.mark, 'locked');
  for (const lang of ['ja', 'en']) {
    const T = M[lang], quote = (text) => (lang === 'ja' ? '「' + text + '」' : '“' + text + '”');
    for (const text of [T.tabChain, T.tabLockout, T.tabCompare, V.highlightTitle(p2, pv('parent'), M, lang)]) {
      assert.ok(T.helpFirstText.includes(quote(text)), lang + ': ' + text);
    }
    assert.ok(T.helpFirstText.indexOf(quote(T.tabChain)) < T.helpFirstText.indexOf(quote(T.tabLockout))
      && T.helpFirstText.indexOf(quote(T.tabLockout)) < T.helpFirstText.indexOf(quote(T.tabCompare)), lang + ': the order of the tabs');
  }
});

test('G: the numbers in the stories follow the data', () => {
  const uses = (id, family) => persona(id).services.filter((s) => s.methods.some((m) => m.requires.includes(family)));
  const worker = uses('worker', 'pw:red').length;
  assert.equal(Number(M.ja.storyWorker.match(/パスワードAを(\d+)つ/)[1]), worker);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  assert.equal(words[M.en.storyWorker.match(/on (\w+) accounts/)[1]], worker);
  assert.equal(new Set(persona('parent').credentials.filter((c) => c.type === 'pw').map((c) => c.family)).size, 1);
  const shortNames = uses('student', 'pw:green').map((s) => V.names(persona('student'), M, 'ja').short[s.id]);
  assert.deepEqual(M.ja.storyStudent.match(/パスワードAを、(.+?)で使い回し/)[1].split('・'), shortNames);
});

// Tab 4 and the printed sheets, from the screen text table of the spec ("タブ4 規則表・ヘルプ・印刷"), the rules table
// (eleven rows: the password symbol rule and the breach plain-text case are two rules), the symbols table ("記号の一覧")
// and the section on printing ("印刷"): key, Japanese, English
const RULES_TEXT = [
  ['rulesHeading', '規則表（単純化したシミュレーション）', 'Rules (a simplified model)'],
  ['rule1', 'アカウントには入口がある。ログインの入口と、復旧（再設定）の入口がある', 'An account has entrances: log-in entrances and recovery (reset) entrances'],
  ['rule2', '1つの入口の条件は「かつ」。全部そろえば開く（例：パスワード＋SMSのコード）', 'All requirements of one entrance must be met (AND), e.g. password + SMS code'],
  ['rule3', '入口どうしは「または」。どれか1つ開けば入れる', 'Any one entrance is enough (OR)'],
  ['rule4', '攻撃者は、カードで最初に手にしたものから始める。倒れたメールのアカウントも、次の入口の条件に使う。新しく倒れるアカウントがなくなるまで繰り返し、1回の繰り返しで新しく倒れた分を1段と数える',
  'The attacker starts from what the card gives first and uses every fallen email account for further entrances, until no new account falls. Each round of '
    + 'newly fallen accounts is one step'],
  ['rule5', 'パスワードはA・B・Cなどの記号で表す（人物ごと）。同じ記号なら、どのアカウントでも同じパスワードとみなす（少し変えただけのものを含む）',
  'Passwords are shown as letters such as A, B and C (per person). The same letter counts as the same password everywhere, small variations included'],
  ['rule6', '漏えいのカードは、漏れたサービスのIDとパスワードが、そのまま（平文で）出回った場合を表す。そのときは、パスワードが長くても、'
    + '同じパスワードを使う入口ではパスワードの条件がそろう',
  'A breach card stands for the case where the breached service\'s ID and password have leaked as-is (in plain text); then the password requirement is met '
    + 'on every entrance that uses that password, however long it is'],
  ['rule7',
  'SMSの条件は、電話番号を持っていれば満たす。攻撃者が電話番号を手にするのは、SIMスワップのカードのときだけ',
  'An SMS requirement is met by holding the phone number; the attacker gets the phone number only with the SIM-swap card'],
  ['rule8',
  '電話の窓口は、個人情報を答えられれば再設定に応じる。書類での本人確認（身分証・郵送）を破るカードはない',
  'A phone help desk resets the account for anyone who can answer with the personal details; no card defeats a document check (photo ID, postal mail)'],
  ['rule9', 'パスキーと認証アプリはスマホの中の鍵として扱う。紙の回復コードは本人の手元にだけある',
  'Passkeys and authenticator apps are treated as keys inside the phone; paper recovery codes exist only in the owner\'s hands'],
  ['rule10', '閉め出し＝本人が失ったもの（1つ、または2つ同時）を外し、手元に残ったものから同じ規則で入れないアカウント。消えたメールそのものは「消えた」と表し、閉め出しには数えない。パスワードを忘れることは扱わない',
  'Lockout: after removing what the owner lost (one thing, or two at once), the accounts they cannot reach by the same rules from what remains. A vanished '
    + 'email itself is shown as gone and is not counted as locked out. Forgetting a password is not modeled'],
  ['rule11', '時間・確率・通知・不審なログインの検知は扱わない', 'Time, probability, notifications and detection of suspicious log-ins are not modeled'],
  ['rule2Example', '例：会社員のネット銀行の再設定はSMS＋個人情報です。SIMスワップのカード1枚では個人情報がないので倒れません。「かつ」を「または」として数えると、ここで倒れたことになってしまいます。',
  'Example: the office worker\'s online bank resets with SMS + personal details. The SIM-swap card alone lacks the personal details, so the bank does not '
    + 'fall. Counting AND as OR would wrongly make it fall here.'],
  ['symbolColSymbol', '記号', 'Symbol'],
  ['symbolColMeaning', '何を表すか', 'Meaning'],
  ['symbolColAttack',
  '攻撃者がこれを手にするカード',
  'Attack card that gives it to the attacker'],
  ['symbolColLoss',
  '本人がこれを失う場合',
  'When the owner loses it'],
  ['notInModel', 'このシミュレーションで扱わないもの', 'Not in this model'],
  ['notInModel1', 'パスワードの強さ', 'Password strength'],
  ['notInModel2', '攻撃の確率・手間・時間', 'Attack probability, effort and time'],
  ['notInModel3', '不審なログインの検知と通知', 'Detection of suspicious log-ins and notifications'],
  ['notInModel4', '同期パスキーをクラウドの復旧で取り出す経路', 'Retrieving synced passkeys through cloud recovery'],
  ['notInModel5', '端末の感染', 'Infected devices'],
  ['notInModel6', '書類の偽造', 'Forged documents'],
  ['notInModel7', 'パスワードを忘れること', 'Forgetting a password'],
  ['notInModel8', 'SSOとパスワード管理ソフト', 'Single sign-on and password managers'],
  ['notInModel9', '乗っ取ったあとに攻撃者が再設定先を書き換えること', 'An attacker changing recovery details after a takeover'],
  ['notInModel10', '漏れたパスワードがハッシュで守られていて解けない場合', 'Leaks where the passwords are protected by hashing and cannot be cracked'],
  // Phishing: the model treats the codes of an authenticator app and passkeys alike as keys inside the phone, so that the
  // resistance of passkeys to fake sites does not show in the counts. One short noun phrase like the ten items before it,
  // without 「と、」, so that the list of README.md (joined with 、) still reads as eleven items
  ['notInModel11', 'フィッシング（偽サイトでの入力。パスキーはこれに強い）', 'Phishing on fake sites (which passkeys resist)'],
  ['paperHeading', '自分のアカウントを紙に書いて確かめる', 'Check your own accounts on paper'],
  ['paperFormIntro',
  '自分のアカウントのつながり（どのアカウントを、どのメールや電話番号で再設定できるか）は、この画面には入力しません。印刷した空欄の用紙に、パスワードそのものは書かずに記号で書きます。用紙には「保管注意（弱点の地図）」の欄があります。',
  'Your own accounts and how they connect (which account can be reset with which email or phone number) are never entered on this page. Print the blank '
    + 'sheet and fill it in with symbols, without the passwords themselves. The sheet has a “Keep safe (map of weak points)” box.'],
  ['printButton', '印刷する（3人の地図と空欄の用紙）', 'Print (three maps and a blank sheet)'],
  ['printTitle', '{person}の地図（架空の人物）', 'Map: {person} (fictional)'],
  ['printDisclaimer',
  'この地図は、架空の人物のアカウントを、単純化した規則で数えた結果です。実際のサービスは、不審なログインの検知や通知も持っています。書類での本人確認を破る手口と、パスワードを忘れた場合は数えていません。',
  'This map counts a fictional person\'s accounts with simplified rules. Real services also detect suspicious log-ins and send notifications. Tricks that '
    + 'defeat a document check and forgotten passwords are not counted.'],
  ['formTitle', 'わたしの地図（記号で書く用紙）', 'My map (fill in with symbols)'],
  ['formColNo', 'No.', 'No.'],
  ['formColAccount', 'アカウント（略称）', 'Account (short)'],
  ['formColImportant', '★', '★'],
  ['formColRole', '入口の種類', 'Entrance'],
  ['formRoleCell', 'ログイン・復旧', 'Log-in / Recovery'],
  ['formColReq', '条件（記号）', 'Requirements (symbols)'],
  ['formColNotes', 'メモ', 'Notes'],
  ['printColAccount', 'アカウント', 'Account'],
  ['printColEntrances', '入口', 'Entrances'],
  ['printColLeak', '漏えい', 'Breach'],
  ['printColSimswap', 'SIMスワップ', 'SIM swap'],
  ['printColMail', 'メールの乗っ取り', 'Email takeover'],
  ['printColDesk', 'ソーシャルエンジニアリング', 'Social engineering'],
  ['printColPhone', 'スマホ', 'Phone'],
  ['printColNumber', '番号', 'Number'],
  ['printColMailLoss', '{mailHead}', '{mailHead}'],
  ['printBackdoor', '裏口', 'backdoor'],
  ['printLegendAttack',
  '攻撃カードの列＝そのカード1枚で、何段目に倒れるか（●0＝最初に乗っ取られたメール、－＝倒れない、裏口＝復旧の入口を通って倒れた）',
  'Attack cards = the step the account falls at (●0 = email taken over first, – = does not fall, backdoor = fell via recovery)'],
  ['printLegendLoss',
  '失ったときの列＝それを失っても本人が入れるか（○＝入れる、×＝入れない、消えた＝そのメール自体がなくなった、△（番号も失うと×）＝いまは入れるが、番号も一緒に失うと入れない）',
  'When lost = can the owner still get in (○ = yes, × = locked out, gone = email itself gone, △ (× if the number goes too) '
    + '= yes now, but one more loss locks you out)'],
  ['printLegendStar',
  '★＝重要なアカウント（人物ごとに、失うと困るものとして選んだ3つ）',
  '★ = important (three per person)'],
  ['printGroupAttack', '攻撃カード', 'Attack cards'],
  ['printGroupLoss', '失ったとき', 'When lost'],
  ['formHow1', 'アカウントの名前は略してよい（例：メイン、銀行）。', 'Account names may be shortened (e.g. Main, Bank).'],
  ['formHow2', 'パスワードは書かない。同じパスワード（少し変えたものを含む）には同じ記号を付ける（A・B・Cなど）。',
  'Do not write passwords. Give the same letter to the same password, including slight variations (A, B, C and so on).'],
  ['formHow3', '入口ごとに1行。「入口の種類」の欄で、ログインか復旧のどちらかに○を付ける。必要なものが2つ以上なら＋でつなぐ（例：A＋SMS）。',
  'One line per entrance. In the “Entrance” column, circle log-in or recovery. Join two or more requirements with + (e.g. A + SMS).'],
  ['formHow4', '書き終えたら、多くのアカウントの再設定先になっているメールを探し、電話番号1本に頼る入口を数える。',
  'When finished, find the email that many accounts use for recovery, and count the entrances that rely on a single phone number.'],
  ['formHow5', '★の欄には、失うと困るアカウントに印を付ける。', 'In the ★ column, mark the accounts you can least afford to lose.'],
];
// The symbols table of what an entrance needs (Japanese, then English): seven rows of four columns, no blank cell
const SYMBOLS = {
  ja: [
    ['パスワードA・B・C', '人物ごとに、使っているパスワードに付けた記号（同じ記号は同じパスワード）', '漏えい（漏れたサービスのパスワード）', '（扱わない）'],
    ['スマホ', '認証アプリ・パスキー', '（なし。端末の感染は扱わない）', 'スマホをなくした'],
    ['SMS', '電話番号に届くコード', 'SIMスワップ', '電話番号を手放した'],
    ['個人情報', '電話の窓口で答える情報', 'ソーシャルエンジニアリング', '（なくさない扱い）'],
    ['書類', '身分証・郵送での本人確認', '（なし。偽造は扱わない）', '（なくさない扱い）'],
    ['回復コード（紙）', '紙の回復コード（変更で増える）', '（なし）', '紙の回復コードをなくした（「1つ変えて比べる」のタブで、2つを同時に失ったときだけ使う）'],
    ['メールの名前', 'メールのアカウント', 'メールの乗っ取り（人ごとに1つ＝会社員は古いメール、親はプロバイダーのメール、学生は大学のメール）', 'メールが消えた（同じく人ごとに1つ）'],
  ],
  en: [
    ['Password A, B, C',
      'Letters for the passwords each person uses (the same letter means the same password)',
      'Breach (the password of the breached service)',
      '(not modeled)'],
    ['Phone', 'Authenticator app, passkey', '(none; infected devices are not covered)', 'Lost the phone'],
    ['SMS', 'Code sent to the phone number', 'SIM swap', 'Gave up the phone number'],
    ['Personal details', 'Answers given to a phone help desk', 'Social engineering', '(treated as never lost)'],
    ['Documents', 'Identity check with photo ID or postal mail', '(none; forgery is not covered)', '(treated as never lost)'],
    ['Paper codes',
      'Paper recovery codes (added by a change)',
      '(none)',
      'Lost the paper recovery codes (used only in the “Try one change” tab, for two losses at once)'],
    ['Email name',
      'An email account',
      'Email takeover (one per person: the old email, the ISP email, the university email)',
      'Email gone (one per person, likewise)'],
  ],
};
// The four notes of the rules tab, as the spec writes them (the related tools are links on the screen)
const RULE_NOTES = {
  ja: [
  '攻撃者がSMSのコードを受け取れるのは、SIMスワップのカードのときだけです。根拠の研究（Leeら、SOUPS 2020。携帯会社を調べたのは2019年）は、米国のプリペイドの携帯会社5社を'
    + '調べたものです。日本の携帯会社でも同じように起きるとは限りません。',
  'パスキーと認証アプリはスマホの中の鍵として扱います。このため、パスキーが偽サイトに強いことは数に出ません。同期したパスキーをクラウドのアカウントの復旧で取り出す経路と、端末の感染で乗っ取る経路は、このシミュレーションでは扱いません。このシミュレーションには、攻撃者がスマホを手にするカードがないので、'
    + 'スマホの認証アプリかパスキーを追加しても、攻撃で倒れるアカウントは増えません。スマホを失ったときの結果は、認証アプリやパスキーを、ほかの端末やクラウドに同期・バックアップしていない場合のものです。',
  '電話の窓口は、個人情報を答えられれば本人とみなす設定です。このシミュレーションには、書類での本人確認を破るカードも、本人が書類をなくす場合もありません。そのため、再設定を書類での本人確認に切り替えても、攻撃で倒れるアカウントも閉め出しも増えません。実際には、書類は偽造されることがあり、'
    + '窓口での再設定には日数もかかります。実在するサービスの本人確認の手順は、ここには載せていません。',
  '紙の回復コードは本人の手元にだけあります。このシミュレーションには、攻撃者が紙の回復コードを手にするカードがありません。そのため、紙の回復コードに切り替えても、攻撃で倒れるアカウントは増えません。実際には、紙の置き場所が新しい弱点になります。また、回復コードは手で入力するので、'
    + '偽サイトに入力すると盗まれます。本人の側では、紙をほかのもの（スマホなど）と一緒になくすと、入れなくなることがあります。紙を分けて保管する方法は、Day124 Scatter SeedsとDay125 Overlay QR Sharesで試せます。',
  ],
  en: [
  'The attacker can receive SMS codes only with the SIM-swap card. The study behind this (Lee et al., SOUPS 2020; carriers checked in 2019) looked at '
    + 'five US prepaid carriers; Japanese carriers may differ.',
  'Passkeys and authenticator apps are treated as keys inside the phone. So passkeys\' resistance to fake sites does not show in the numbers. Retrieving '
    + 'synced passkeys through cloud-account recovery, and takeover through an infected device, are outside this model. No card here gives the attacker the '
    + 'phone, so adding an authenticator app or passkey never adds fallen accounts. The results for losing the phone assume the authenticator app and '
    + 'passkeys are not synced or backed up to another device or the cloud.',
  'A phone help desk is set to accept anyone who can answer with the personal details. This model has no card that defeats a document check and no case of '
    + 'the owner losing their documents, so switching a reset to a document check adds neither fallen accounts nor lockouts. In reality, documents can be '
    + 'forged, and a reset at a desk takes days. The identity checks of real services are not described here.',
  'Paper recovery codes exist only in the owner\'s hands. No card here gives the attacker the paper codes, so switching to paper codes never adds fallen '
    + 'accounts. In reality, where you keep the paper becomes a new weak point, and since the codes are typed by hand, typing them into a fake site gives '
    + 'them away. For the owner, losing the paper together with something else (such as the phone) can lock you out. To keep them split across places, try '
    + 'Day124 Scatter Seeds and Day125 Overlay QR Shares.',
  ],
};
// The four notes as app.js puts them together (the note on passkeys ends with the phone note of the lockout tab, and the
// paper note carries the 2nd to 4th sentences that tab 3 uses after a change to paper)
const ruleNotes = (lang) => {
  const T = M[lang];
  return [T.ruleNoteSms, V.fill(T.notePasskey, { sync: T.lockNoteSync }), T.noteDesk,
    V.fill(T.notePaperRules, { paper: T.notePaper, day124: T.toolDay124, day125: T.toolDay125 })];
};

test('G: the screen text of tab 4 and of the printed sheets is the text of the spec', () => {
  for (const [key, ja, en] of RULES_TEXT) assert.deepEqual([M.ja[key], M.en[key]], [ja, en], key);
  // What the model leaves out: eleven items, numbered without a gap (the list of the rules tab shows them all)
  assert.deepEqual(Object.keys(M.ja).filter((key) => /^notInModel\d+$/.test(key)), Array.from({ length: 11 }, (_, i) => 'notInModel' + (i + 1)));
  for (const lang of ['ja', 'en']) {
    const symbols = V.symbolTable(M, lang);
    assert.deepEqual(symbols.columns, ['symbolColSymbol', 'symbolColMeaning', 'symbolColAttack', 'symbolColLoss']
      .map((key) => M[lang][key]), lang);
    assert.deepEqual(symbols.rows.map((row) => row.cells), SYMBOLS[lang], lang);
    assert.deepEqual(ruleNotes(lang), RULE_NOTES[lang], lang);
  }
  // The keep-safe box and the dates line of the blank sheet (Japanese as the spec writes them; the English box title is the
  // one the paper intro names, and the English dates line carries the three labels of the spec)
  assert.equal(M.ja.formKeepTitle, '保管注意（弱点の地図）');
  assert.equal(M.ja.formKeepText, 'この用紙には、どのアカウントに何があれば入れるか、という弱点の地図を書きます。パスワードそのものは書かず、'
    + 'A・B・Cの記号だけを書きます。写真に撮ったり、クラウドやメッセージで送ったりしないでください。人目に触れない場所に保管し、'
    + '要らなくなったら細かく破いて捨ててください。');
  assert.equal(M.ja.formDates, '書いた日：＿＿＿＿　保管する場所：＿＿＿＿＿＿　見直す日：＿＿＿＿');
  assert.ok(M.en.paperFormIntro.includes('“' + M.en.formKeepTitle + '”') && M.ja.paperFormIntro.includes('「' + M.ja.formKeepTitle + '」'));
  for (const label of ['Date written', 'Kept at', 'Review on']) assert.ok(M.en.formDates.includes(label + ':'), label);
  // The lines under the legend of each printed page name the marks of the table cells: the attack columns (none, the email
  // taken over first, backdoor) and the columns of the losses (can get in, locked out, gone, one more loss)
  for (const lang of ['ja', 'en']) {
    const L = M[lang];
    for (const mark of [L.cellNone, '●0', L.printBackdoor]) assert.ok(L.printLegendAttack.includes(mark), lang + ': ' + mark);
    for (const mark of [L.cellOk, L.cellLocked, L.cellGone, V.fill(L.cellPlus1, { p: L.partnerNumber })]) {
      assert.ok(L.printLegendLoss.includes(mark), lang + ': ' + mark);
    }
    assert.ok(L.printLegendStar.startsWith('★'), lang);
  }
});

// The three people of the spec ("3人（既知の値）"), row by row: account (★ and full name), entrances (symbols), the four
// attack cards, the three losses. The print leaves out the "（パスキー）" the spec adds to the brokerage's phone.
const PRINT_TABLES = {
  worker: [
    ['★メインのメール', 'ログイン：パスワードA／復旧：SMS／復旧：古いメール', '●1', '●1裏口', '●1裏口', '●2裏口', '○', '○', '○'],
    ['古いメール（前のプロバイダー）', 'ログイン：パスワードC／復旧：個人情報', '－', '－', '●0', '●1裏口', '○', '○', '消えた'],
    ['ポイントアプリ', 'ログイン：パスワードA／復旧：メインのメール', '●1', '●2裏口', '●2裏口', '●3裏口', '○', '○', '○'],
    ['通販（クレジットカード登録あり）', 'ログイン：パスワードA／復旧：メインのメール', '●1', '●2裏口', '●2裏口', '●3裏口', '○', '○', '○'],
    ['SNS', 'ログイン：パスワードA＋SMS／復旧：メインのメール', '●2裏口', '●2裏口', '●2裏口', '●3裏口', '○', '○', '○'],
    ['フリマアプリ（売上金）', 'ログイン：SMS／復旧：メインのメール', '●2裏口', '●1', '●2裏口', '●3裏口', '○', '○', '○'],
    ['写真のクラウド', 'ログイン：パスワードA＋スマホ／復旧：メインのメール', '●2裏口', '●2裏口', '●2裏口', '●3裏口', '○', '○', '○'],
    ['★ネット銀行', 'ログイン：パスワードB＋スマホ／復旧：SMS＋個人情報', '－', '－', '－', '－', '△（番号も失うと×）', '△（スマホも失うと×）', '○'],
    ['★ネット証券', 'ログイン：スマホ／復旧：メインのメール＋SMS', '－', '●2裏口', '－', '－', '△（番号も失うと×）', '△（スマホも失うと×）', '○'],
  ],
  parent: [
    ['★プロバイダーのメール', 'ログイン：パスワードA／復旧：個人情報', '●1', '－', '●0', '●1裏口', '○', '○', '消えた'],
    ['★銀行のネットバンキング', 'ログイン：パスワードA＋SMS／復旧：SMS', '－', '●1裏口', '－', '－', '△（番号も失うと×）', '×', '△（番号も失うと×）'],
    ['ポイントアプリ', 'ログイン：パスワードA／復旧：プロバイダーのメール', '●1', '－', '●1裏口', '●2裏口', '○', '○', '○'],
    ['通販', 'ログイン：パスワードA／復旧：プロバイダーのメール', '●1', '－', '●1裏口', '●2裏口', '○', '○', '○'],
    ['メッセージアプリ（家族との連絡）', 'ログイン：スマホ／復旧：SMS＋パスワードA', '－', '－', '－', '－', '△（番号も失うと×）', '△（スマホも失うと×）', '○'],
    ['写真のクラウド', 'ログイン：パスワードA／復旧：プロバイダーのメール', '●1', '－', '●1裏口', '●2裏口', '○', '○', '○'],
    ['★ネット証券（NISA）', 'ログイン：スマホ／復旧：プロバイダーのメール＋SMS', '－', '－', '－', '－', '△（番号かプロバイダーのメールも失うと×）', '△（スマホも失うと×）', '△（スマホも失うと×）'],
  ],
  student: [
    ['大学のメール', 'ログイン：パスワードB＋スマホ／復旧：書類', '－', '－', '●0', '－', '○', '○', '消えた'],
    ['★フリーメール', 'ログイン：パスワードA／復旧：大学のメール／復旧：SMS', '●1', '●1裏口', '●1裏口', '－', '○', '○', '○'],
    ['★SNS', 'ログイン：パスワードA／復旧：大学のメール', '●1', '－', '●1裏口', '－', '○', '○', '○'],
    ['ゲーム（課金・アイテム）', 'ログイン：パスワードA／復旧：フリーメール', '●1', '●2裏口', '●2裏口', '－', '○', '○', '○'],
    ['フリマアプリ', 'ログイン：SMS／復旧：フリーメール', '●2裏口', '●1', '●2裏口', '－', '○', '○', '○'],
    ['動画のサブスク（学割）', 'ログイン：大学のメール', '－', '－', '●1', '－', '△（大学のメールも失うと×）', '△（大学のメールも失うと×）', '×'],
    ['★ネット証券（つみたて）', 'ログイン：スマホ／復旧：フリーメール', '●2裏口', '●2裏口', '●2裏口', '－', '○', '○', '○'],
  ],
};
const PRINT_HEADS = {
  ja: ['アカウント', '入口', '漏えい', 'SIMスワップ', 'メールの乗っ取り', 'ソーシャルエンジニアリング', 'スマホ', '番号'],
  en: ['Account', 'Entrances', 'Breach', 'SIM swap', 'Email takeover', 'Social engineering', 'Phone', 'Number'],
};
const PRINT_MAIL_HEAD = { worker: ['古いメール', 'Old email'], parent: ['プロバイダーのメール', 'ISP email'], student: ['大学のメール', 'University email'] };
const printRows = (table) => table.rows.map((row) => [(row.important ? '★' : '') + row.name, row.entrances, ...row.attack, ...row.loss]);
const capital = (id) => id[0].toUpperCase() + id.slice(1);

test('G: the printed map of each person is the table of the spec (9, 7 and 7 rows), with its title, story and headings', () => {
  for (const id of PEOPLE) {
    const ja = V.printTable(persona(id), pv(id), M, 'ja');
    assert.deepEqual(printRows(ja), PRINT_TABLES[id], id);
    assert.deepEqual(ja.columns, [...PRINT_HEADS.ja, PRINT_MAIL_HEAD[id][0]], id);
    const en = V.printTable(persona(id), pv(id), M, 'en');
    assert.deepEqual(en.columns, [...PRINT_HEADS.en, PRINT_MAIL_HEAD[id][1]], id);
    for (const [lang, table] of [['ja', ja], ['en', en]]) {
      assert.equal(table.title, V.fill(M[lang].printTitle, { person: M[lang]['person' + capital(id)] }), id);
      assert.equal(table.story, M[lang]['story' + capital(id)], id);
    }
    // English: the same marks (the backdoor mark is " backdoor", none is "–"), as many entrances, and no Japanese
    const toEnglish = (cell) => cell.replace(/^(●\d)裏口$/, '$1 backdoor').replace(/^－$/, '–');
    printRows(en).forEach((row, i) => {
      assert.deepEqual(row.slice(2, 6), PRINT_TABLES[id][i].slice(2, 6).map(toEnglish), id + ' ' + row[0]);
      assert.equal(row[1].split(' / ').length, PRINT_TABLES[id][i][1].split('／').length, id + ' ' + row[1]);
      assert.doesNotMatch(row.join(' '), JAPANESE, id);
    });
  }
  assert.deepEqual(PEOPLE.map((id) => PRINT_TABLES[id].length), [9, 7, 7]);
  // Known English rows (the entrances written out, "Log-in: Password A / Recovery: SMS", and the cells of the lockout tables)
  const worker = printRows(V.printTable(persona('worker'), pv('worker'), M, 'en'));
  assert.deepEqual(worker[0], ['★Main email', 'Log-in: Password A / Recovery: SMS / Recovery: Old email', '●1', '●1 backdoor', '●1 backdoor',
    '●2 backdoor', '○', '○', '○']);
  assert.deepEqual(worker[8], ['★Online brokerage', 'Log-in: Phone / Recovery: Main email + SMS', '–', '●2 backdoor', '–', '–',
    '△ (× if the number goes too)', '△ (× if the phone goes too)', '○']);
  const parent = printRows(V.printTable(persona('parent'), pv('parent'), M, 'en'));
  assert.deepEqual(parent[6].slice(6), ['△ (× if the number or the ISP email goes too)', '△ (× if the phone goes too)',
    '△ (× if the phone goes too)']);
});

// ===== The lessons of the help =====
// The names of the ten lessons of the spec (the title adds the number)
const LESSON_NAMES = ['アカウントの地図と「かつ・または」', '使い回しとリスト型攻撃', '復旧の入口は、攻撃者の入口にもなる（裏口）', 'SMSとSIMスワップ',
  'ソーシャルエンジニアリングと電話の窓口', 'パスキーと証券口座', '閉め出し', '外すか、切り替えるか（紙の回復コード）', 'シミュレーションの決まりと、論文の定義との違い',
  '関連ツールと、パスワード管理ソフトの点検機能との違い'];
const lessonText = (n, lang) => Object.keys(M[lang]).filter((k) => new RegExp('^lesson' + n + 'Text\\d+$').test(k)).map((k) => M[lang][k]).join('\n');
// The sentences the spec gives for the lessons, word for word (Japanese, then English when the spec gives it too)
const LESSON_SENTENCES = [
  ['lesson2Text3', '2026年10月、国内のポイントサイトで、よそで漏れたIDとパスワードの組によって不正にログインされた可能性のあるアカウントが249件あると'
    + '公表されました。', null],
  ['lesson9Text2', 'この例は、パスワードも失うことがある論文の決め方で比べたものです。画面の閉め出しの表（スマホ・電話番号・メールを失う）とは別の例です。', null],
  ['lesson9Text3', '2020年に20人を面接した研究（CHI 2022）では、2つのメールが互いの再設定先になっている輪が3つ見つかっています。', null],
  ['lesson9Text4', '裏口の印は、Hammannらの定義26を点数なしの二値（印がある・ないの2つだけ）にしたものです（このカードで倒れたアカウントのうち、'
    + '復旧の入口をまとめて外した地図では倒れないものが裏口）。変更の比較は、入口や条件を1つずつ変えて前後を比べる形にしました。'
    + '論文の点数とaccess set（アカウントに入るのに足りる組み合わせ）の全列挙は持ちません。', null],
  ['lesson10Text1', 'Day083 Intrusion Path Mapperでも、アカウントをノードにして「メールが乗っ取られたらどこまで届くか」を見られます。ただしDay083の経路は'
    + '1本の道筋で、成功確率は各ノードの値の積です。本ツールは、2つの鍵がそろったときだけ開く「かつ」（多要素）、1つのパスワードが複数のアカウントを'
    + '同時に開く使い回し、復旧の入口、本人の閉め出しを、決まった規則で扱います。',
  'Day083 Intrusion Path Mapper can also show, with accounts as nodes, how far a hijacked email account reaches. Its paths are single chains, '
    + 'though, and their success probability is a product of per-node values. This tool applies fixed rules to an account that opens only when '
    + 'two keys are both present (multi-factor), one password opening several accounts at once (reuse), recovery entrances, and the owner being '
    + 'locked out.'],
];
// Phrases that the English text must carry (the wording given for the English lessons), lesson by lesson
const ENGLISH_PHRASES = {
  // The announcement is told in the passive, as the Japanese text tells it (the points site is not the one that announced it)
  2: ['249 accounts that may have been logged into without authorization', '43–51%', 'circulates as-is',
    'the password requirement is met on every entrance', 'it was announced that a points site in Japan had 249 accounts'],
  3: ['81.1% of 239 sites', 'A 2018 study', '37 of 71 sites', '26 of them by email alone', 'German- and English-language sites',
    'banking and investment sites', 'were excluded', 'In 2022'],
  4: ['“restricted”', 'a US federal guideline, not an obligation for Japanese companies', 'five US prepaid carriers in 2019'],
  5: ['noted that help-desk social engineering', 'was being discussed, and recommended reviewing reset procedures',
    '(for organizations\' internal help desks)'],
  6: ['a self-regulatory guideline', 'supervisory guidelines', 'Neither is a law.', '“multifactor authentication resilient to phishing attacks”',
    '“make it essential (set as initial setting)”', 'the cryptography was not broken'],
  7: ['interviews with 20 people in 2020', 'A study that asked 185 users of either of two major providers\' accounts (about half living in the US, '
    + 'half in Germany) about their settings in January 2023 found that 27 of them (10 for one provider plus 17 for the other) could be locked '
    + 'out by losing a single thing, nearly always their main phone'],
  // NIST §3.1.2 in its own shape (saved recovery codes are a typical use of look-up secrets), and the three ways of recovery
  // at AAL2 of §4.2.2.2, a requirement (SHALL) like §4.2.1.1 before it
  8: ['does not necessarily rule out lockout', 'Saved recovery codes are a typical use of what NIST calls look-up secrets',
    'For recovery at AAL2, NIST requires one of these',
    'one recovery code together with a single-factor authenticator, or repeated identity proofing for an identity-proofed account'],
  // The two points on Definition 18 are what this teaching aid derived and checked, told apart from what the paper defines;
  // the least fixed point misses some lockouts in a cycle, not all (a cycle where it misses none is possible)
  9: ['three cycles were found in which two emails were each other\'s recovery address',
    'Definition 18 in the paper defines lockout as a least fixed point', 'The next two points were derived and checked for this teaching aid',
    'can miss lockouts when recovery forms a cycle'],
};

test('G: the lessons: the titles name the ten lessons of the spec, and the sentences the spec gives are used word for word', () => {
  LESSON_NAMES.forEach((name, i) => assert.equal(M.ja['lesson' + (i + 1) + 'Title'], (i + 1) + '. ' + name));
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    assert.match(M.en['lesson' + n + 'Title'], new RegExp('^' + n + '\\. [A-Z]'));
    for (const lang of ['ja', 'en']) assert.ok(lessonText(n, lang).length > 50, n + ' ' + lang);
  }
  for (const [key, ja, en] of LESSON_SENTENCES) {
    assert.ok(M.ja[key].includes(ja), key);
    if (en) assert.ok(M.en[key].includes(en), key);
  }
  for (const [n, phrases] of Object.entries(ENGLISH_PHRASES)) {
    for (const phrase of phrases) assert.ok(lessonText(n, 'en').includes(phrase), 'lesson ' + n + ': ' + phrase);
  }
  // Japanese: the numbers of the studies with their year and scope, and the names the spec writes in Japanese
  const JA = {
    2: ['43〜51%', '2006〜2012年の漏えいデータで43%', '大学での調査で51%', '不正にログインされた可能性のあるアカウントが249件',
      '使い回した先の入口ではパスワードの条件がそろいます'],
    3: ['2018年の研究', '239サイトの81.1%', '2022年', 'ドイツ語と英語の71サイト', '37サイトで入り直せ', 'そのうち26はメールで足りました',
      '銀行・投資など、身分証や有料の契約が要るサイトは対象外', '2012年当時の手順'],
    4: ['米国のプリペイド5社', '2019年', '145サイト中17', '「制限付き」', '日本の事業者の義務ではありません', '件数は書かれていません', '令和9年4月'],
    5: ['議論されていることに触れ', 'リセット手順の見直しを勧めました', '企業の社内ヘルプデスク', '秘密の質問は入っていません',
      'ソーシャルエンジニアリング（人をだまして情報や操作を引き出す手口）'],
    6: ['自主規制のガイドライン', '監督指針', 'どちらも法令ではありません', '原則2026年6月末', '代替の多要素認証も認めています', '依存します',
      '暗号が破られたわけではありません'],
    7: ['2020年に20人を面接した研究', '30日', '2カ月', '2023年1月', '185人', '27人', 'ほとんどがメインのスマホ'],
    8: ['64ビット以上の乱数', '要件ではありません', '偽サイトに強くありません', 'AAL2', '閉め出しがなくなるとは限りません',
      '保存型の回復コードは、NISTの言うlook-up secret（「持っているもの」）の典型的な使い方で',
      '回復コード1つと単一要素の認証の組、身元確認のやり直し（身元確認済みのアカウントの場合）のどれか'],
    9: ['論文の定義18は、閉め出しを最小不動点として定めています', '次の2つは、この教材で導いて確かめたことです', '（表9）',
      '復旧が輪になったときに閉め出しを見落とすことがあります'],
  };
  for (const [n, phrases] of Object.entries(JA)) {
    for (const phrase of phrases) assert.ok(lessonText(n, 'ja').includes(phrase), 'lesson ' + n + ': ' + phrase);
  }
  // Words not used: 社会工学 (the field of study, not the trick of deceiving people), a recovery code "typical of something you
  // have" (NIST says saved recovery codes are a typical use of look-up secrets), and the points site as the one announcing
  for (const [key, value] of Object.entries(M.ja)) assert.doesNotMatch(value, /社会工学|回復コードは「持っているもの」の典型/, key);
  assert.doesNotMatch(M.en.lesson2Text3, /points site in Japan announced/);
  assert.doesNotMatch(M.en.lesson8Text2, /A recovery code is a typical|asks for/);
  // Definition 18 "can miss" lockouts in a cycle: never told as if it missed every one
  assert.doesNotMatch(lessonText(9, 'ja'), /見落とします/);
  assert.doesNotMatch(lessonText(9, 'en'), /\bmisses lockouts/);
});

test('G: the lessons avoid the overstatements the spec lists, and real names stay in the bibliography', () => {
  const all = (lang) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => M[lang]['lesson' + n + 'Title'] + '\n' + lessonText(n, lang)).join('\n');
  const ja = all('ja'), en = all('en');
  // Klivan et al. are not the source for passkeys or SMS; the sentence that cites them speaks of email
  for (const sentence of ja.split('。').filter((s) => s.includes('Klivan'))) assert.doesNotMatch(sentence, /パスキー|SMS/);
  for (const sentence of en.split('. ').filter((s) => s.includes('Klivan'))) assert.doesNotMatch(sentence, /passkey|SMS/i);
  // No amounts of money, no "surging", NIST neither "bans" nor "forbids"; the 249 accounts "may have been" logged into
  assert.doesNotMatch(ja, /億円|万円|急増|禁止|禁じ|乗っ取られた249|249件が/);
  assert.doesNotMatch(en, /\byen\b|surg|\bban(ned|s)?\b|forbid|hijacked 249|249 (?:hijacked|taken over)/i);
  assert.doesNotMatch(en, /many users|\bmost (?:users|people|sites)\b/i);
  // CHI 2022 is cited by the number of people, not as a percentage; the passkey is never "safe"
  for (const sentence of ja.split('。').filter((s) => s.includes('CHI 2022'))) assert.doesNotMatch(sentence, /%/);
  assert.doesNotMatch(ja, /パスキーにすれば|パスキーなら|安全です|安全になる/);
  assert.doesNotMatch(en, /passkeys? (?:is|are) (?:safe|secure)|\bsafe\b/i);
  // The comparison of one change is not described as removing one line at a time, and the tool is not a copy of the paper's tool
  assert.doesNotMatch(ja, /1本ずつ外す|再実装|保管場所も地図の節点/);
  // Real services and companies: only in the bibliography entries (lessonRef…); the body names public bodies only
  assert.doesNotMatch(ja + en, /Google|Apple|Amazon|Chrome|Windows|Alexa|Wired|Honan|Unit 42|Palo Alto|ゆうID|日本郵政|日本郵便/);
  assert.match(M.en.lessonRefHonan2012, /Honan/);
  assert.match(M.ja.lessonRefJapanPost, /^日本郵政/);
});

test('G: the bibliography: Japanese sources in English on the English page, as the spec writes them', () => {
  const SOURCES = [
    ['JapanPost', '日本郵政「第三者による不正利用および会員情報漏えいの可能性について」2026-10-19',
      'Japan Post Holdings, "Unauthorized use by third parties and possible leak of member information" (in Japanese), 2026-10-19'],
    ['Jpcert', 'JPCERT/CC「STOP! パスワード使い回し!」', 'JPCERT/CC, "STOP! Password reuse!" (in Japanese)'],
    ['SoumuSite', '総務省「国民のためのサイバーセキュリティサイト」',
      'Ministry of Internal Affairs and Communications (MIC), "Cybersecurity Site for the Public" (in Japanese)'],
    ['SoumuMobile', '総務省「携帯電話の本人確認ルール」', 'MIC, "Identity verification rules for mobile phones" (in Japanese)'],
    ['NaraPolice', '奈良県警察本部サイバー犯罪対策課「サイバーニュース 令和5年度第4号」',
      'Nara Prefectural Police, Cybercrime Division, "Cyber News FY2023 No. 4" (in Japanese)'],
    ['Jsda2025', '日本証券業協会「インターネット取引における不正アクセス等防止に向けたガイドライン」（2025-10-15施行）',
      'Japan Securities Dealers Association (JSDA), "Guidelines for Prevention of Unauthorized Access, etc. in Internet Transactions" '
        + '(in Japanese), effective 2025-10-15'],
    ['FsaGuidelines', '金融庁「金融商品取引業者等向けの総合的な監督指針」（2025-10-15適用の改正）',
      'Financial Services Agency (FSA), "Comprehensive Guidelines for Supervision of Financial Instruments Business Operators, etc." '
        + '(in Japanese), amended 2025-10-15'],
    ['FsaDialogue', '金融庁「業界団体との意見交換会において金融庁が提起した主な論点」（2025-07-15開催、日本証券業協会）',
      'Financial Services Agency (FSA), "Main Topics Raised by the Financial Services Agency (FSA) at a Dialogue Meeting with the Industry '
        + 'Association" (in Japanese), held 2025-07-15 with the Japan Securities Dealers Association (JSDA)'],
  ];
  for (const [ref, ja, en] of SOURCES) assert.deepEqual([M.ja['lessonRef' + ref], M.en['lessonRef' + ref]], [ja, en], ref);
  // A source written in English keeps its English bibliography on both pages; the Japanese ones are marked "(in Japanese)" in English
  for (const ref of Object.keys(V.lessonRefs)) {
    const [ja, en] = [M.ja['lessonRef' + ref], M.en['lessonRef' + ref]];
    if (SOURCES.some(([r]) => r === ref)) assert.match(en, /\(in Japanese\)/, ref);
    else assert.equal(ja, en, ref);
    assert.doesNotMatch(en, JAPANESE, ref);
  }
  // The study of 2023 is cited with its DOI and title; the year of the survey is January 2023
  assert.match(M.en.lessonRefButtner2024, /ICISSP 2024/);
  assert.match(M.ja.lesson7Text3, /^2023年1月に/);
});

test('G: lesson 7 cites the study of 2023 in the words of the spec, and lesson 6 names the cards needed as the detail box does', () => {
  // The sentences of the spec for lesson 7 (in Japanese in the polite form of the lessons, in two sentences) and the English
  // sentence given for it, word for word; the authors are named in the bibliography only. The 27 is the paper's sum of the two providers (10 and
  // 17), shown as a sum: the sentence does not say that no one answered for both
  assert.equal(M.ja.lesson7Text3, '2023年1月に、大手2社のどちらか一方のアカウントについて、米国とドイツの居住者ほぼ半数ずつの185人に設定を尋ねた研究があります。27人（一方の提供者で10人、もう一方で17人の合計）が、1つを失うだけで入れなくなるおそれのある設定で、'
    + '失うものはほとんどがメインのスマホでした。');
  assert.equal(M.en.lesson7Text3, 'A study that asked 185 users of either of two major providers\' accounts (about half living in the US, half in '
    + 'Germany) about their settings in January 2023 found that 27 of them (10 for one provider plus 17 for the other) could be locked out by '
    + 'losing a single thing, nearly always their main phone.');
  for (const lang of ['ja', 'en']) assert.doesNotMatch(lessonText(7, lang), /Büttner|Gruschka/, lang);
  assert.match(M.en.lessonRefButtner2024, /^Büttner, Gruschka, /);
  // The cards needed to make an account fall: lesson 6 uses the words of the detail box (倒すのに要るカード)
  const needed = M.ja.needOne.split('：')[0];
  assert.equal(needed, '倒すのに要るカード');
  assert.ok(M.ja.lesson6Caption.includes(needed) && M.ja.lesson6Text3.includes(needed));
  for (const [key, value] of Object.entries(M.ja)) assert.doesNotMatch(value, /倒れるのに要る/, key);
});

test('G: lesson 10: each related tool says what it teaches in its own words, and the two paper tools name their method', () => {
  for (const lang of ['ja', 'en']) {
    const learn = Object.keys(M[lang]).filter((k) => /^lesson10Day\d{3}$/.test(k)).map((k) => M[lang][k]);
    assert.equal(learn.length, 8, lang);
    assert.equal(new Set(learn).size, learn.length, lang);
  }
  assert.deepEqual([M.ja.lesson10Day124, M.ja.lesson10Day125], ['紙の保管（秘密分散）', '紙の保管（視覚暗号）']);
  assert.deepEqual([M.en.lesson10Day124, M.en.lesson10Day125],
    ['Keeping paper codes (secret sharing)', 'Keeping paper codes (visual cryptography)']);
});

test('G: what the lessons say about the model agrees with the vectors', () => {
  const worker = vectors.personas.worker, student = vectors.personas.student;
  // Lesson 1: the social media falls through its recovery entrance one step after the main email, and the SIM swap leaves the bank standing
  assert.equal(worker.cards.leak.rank.sns, worker.cards.leak.rank.mailMain + 1);
  assert.equal(worker.cards.leak.via.sns, 'sns.recMail');
  assert.ok(!worker.cards.simswap.services.includes('bank') && worker.cards.simswap.naiveServices.includes('bank'));
  // Lesson 3: after moving the subscription's log-in to the free email, it is a backdoor for the SIM swap and the email takeover only
  for (const [card, backdoor] of [['leak', false], ['simswap', true], ['mail', true]]) {
    assert.equal(V.afterMap(persona('student'), 'replace:sub.login:mailUni>mailFree', card).backdoor.includes('sub'), backdoor, card);
  }
  // Lesson 5: the student's map has no phone help desk, so nothing falls to the help-desk card
  assert.deepEqual(student.cards.desk.services, []);
  assert.ok(!persona('student').services.some((s) => s.methods.some((m) => m.requires.includes('info'))));
  // Lesson 6: the fictional brokerage logs in with the phone (passkey) only, and keeps a recovery entrance
  for (const id of PEOPLE) {
    const sec = persona(id).services.find((s) => s.id === 'sec');
    assert.deepEqual(sec.methods.filter((m) => m.role === 'login').map((m) => m.requires), [['device']], id);
    assert.ok(sec.methods.some((m) => m.role === 'recovery'), id);
  }
  // Lesson 8: some removals add a lockout for a single loss. A change to paper codes does not necessarily rule out lockout:
  // the pair of losses that locks the owner out may move (a pair unlocked, a pair with the paper newly locked), or a new pair
  // with the paper may appear (no pair unlocked)
  const moves = PEOPLE.flatMap((id) => vectors.personas[id].moves);
  assert.ok(moves.some((m) => m.kind === 'remove' && Object.values(m.losses).some((l) => l.newlyLocked.length)));
  const pairs = (m, key) => Object.entries(m.pairLosses).filter(([, x]) => x[key].length).map(([pair]) => pair);
  const toPaper = moves.filter((m) => m.to && m.to.startsWith('paper:'));
  const paperPair = (m) => pairs(m, 'newlyLocked').some((pair) => pair.includes('paper'));
  assert.ok(toPaper.some((m) => paperPair(m) && pairs(m, 'unlocked').length), 'a change to paper codes that moves the pair');
  assert.ok(toPaper.some((m) => paperPair(m) && !pairs(m, 'unlocked').length), 'a change to paper codes that adds a pair');
});

// ===== タブ2・タブ4・ヘルプ・印刷 =====
test('G: the lessons point to their own tables by the numbers of the captions (表1-1, 表1-2, 表2 … 表10), and every table of lessons '
  + '1 to 9 is pointed to', () => {
  const numbers = V.lessonTableNumbers();
  assert.deepEqual(numbers, { flow: '1-1', andOr: '1-2', families: '2', backdoors: '3', simswap: '4', desk: '5', brokerage: '6', lockout: '7',
    removeReplace: '8', cycle: '9', tools: '10' });
  for (const lesson of V.lessons) {
    const own = lesson.blocks.filter(([kind]) => kind === 'table').map(([, kind]) => numbers[kind]);
    for (const lang of ['ja', 'en']) {
      const T = M[lang], text = lesson.blocks.filter(([kind]) => kind !== 'table').map(([, key]) => T[key]).join('\n');
      // (Table 5 of NIST's Appendix B in lesson 6 is a table of the source, written as Table 5 in Japanese too)
      const refs = [...text.matchAll(lang === 'ja' ? /表(\d+(?:-\d+)?)/g : /(?<!Appendix B, )\bTable (\d+(?:-\d+)?)/g)].map((m) => m[1]);
      assert.ok(refs.every((no) => own.includes(no)), lesson.n + ' ' + lang + ': ' + refs);
      if (lesson.n < 10) assert.deepEqual([...new Set(refs)].sort(), [...own].sort(), lesson.n + ' ' + lang);
    }
  }
  // The number heads the caption in the words of the screen (表{no} / Table {no})
  assert.deepEqual([V.fill(M.ja.lessonTableNo, { no: '1-1' }), V.fill(M.en.lessonTableNo, { no: '1-1' })], ['表1-1', 'Table 1-1']);
  // No lesson says 1つ目の表 or 下の表 any more: a table is named by its number
  for (const [key, value] of Object.entries(M.ja)) if (/^lesson\d+Text\d+$/.test(key)) assert.doesNotMatch(value, /つ目の表|下の表|表は、/, key);
});

test('G: a rule or a note named in the lessons says that it is in the Rules tab, and the four notes there carry those numbers', () => {
  for (const [key, value] of Object.entries(M.ja)) {
    if (!/^lesson\d+Text\d+$/.test(key)) continue;
    for (const m of value.matchAll(/(規則|注記)(\d+)/g)) {
      assert.ok(value.slice(0, m.index).endsWith('規則表のタブの'), key + ': ' + m[0]);
      assert.ok(Number(m[2]) <= (m[1] === '規則' ? 10 : 4), key + ': ' + m[0]);
    }
  }
  for (const [key, value] of Object.entries(M.en)) {
    if (!/^lesson\d+Text\d+$/.test(key)) continue;
    for (const m of value.matchAll(/\b(rule|note) (\d+)\b/gi)) {
      assert.ok(value.slice(m.index + m[0].length).startsWith(' in the Rules tab'), key + ': ' + m[0]);
    }
  }
  assert.deepEqual([1, 2, 3, 4].map((n) => M.ja['ruleNote' + n].slice(0, 3)), ['注記1', '注記2', '注記3', '注記4']);
  assert.deepEqual([1, 2, 3, 4].map((n) => M.en['ruleNote' + n].slice(0, 6)), ['Note 1', 'Note 2', 'Note 3', 'Note 4']);
  // Note 3 is the one on the phone help desk and documents, as lesson 5 says
  assert.match(M.ja.ruleNote3, /電話の窓口/);
  assert.ok(M.ja.noteDesk.includes('書類での本人確認'));
});

test('G: the line above the lockout table says what each person\'s table shows, as the vectors say', () => {
  const cells = (id) => {
    const t = pv(id).lossTable;
    return t.columns.flatMap((loss) => Object.entries(t.cells[loss]).map(([account, c]) => ({ loss, account, mark: c.mark,
      plus: c.plus.join('+') })));
  };
  const locked = (id) => cells(id).filter((c) => c.mark === 'locked').map((c) => c.loss + ':' + c.account);
  const plus = (id) => cells(id).filter((c) => c.plus).map((c) => c.loss + ':' + c.account + ':' + c.plus);
  // The office worker: no ×, and the online bank and brokerage need the phone and the number to be lost together (△)
  assert.deepEqual(locked('worker'), []);
  assert.deepEqual(plus('worker').sort(), ['device:bank:number', 'device:sec:number', 'number:bank:device', 'number:sec:device']);
  // The parent: × for the bank when the number is given up, and both entrances of the bank use SMS
  assert.deepEqual(locked('parent'), ['number:bank']);
  assert.deepEqual(persona('parent').services.find((s) => s.id === 'bank').methods.map((m) => m.requires.includes('phone')), [true, true]);
  // The student: × for the subscription when the university email is gone, and its only log-in is that email
  assert.deepEqual(locked('student'), ['mail:sub']);
  assert.deepEqual(persona('student').services.find((s) => s.id === 'sub').methods.map((m) => m.requires), [['mailUni']]);
  // The sentences name those accounts as the table does, and say × and △ as the cells show them
  const name = (id, account, lang) => V.names(persona(id), M, lang).full[account];
  assert.ok(M.ja.lockStoryWorker.includes(name('worker', 'bank', 'ja')) && M.ja.lockStoryWorker.includes(name('worker', 'sec', 'ja')));
  assert.ok(M.ja.lockStoryParent.includes(name('parent', 'bank', 'ja')) && M.ja.lockStoryStudent.includes(name('student', 'sub', 'ja')));
  for (const lang of ['ja', 'en']) {
    const T = M[lang];
    assert.ok(T.lockStoryWorker.includes('（' + T.cellPlusMark + '）') || T.lockStoryWorker.includes('(' + T.cellPlusMark + ')'), lang);
    for (const key of ['lockStoryParent', 'lockStoryStudent']) assert.ok(T[key].includes(T.cellLocked), lang + ' ' + key);
    // The legend of the marks starts with the marks of the cells
    assert.deepEqual(['lockMarkOk', 'lockMarkLocked', 'lockMarkPlus', 'lockMarkGone'].map((key) => T[key].split(lang === 'ja' ? '＝' : ' = ')[0]),
      [T.cellOk, T.cellLocked, T.cellPlusMark, T.cellGone], lang);
  }
  // Under △ the screen writes the loss that would make it × (the words inside the brackets of the printed cell)
  const cell = V.lockTable(persona('parent'), pv('parent').lossTable, M, 'ja').rows.find((r) => r.id === 'sec').cells[0];
  assert.deepEqual([cell.text, cell.cond], ['△（番号かプロバイダーのメールも失うと×）', '番号かプロバイダーのメールも失うと×']);
  const en = V.lockTable(persona('worker'), move('worker', 'replace:sns.recMail:mailMain>paper:sns').lossTable, M, 'en').rows
    .find((r) => r.id === 'sns').cells.find((c) => c.loss === 'number');
  assert.deepEqual([en.text, en.cond], ['△ (× if the paper codes go too)', '× if the paper codes go too']);
});
