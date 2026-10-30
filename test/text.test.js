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
  ['worker', 'device', 'bank', '○（＋番号で×）', '○ (× if the number goes too)'],
  ['worker', 'device', 'sec', '○（＋番号で×）', '○ (× if the number goes too)'],
  ['worker', 'number', 'bank', '○（＋スマホで×）', '○ (× if the phone goes too)'],
  ['worker', 'number', 'sec', '○（＋スマホで×）', '○ (× if the phone goes too)'],
  ['parent', 'device', 'bank', '○（＋番号で×）', '○ (× if the number goes too)'],
  ['parent', 'device', 'msg', '○（＋番号で×）', '○ (× if the number goes too)'],
  ['parent', 'device', 'sec', '○（＋番号か＋プロバイダーのメールで×）', '○ (× if the number or the ISP email goes too)'],
  ['parent', 'number', 'msg', '○（＋スマホで×）', '○ (× if the phone goes too)'],
  ['parent', 'number', 'sec', '○（＋スマホで×）', '○ (× if the phone goes too)'],
  ['parent', 'mail', 'bank', '○（＋番号で×）', '○ (× if the number goes too)'],
  ['parent', 'mail', 'sec', '○（＋スマホで×）', '○ (× if the phone goes too)'],
  ['student', 'device', 'sub', '○（＋大学のメールで×）', '○ (× if the university email goes too)'],
  ['student', 'number', 'sub', '○（＋大学のメールで×）', '○ (× if the university email goes too)'],
];
// The known two-at-once lines of the changes: person, change, Japanese, English.
const PAIR_LINES = [
  ['worker', 'replace:sns.recMail:mailMain>mailOld',
    'SNS：番号と古いメールを一緒になくすと入れなくなる',
    'Social media: losing the number and the old email together now locks you out'],
  ['worker', 'replace:sns.recMail:mailMain>paper:sns',
    'SNS：番号と紙を一緒になくすと入れなくなる',
    'Social media: losing the number and the paper codes together now locks you out'],
  ['worker', 'replace:flea.recMail:mailMain>mailOld',
    'フリマアプリ（売上金）：番号と古いメールを一緒になくすと入れなくなる',
    'Flea-market app (sales balance): losing the number and the old email together now locks you out'],
  ['worker', 'replace:cloud.recMail:mailMain>mailOld',
    '写真のクラウド：スマホと古いメールを一緒になくすと入れなくなる',
    'Photo cloud: losing the phone and the old email together now locks you out'],
  ['worker', 'replace:cloud.recMail:mailMain>paper:cloud',
    '写真のクラウド：スマホと紙を一緒になくすと入れなくなる',
    'Photo cloud: losing the phone and the paper codes together now locks you out'],
  ['worker', 'replace:bank.recSmsDesk:phone>paper:bank',
    'ネット銀行：入れなくなる2つの組み合わせが「スマホと番号」から「スマホと紙」に移る',
    'Online bank: the pair of losses that locks you out moves from the phone and the number to the phone and the paper codes'],
  ['worker', 'replace:bank.recSmsDesk:phone>idcheck',
    'ネット銀行：スマホと番号を一緒になくしても入れるようになる',
    'Online bank: you can now get in even after losing the phone and the number together'],
  ['worker', 'replace:bank.recSmsDesk:info>paper:bank',
    'ネット銀行：スマホと紙を一緒になくすと入れなくなる',
    'Online bank: losing the phone and the paper codes together now locks you out'],
  ['worker', 'replace:sec.recMailSms:mailMain>mailOld',
    'ネット証券：スマホと古いメールを一緒になくすと入れなくなる',
    'Online brokerage: losing the phone and the old email together now locks you out'],
  ['worker', 'replace:sec.recMailSms:mailMain>paper:sec',
    'ネット証券：スマホと紙を一緒になくすと入れなくなる',
    'Online brokerage: losing the phone and the paper codes together now locks you out'],
  ['worker', 'replace:sec.recMailSms:phone>paper:sec',
    'ネット証券：入れなくなる2つの組み合わせが「スマホと番号」から「スマホと紙」に移る',
    'Online brokerage: the pair of losses that locks you out moves from the phone and the number to the phone and the paper codes'],
  ['worker', 'replace:sec.recMailSms:phone>idcheck',
    'ネット証券：スマホと番号を一緒になくしても入れるようになる',
    'Online brokerage: you can now get in even after losing the phone and the number together'],
  ['parent', 'add:shop.login:+device',
    '通販：スマホとプロバイダーのメールを一緒になくすと入れなくなる',
    'Online shop: losing the phone and the ISP email together now locks you out'],
  ['parent', 'add:photo.login:+device',
    '写真のクラウド：スマホとプロバイダーのメールを一緒になくすと入れなくなる',
    'Photo cloud: losing the phone and the ISP email together now locks you out'],
  ['parent', 'replace:sec.recMailSms:mailIsp>paper:sec',
    'ネット証券（NISA）：入れなくなる2つの組み合わせが「スマホとプロバイダーのメール」から「スマホと紙」に移る',
    'Online brokerage (NISA): the pair of losses that locks you out moves from the phone and the ISP email to the phone and the paper codes'],
  ['parent', 'replace:sec.recMailSms:phone>paper:sec',
    'ネット証券（NISA）：入れなくなる2つの組み合わせが「スマホと番号」から「スマホと紙」に移る',
    'Online brokerage (NISA): the pair of losses that locks you out moves from the phone and the number to the phone and the paper codes'],
  ['parent', 'replace:sec.recMailSms:phone>idcheck',
    'ネット証券（NISA）：スマホと番号を一緒になくしても入れるようになる',
    'Online brokerage (NISA): you can now get in even after losing the phone and the number together'],
  ['student', 'add:sns.login:+device',
    'SNS：スマホと大学のメールを一緒になくすと入れなくなる',
    'Social media: losing the phone and the university email together now locks you out'],
  ['student', 'replace:flea.recMail:mailFree>mailUni',
    'フリマアプリ：番号と大学のメールを一緒になくすと入れなくなる',
    'Flea-market app: losing the number and the university email together now locks you out'],
  ['student', 'replace:sec.recMail:mailFree>mailUni',
    'ネット証券（つみたて）：スマホと大学のメールを一緒になくすと入れなくなる',
    'Online brokerage (monthly investing): losing the phone and the university email together now locks you out'],
  ['student', 'replace:sec.recMail:mailFree>paper:sec',
    'ネット証券（つみたて）：スマホと紙を一緒になくすと入れなくなる',
    'Online brokerage (monthly investing): losing the phone and the paper codes together now locks you out'],
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
    ['worker', 'replace:sns.recMail:mailMain>paper:sns', 'number', 'sns', '○（＋紙で×）', '○ (× if the paper codes go too)'],
    ['worker', 'replace:bank.recSmsDesk:info>paper:bank', 'device', 'bank', '○（＋番号か＋紙で×）', '○ (× if the number or the paper codes go too)'],
    ['parent', 'replace:sec.recMailSms:phone>paper:sec', 'device', 'sec', '○（＋プロバイダーのメールか＋紙で×）',
      '○ (× if the ISP email or the paper codes go too)'],
  ];
  for (const [id, moveId, loss, account, ja, en] of known) {
    assert.equal(cell(id, moveId, loss, account, 'ja').text, ja, moveId);
    assert.equal(cell(id, moveId, loss, account, 'en').text, en, moveId);
  }
  // Read aloud without the plus sign: "can get in; losing the number or the paper codes too would lock you out".
  assert.equal(cell('worker', 'replace:bank.recSmsDesk:info>paper:bank', 'device', 'bank', 'ja').sr, '入れる。番号か紙も失うと入れない');
  assert.equal(cell('worker', 'replace:bank.recSmsDesk:info>paper:bank', 'device', 'bank', 'en').sr,
    'Can get in; losing the number or the paper codes too would lock you out');
});

test('G: known sentences of changes (titles, single losses, one to two at once, summaries)', () => {
  const s = (id, moveId, lang) => V.sentences(persona(id), pv(id), moveId, M, lang);
  const titles = [
    ['worker', 'replace:mailMain.recMail:mailOld>paper:mailMain', 'メインのメール：復旧（予備のメールで再設定）の古いメールを紙の回復コードに付け替える',
      'Main email: in recovery (Reset via backup email), replace the old email with paper recovery codes'],
    ['worker', 'remove:sec.recMailSms', 'ネット証券：復旧（メール＋SMSでパスキーを再登録）を外す',
      'Online brokerage: remove recovery (Re-register passkey by email + SMS)'],
    ['parent', 'replace:bank.recSms:phone>idcheck', '銀行のネットバンキング：復旧（SMSで再設定）の電話番号（SMS）を書類での本人確認に付け替える',
      'Online banking: in recovery (Reset by SMS), replace the phone number (SMS) with a document check'],
    ['worker', 'replace:points.login:pw:red>pw:own-points', 'ポイントアプリ：ログイン（パスワード）のパスワード 赤Aをこのアカウントだけの系統に付け替える',
      'Points app: in log-in (Password), replace Password Red A with a family used only here'],
  ];
  for (const [id, moveId, ja, en] of titles) {
    assert.equal(s(id, moveId, 'ja').title, ja);
    assert.equal(s(id, moveId, 'en').title, en);
  }
  assert.deepEqual(s('worker', 'remove:sec.recMailSms', 'ja').lossOne, ['スマホをなくすと、ネット証券に入れなくなる']);
  assert.deepEqual(s('worker', 'remove:sec.recMailSms', 'en').lossOne, ['If you lose the phone, you can no longer get into: Online brokerage']);
  assert.deepEqual(s('parent', 'replace:bank.recSms:phone>idcheck', 'ja').lossOne, ['番号を手放しても、銀行のネットバンキングに入れるようになる']);
  assert.deepEqual(s('parent', 'replace:bank.recSms:phone>idcheck', 'en').lossOne,
    ['Even after giving up the number, you can now get into: Online banking']);
  // One to two at once (the parent's bank): instead of "can now get in", and also among the two-at-once lines.
  const oneToPair = ['銀行のネットバンキング：番号を手放しても入れるようになる。ただしスマホと番号を一緒になくすと入れない',
    'Online banking: giving up the number no longer locks you out, but losing the phone and the number together still does'];
  assert.deepEqual(s('parent', 'replace:bank.login:phone>device', 'ja').lossOne, [oneToPair[0]]);
  assert.deepEqual(s('parent', 'replace:bank.login:phone>device', 'en').lossOne, [oneToPair[1]]);
  assert.deepEqual(s('parent', 'replace:bank.login:phone>device', 'ja').lossTwo, [oneToPair[0]]);
  const oneToPairMoves = PEOPLE.flatMap((id) => pv(id).moves.filter((mv) => V.lossLines(persona(id), mv, M, 'ja').oneToPair.length)
    .map((mv) => id + ' ' + mv.id));
  assert.deepEqual(oneToPairMoves, ['parent replace:bank.login:phone>device']);
  // Summaries: W3, W2 (four or more accounts) and the student's change that only makes an account fall.
  assert.deepEqual(s('worker', 'remove:sec.recMailSms', 'ja').summary, ['攻撃：SIMスワップでネット証券を守れる', '閉め出し：スマホをなくすと、ネット証券に入れなくなる']);
  assert.deepEqual(s('worker', 'remove:sec.recMailSms', 'en').summary,
    ['Attack (saved from SIM swap): Online brokerage', 'Lockout: If you lose the phone, you can no longer get into: Online brokerage']);
  assert.deepEqual(s('worker', 'replace:mailMain.recMail:mailOld>paper:mailMain', 'ja').summary,
    ['攻撃：メールの乗っ取りと窓口のなりすましでメインのメールなど6つを守れる', '閉め出し：変わらない']);
  assert.deepEqual(s('worker', 'replace:mailMain.recMail:mailOld>paper:mailMain', 'en').summary,
    ['Attack (saved from Email takeover and Help-desk impersonation): Main email and others (6 in all)', 'Lockout: no change']);
  assert.deepEqual(s('student', 'replace:sub.login:mailUni>mailFree', 'ja').summary,
    ['攻撃：漏えいとSIMスワップで動画のサブスクが新たに倒れる', '閉め出し：大学のメールが消えても、動画のサブスク（学割）に入れるようになる']);
  assert.deepEqual(s('student', 'replace:sub.login:mailUni>mailFree', 'en').summary, ['Attack (newly falls to Breach and SIM swap): Video subscription',
    'Lockout: Even after the university email is gone, you can now get into: Video subscription (student plan)']);
  // A change with a two-at-once difference gets the third summary line.
  assert.deepEqual(s('worker', 'replace:sec.recMailSms:phone>paper:sec', 'ja').summary.slice(1),
    ['閉め出し：変わらない', '2つ同時：ネット証券：入れなくなる2つの組み合わせが「スマホと番号」から「スマホと紙」に移る']);
});

test('G: the forms with two or more groups (built values passed to the sentence parts)', () => {
  const p = persona('worker');
  const empty = () => ({ newlyLocked: [], unlocked: [] });
  const pairsWith = (entries) => Object.fromEntries(C.lossPairs(p).map((pr) => C.pairKey(pr))
    .map((k) => [k, { ...empty(), ...(entries[k] || {}) }]));
  const twoNew = { pairLosses: pairsWith({ 'device+number': { newlyLocked: ['sec'] }, 'device+mail': { newlyLocked: ['sec'] } }) };
  assert.deepEqual(V.pairLines(p, twoNew, M, 'ja'), ['ネット証券：スマホと番号、スマホと古いメールを一緒になくすと入れなくなる']);
  assert.deepEqual(V.pairLines(p, twoNew, M, 'en'),
    ['Online brokerage: losing the phone and the number, or the phone and the old email together now locks you out']);
  const twoUnlocked = { pairLosses: pairsWith({ 'device+number': { unlocked: ['bank'] }, 'number+mail': { unlocked: ['bank'] } }) };
  assert.deepEqual(V.pairLines(p, twoUnlocked, M, 'ja'), ['ネット銀行：スマホと番号、番号と古いメールを一緒になくしても入れるようになる']);
  assert.deepEqual(V.pairLines(p, twoUnlocked, M, 'en'),
    ['Online bank: you can now get in even after losing the phone and the number, or the number and the old email together']);
  const moved = { pairLosses: pairsWith({ 'device+number': { unlocked: ['sec'] }, 'number+mail': { unlocked: ['sec'] },
    'device+paper': { newlyLocked: ['sec'] } }) };
  assert.deepEqual(V.pairLines(p, moved, M, 'ja'), ['ネット証券：入れなくなる2つの組み合わせが「スマホと番号・番号と古いメール」から「スマホと紙」に移る']);
  assert.deepEqual(V.pairLines(p, moved, M, 'en'), ['Online brokerage: the pair of losses that locks you out moves from '
    + 'the phone and the number, the number and the old email to the phone and the paper codes']);
  // One to two at once with two groups.
  const losses = Object.fromEntries(p.losses.map((l) => [l.id, empty()]));
  losses.number = { newlyLocked: [], unlocked: ['bank'] };
  const lossTable = { columns: ['device', 'number', 'mail'], pairOnly: { ...Object.fromEntries(C.lossPairs(p).map((pr) => [C.pairKey(pr), []])),
    'device+number': ['bank'], 'number+mail': ['bank'] } };
  assert.deepEqual(V.lossLines(p, { losses, lossTable }, M, 'ja').one,
    ['ネット銀行：番号を手放しても入れるようになる。ただしスマホと番号、番号と古いメールを一緒になくすと入れない']);
  assert.deepEqual(V.lossLines(p, { losses, lossTable }, M, 'en').one,
    ['Online bank: giving up the number no longer locks you out, but losing the phone and the number, or the number and the old email together still does']);
  // The attack line: a breach saves A, a SIM swap saves B, and a help-desk impersonation makes C newly fall.
  const card = (saved, exposed) => ({ saved, exposed });
  const attack = { cards: { leak: card(['points'], []), simswap: card(['flea'], []), mail: card([], []), desk: card([], ['bank']) } };
  assert.equal(V.attackLine(p, attack, M, 'ja'), '攻撃：漏えいでポイントアプリを守れる。SIMスワップでフリマアプリを守れる。窓口のなりすましでネット銀行が新たに倒れる');
  assert.equal(V.attackLine(p, attack, M, 'en'),
    'Attack (saved from Breach): Points app. Saved from SIM swap: Flea-market app. Newly falls to Help-desk impersonation: Online bank');
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
    ['worker', 'replace:shop.recMail:mailMain>paper:shop', 'simswap', 'savedNames', '通販（カード登録あり）', 'Online shop (card saved)',
      '攻撃：SIMスワップとメールの乗っ取りと窓口のなりすましで通販を守れる',
      'Attack (saved from SIM swap and Email takeover and Help-desk impersonation): Online shop'],
    ['worker', 'remove:flea.recMail', 'leak', 'savedNames', 'フリマアプリ（売上金）', 'Flea-market app (sales balance)',
      '攻撃：漏えいとメールの乗っ取りと窓口のなりすましでフリマアプリを守れる',
      'Attack (saved from Breach and Email takeover and Help-desk impersonation): Flea-market app'],
    ['student', 'replace:sub.login:mailUni>mailFree', 'simswap', 'newlyNames', '動画のサブスク（学割）', 'Video subscription (student plan)',
      '攻撃：漏えいとSIMスワップで動画のサブスクが新たに倒れる', 'Attack (newly falls to Breach and SIM swap): Video subscription'],
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
  assert.ok(w2('en').attack.find((r) => r.card === 'mail').savedNames.includes('Online shop (card saved)'));
});

test('G: the step line under the step buttons: what the card gives at step 0, then the accounts that fall at each step', () => {
  // Built from the known vectors (gives, rank) and the data labels: a credential by its label (personal details by the
  // short tag), an account by its short name; the sentence types are those of the screen text.
  const forms = {
    ja: { zero: (g) => '段0：カードが渡したもの（' + g + '）', step: (r, m, a) => '段' + r + '（最後は段' + m + '）：' + a, sep: '・',
      info: '個人情報' },
    en: { zero: (g) => 'Step 0 (given by the card): ' + g, step: (r, m, a) => 'Step ' + r + ' (last: ' + m + '): ' + a, sep: ', ',
      info: 'Personal details' },
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
          if (!credential) return short(p.services.find((s) => s.id === node), lang);
          return credential.type === 'info' ? f.info : credential.label[lang];
        }).join(f.sep);
        for (let step = 0; step <= last; step++) {
          const accounts = p.services.filter((s) => known.rank[s.id] === step).map((s) => short(s, lang)).join(f.sep);
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

// The ranking notes of the screen text of the spec, word for word: rankingCards (the four cards and their sum) and
// rankingLockout (fewer lockouts), Japanese then English
const RANKING = {
  cards: ['閉め出しを1つでも増やす手は後ろに並べます。そのうえで、差し引きで守れる★（重要）の数（多い順）→差し引きで守れる数（多い順）→閉め出しの増減（少ない順）→'
    + '4枚のカードで新たに倒れる数（延べ、少ない順）の順です。差し引きは、守れた数から、同じカード（4枚の合計では4枚）で新たに倒れた数を引いた数です。'
    + 'ボタンの「守れる」は引く前の数で、新たに倒れる数があればボタンに別に出します。同点なら足す→付け替え→外すの順です。閉め出しは1つの喪失で数え、'
    + '2つ同時は並べ方に入れていません。',
  'Changes that add any lockout go last. The rest are ranked by ★ (important) accounts saved on balance (more first), then accounts saved '
    + 'on balance (more first), then the change in lockouts (smaller first), then accounts newly falling, summed over the four cards (fewer '
    + 'first). On balance means saved minus newly falling to the same card (all four for the total); the “Saves” on each button is before '
    + 'subtraction, and any newly falling accounts are shown separately. Ties go add → replace → remove. Lockouts are counted for single '
    + 'losses; two-at-once losses are not used for ranking.'],
  lockout: ['閉め出しの増減（減る手が先）→4枚のカードで新たに倒れる数（延べ、少ない順）→差し引きで守れる★の数（4枚の延べ、多い順）→差し引きで守れる数（4枚の延べ、'
    + '多い順）の順です。同点なら足す→付け替え→外すの順です。',
  'Ranked by the change in lockouts (largest decrease first), then accounts newly falling, summed over the four cards (fewer first), then ★ '
    + 'accounts saved on balance, then accounts saved on balance, both summed over the four cards (more first). Ties go add → replace → remove.'],
};

test('G: the ranking note follows the mode, and the one-account step summary is singular in English', () => {
  // The whole note of the spec in each mode (not only its first sentence)
  for (const mode of ['leak', 'simswap', 'mail', 'desk', 'all', 'lockout']) {
    const [ja, en] = RANKING[mode === 'lockout' ? 'lockout' : 'cards'];
    assert.equal(V.rankingNote(mode, M, 'ja'), ja, mode);
    assert.equal(V.rankingNote(mode, M, 'en'), en, mode);
  }
  assert.equal(V.stepSummary(persona('parent'), pv('parent').cards.simswap, M, 'en'), 'With this card alone, 1 of 7 accounts falls (★1).');
  assert.equal(V.stepSummary(persona('parent'), pv('parent').cards.simswap, M, 'ja'), 'このカード1枚で、1つのアカウントが倒れます（全7のうち、★1）。');
  assert.equal(V.stepSummary(persona('student'), pv('student').cards.desk, M, 'ja'), 'このカードでは、倒れるアカウントはありません。');
  assert.equal(V.stepSummary(persona('worker'), pv('worker').cards.leak, M, 'en'), 'With this card alone, 6 of 9 accounts fall (★1).');
  const counts = V.counts(persona('parent'));
  assert.equal(V.fill(M.en.personCounts, { n: counts.accounts, f: counts.families }),
    'Accounts: 7 · Password families: 1. These are fictional people; there are no fields for real account details.');
});

test('G: the chain tab texts (card line, step status, map cells, cards needed) for the known scenes', () => {
  const p = persona('worker');
  assert.equal(V.cardLine(p, 'leak', M, 'ja'), 'ポイントアプリの漏えい（そのパスワードの系統が漏れた）。渡すもの：パスワード 赤A（ポイントアプリがいまログインに使っている系統）');
  assert.equal(V.cardLine(p, 'leak', M, 'en'),
    'Points-app breach (its password family leaked). Gives: Password Red A (the family the breached service, Points app, uses to log in now)');
  const result = pv('worker').cards.leak;
  assert.equal(V.stepStatus(p, result, 'leak', 0, M, 'ja'), '段0：カードが渡したもの（パスワード 赤A）');
  assert.equal(V.stepStatus(p, result, 'leak', 1, M, 'ja'), '段1（最後は段2）：メインのメール・ポイントアプリ・通販');
  assert.equal(V.stepStatus(p, result, 'leak', 2, M, 'ja'),
    '段2（最後は段2）：SNS・フリマアプリ・写真のクラウド。このカード1枚で、6つのアカウントが倒れます（全9のうち、★1）。');
  assert.equal(V.mapCaption(p, 'leak', 2, M, 'ja'), '会社員 ハルトの地図（漏えい・段2）');
  assert.equal(V.mapCaption(p, 'leak', 0, M, 'en'), 'Map: Haruto, office worker (Breach, step 0)');
  // W1 at step 2: three accounts fell at step 1 by log-in and three at step 2 through "Reset via registered email" (backdoors).
  const rows = V.mapRows(p, result, 2, M, 'ja');
  const cell = (id) => rows.find((r) => r.id === id).cell;
  assert.equal(cell('mailMain').text, '●1（パスワード）');
  assert.equal(cell('sns').text, '●2（登録メールで再設定）');
  assert.equal(cell('sns').backdoor, true);
  assert.equal(cell('sns').thisStep, true);
  assert.equal(cell('bank').text, '－');
  assert.equal(cell('bank').sr, '倒れない');
  assert.equal(V.mapRows(p, result, 1, M, 'ja').find((r) => r.id === 'bank').cell.sr, 'まだ倒れていない');
  assert.deepEqual(rows.find((r) => r.id === 'sec').entrances, ['ログイン：スマホ', '復旧：メインのメール＋SMS']);
  assert.deepEqual(V.mapRows(p, result, 2, M, 'en').find((r) => r.id === 'sec').entrances, ['Log-in: Phone', 'Recovery: Main email + SMS']);
  // The mail card gives the old email directly (step 0).
  assert.equal(V.mapRows(p, pv('worker').cards.mail, 0, M, 'ja').find((r) => r.id === 'mailOld').cell.text, '●0（カードで直接）');
  const need = (id, account, lang) => V.needText(persona(id), pv(id), account, M, lang);
  assert.equal(need('worker', 'bank', 'ja'), '倒すのに要るカード：1枚では倒れない。SIMスワップと窓口のなりすましがそろうと倒れる');
  assert.equal(need('parent', 'sec', 'ja'),
    '倒すのに要るカード：1枚では倒れない。漏えいとSIMスワップ、SIMスワップとメールの乗っ取り、SIMスワップと窓口のなりすましのどれかがそろうと倒れる');
  assert.equal(need('worker', 'mailMain', 'ja'), '倒すのに要るカード：4枚のどれでも1枚で倒れる');
  assert.equal(need('worker', 'sec', 'ja'), '倒すのに要るカード：SIMスワップ1枚');
  assert.equal(need('worker', 'mailOld', 'en'), 'Cards needed: any one of Email takeover or Help-desk impersonation');
  // P1: the parent's bank falls only through the SMS reset at step 1, as a backdoor.
  const p1 = V.detail(persona('parent'), pv('parent'), 'simswap', 'bank', M, 'ja');
  assert.equal(p1.falls, 'このカードでは：段1で倒れる（開けた入口：SMSで再設定）');
  assert.equal(p1.backdoor, '裏口（復旧の入口がなければ、このカードでは倒れなかった）');
  assert.equal(p1.need, '倒すのに要るカード：SIMスワップ1枚');
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
          assert.doesNotMatch(line, /この口座だけの系統|Own family \(/, id + ' ' + mv.id);
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

// The notes after a change, from the spec (the help-desk note, the 2nd to 4th sentences of the paper note, the removal note,
// the note on a family of its own, the phone note of the lockout tab, and the note for a change that changes nothing)
const NOTES = {
  desk: ['電話の窓口は個人情報で通ります。この模型には、書類での本人確認を破るカードも、本人が書類をなくすカードもありません。'
    + 'このため、書類の確認へ付け替える手で、攻撃と閉め出しが悪くなることはありません。実際には書類は偽造で破られることがあり、'
    + '窓口での回復には待ち時間もかかります。実在の本人確認の手順は書きません。',
  'A phone help desk accepts personal details. This model has no card that defeats a document check and no card for the owner losing their '
    + 'documents, so moving a line to a document check never makes the attack or the lockout worse here. In reality documents can be forged, '
    + 'and recovery at a desk takes time. Real identity-check procedures are not described.'],
  paper: ['この模型には紙を攻撃者に渡すカードがないので、紙へ付け替える手で攻撃の面が悪くなることはありません。'
    + '実際には置き場所が新しい入口になり、打ち込む場面では偽サイトに強くありません。閉め出しの面では、紙をほかのものと一緒になくすと入れなくなることがあります。',
  'No card here hands the paper codes to the attacker, so moving a line to paper codes never makes the attack side worse. '
    + 'In reality, where you keep them becomes a new entrance, and they are not phishing-resistant when you type them in. '
    + 'On the lockout side, losing the paper codes together with something else can lock you out.'],
  remove: ['外す手の閉め出しは、喪失カード（スマホ・番号・メール）で数えています。パスワードを忘れることは模型に入れていないので、'
    + 'パスワードでログインするアカウントでは、外しても閉め出しが増えないように見えます。実際には、パスワードを忘れたときに戻る道がなくなります。',
  'Lockout for a removal is counted with the loss cards (phone, number, email). Forgetting a password is not in the model, '
    + 'so for accounts that log in with a password, removing a recovery entrance can look as if it adds no lockout. '
    + 'In reality, you lose your way back in if you forget the password.'],
  own: ['漏れたサービスのパスワードを独自にすると、漏えいのカードが渡すのはその新しい系統だけになり、ほかの使い回し先へ広がりません。',
    'If the breached service gets a family of its own, the breach card gives only that new family, '
      + 'and the leak no longer spreads to the accounts that reused the old one.'],
  sync: ['「スマホをなくした」の値は、認証アプリやパスキーを、ほかの端末やクラウドに移していない（同期・バックアップしていない）場合の値です。',
    'The “Lost the phone” values assume the authenticator app and passkeys are not synced or backed up to another device or the cloud.'],
  none: ['この手では、カード1枚ずつの攻撃も、閉め出しも変わりません。', 'This change affects neither any single card\'s attack nor the lockout.'],
};

test('G: the notes after a change, in their order (help desk, paper, removal, family of its own, phone, nothing changes)', () => {
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
  // key, Japanese, English (the table "タブ3 1手で比べる" of the screen text)
  const rows = [
    ['modeHeading', '何に備えるか', 'Prepare for'],
    ['modeLeak', '漏えい', 'Breach'], ['modeSimswap', 'SIMスワップ', 'SIM swap'], ['modeMail', 'メールの乗っ取り', 'Email takeover'],
    ['modeDesk', '窓口のなりすまし', 'Help-desk impersonation'], ['modeAll', '4枚の合計', 'All four cards'],
    ['modeLockout', '閉め出しを減らす', 'Fewer lockouts'],
    ['candidatesHeading', 'おすすめとほかの候補', 'Suggested change and alternatives'],
    ['noFall', 'このカードでは倒れるアカウントがないので、守る手はありません。', 'No account falls to this card, so there is nothing to protect.'],
    ['noLockout', '{person}は、1つ失っただけで入れなくなるアカウントがありません。2つ同時の閉め出しは、1手を選ぶと1行で出ます。',
      '{person}: no account is locked out by a single loss. Two-at-once lockouts appear as one line once you pick a change.'],
    ['noSafeMove', '閉め出しを増やさずに守れる1手は、この範囲にありません。', 'No single change here protects anything without adding a lockout.'],
    ['rankingSummary', '並べ方', 'How changes are ranked'],
    ['chooseLabel', '1手を自分で選ぶ', 'Choose a change yourself'], ['choosePlaceholder', '（1手を選ぶ）', '(choose a change)'],
    ['noMove', '上の候補か「1手を自分で選ぶ」から手を選ぶと、前後を並べます。',
      'Pick a change from the suggestions above or from “Choose a change yourself” to compare before and after.'],
    ['attackCaption', '攻撃（カード4枚）', 'Attack (four cards)'],
    ['attackColCard', 'カード', 'Card'], ['attackColBefore', '前', 'Before'], ['attackColAfter', '後', 'After'],
    ['attackColSaved', '守れた', 'Saved'], ['attackColNewly', '新たに倒れる', 'Newly fallen'],
    ['attackTotal', '合計（延べ）', 'Total'], ['attackMode', '選んだカード', 'selected card'],
    ['attackNames', '攻撃の名前を見る', 'See the account names'],
    ['lockOneHeading', '閉め出し（1つ失う）', 'Lockout (one loss)'], ['lockTwoHeading', '2つ同時に失う', 'Losing two at once'],
    ['beforeAfterTable', '閉め出しの表の前後を見る', 'See the lockout table before and after'],
    ['legendPaper', '紙＝紙の回復コードをなくした', 'Paper codes = Lost the paper recovery codes'],
    ['sameHeading', '同じ入口のほかの手と比べる', 'Compare other changes to the same entrance'],
    ['sameColMove', '手', 'Change'], ['sameColSaved', '守れた（延べ）', 'Saved (sum over 4 cards)'],
    ['sameColNewly', '新たに倒れる（延べ）', 'Newly fallen (sum over 4 cards)'], ['sameColLock', '閉め出し（1つ）', 'Lockout (one loss)'],
    ['sameColPair', '2つ同時', 'Two at once'],
    ['backToCompare', '比べた結果へ戻る', 'Back to the comparison'],
    ['afterMap', '手のあとの地図を見る', 'See the map after the change'],
    ['mapBefore', '手の前', 'Before'], ['mapAfter', '手のあと', 'After'],
    ['mapCard', '地図のカード：{card}（最後の段）', 'Card on the map: {card} (last step)'],
    ['changedTag', '変更', 'changed'], ['openTag', '開', 'open'], ['srLockMark', '閉め出し', 'locked out'],
  ];
  for (const [key, ja, en] of rows) assert.deepEqual([M.ja[key], M.en[key]], [ja, en], key);
});

test('G: the step hint, the step buttons and the entrances under the lockout table are the text of the spec', () => {
  // The hint at the last step (a card or person starts there), the English last-step button that is not read as "previous
  // step", and the line under the lockout table (decided by the owner, 2026-10-30)
  const rows = [
    ['stepFirst', '最初から', 'Start over'], ['stepNext', '次の段 ▶', 'Next step ▶'], ['stepLast', '最後まで', 'Skip to end'],
    ['stepHint', '「最初から」を押すと、段0から1段ずつ追えます。', 'Press “Start over” to follow the chain one step at a time from step 0.'],
    ['lockEntrances', '{account}の入口：{entrances}', '{account}: {entrances}'],
  ];
  for (const [key, ja, en] of rows) assert.deepEqual([M.ja[key], M.en[key]], [ja, en], key);
});

test('G: the numbers in the stories follow the data', () => {
  const uses = (id, family) => persona(id).services.filter((s) => s.methods.some((m) => m.requires.includes(family)));
  const worker = uses('worker', 'pw:red').length;
  assert.equal(Number(M.ja.storyWorker.match(/赤Aを(\d+)つ/)[1]), worker);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  assert.equal(words[M.en.storyWorker.match(/on (\w+) accounts/)[1]], worker);
  assert.equal(new Set(persona('parent').credentials.filter((c) => c.type === 'pw').map((c) => c.family)).size, 1);
  const shortNames = uses('student', 'pw:green').map((s) => V.names(persona('student'), M, 'ja').short[s.id]);
  assert.deepEqual(M.ja.storyStudent.match(/緑Aを(.+?)で使い回し/)[1].split('・'), shortNames);
});

// Tab 4 and the printed sheets, from the screen text table of the spec ("タブ4 規則表・ヘルプ・印刷"), the rules table
// ("規則表（10行）"), the symbols table ("記号の一覧") and the section on printing ("印刷"): key, Japanese, English
const RULES_TEXT = [
  ['rulesHeading', '規則表（単純化した模型）', 'Rules (a simplified model)'],
  ['rule1', 'アカウントには入口がある。ログインの入口と、復旧（再設定）の入口がある',
    'An account has entrances: log-in entrances and recovery (reset) entrances'],
  ['rule2', '1つの入口の条件は「かつ」。全部そろえば開く（例：パスワード＋SMSのコード）',
    'All requirements of one entrance must be met (AND), e.g. password + SMS code'],
  ['rule3', '入口どうしは「または」。どれか1つ開けば入れる', 'Any one entrance is enough (OR)'],
  ['rule4', '攻撃者はカードが渡すものから始め、開いたメールも次の条件に使う。新しく開くものがなくなるまで続ける。1回の見直しで開く分を1段と数える',
    'The attacker starts from what the card gives and uses every opened email for further entrances, until nothing new opens. '
    + 'Each round of newly opened accounts is one step'],
  ['rule5', 'パスワードは系統（色と英字）で表す。同じ系統なら、どのアカウントでも同じものとみなす（少し変えた派生を含む）。漏えいのカードは、'
    + '漏れたサービスがいまログインに使っている系統が、IDと組でそのまま（平文で）出回った場合を表す。そのときは、パスワードが長くても、'
    + '同じ系統を使う入口ではパスワードの条件がそろう',
  'Passwords are families (color + letter). The same family counts as the same secret everywhere, small variations included. '
    + 'A breach card stands for the case where the family that the breached service now uses to log in has leaked as-is (in plain text), '
    + 'together with the ID; then the password requirement is met on every entrance that uses that family, however long the password is'],
  ['rule6', 'SMSの条件は電話番号で満たす。攻撃者が持つのはSIMスワップのカードのときだけ',
    'An SMS requirement is met by the phone number; the attacker holds it only with the SIM-swap card'],
  ['rule7', '電話の窓口は個人情報で通る。書類での本人確認（身分証・郵送）を破るカードはない',
    'A phone help desk accepts personal details; no card defeats a document check (photo ID, postal mail)'],
  ['rule8', 'パスキーと認証アプリはスマホの中の鍵として扱う。紙の回復コードは本人の手元にだけある',
    'Passkeys and authenticator apps are treated as keys inside the phone; paper recovery codes exist only in the owner\'s hands'],
  ['rule9', '閉め出し＝本人が失ったもの（1つ、または2つ同時）を外し、手元に残ったものから同じ規則で入れないアカウント。'
    + '消えたメールそのものは「消」と表し、閉め出しには数えない。パスワードを忘れることは扱わない',
  'Lockout: after removing what the owner lost (one thing, or two at once), the accounts they cannot reach by the same rules from what remains. '
    + 'A vanished email itself is shown as gone and is not counted as locked out. Forgetting a password is not modeled'],
  ['rule10', '時間・確率・通知・不審なログインの検知は扱わない', 'Time, probability, notifications and detection of suspicious log-ins are not modeled'],
  ['rule2Example', '例：会社員のネット銀行の再設定はSMS＋個人情報です。SIMスワップのカード1枚では個人情報がないので倒れません。'
    + '線をすべて「または」として数えると、ここで倒れたことになってしまいます。',
  'Example: the office worker\'s online bank resets with SMS + personal details. The SIM-swap card alone lacks the personal details, '
    + 'so the bank does not fall. Counting every line as OR would wrongly make it fall here.'],
  ['symbolColSymbol', '記号', 'Symbol'], ['symbolColMeaning', '何を表すか', 'Meaning'], ['symbolColLine', '線の種類', 'Line type'],
  ['symbolColAttack', '攻撃者が手にするカード', 'Attack card that gives it'], ['symbolColLoss', '本人がなくすカード', 'Loss card that takes it'],
  ['notInModel', 'この模型に入れていないもの', 'Not in this model'],
  ['notInModel1', 'パスワードの強さ', 'Password strength'], ['notInModel2', '攻撃の確率・手間・時間', 'Attack probability, effort and time'],
  ['notInModel3', '不審なログインの検知と通知', 'Detection of suspicious log-ins and notifications'],
  ['notInModel4', '同期パスキーをクラウドの回復で取り出す経路', 'Retrieving synced passkeys through cloud recovery'],
  ['notInModel5', '端末の感染', 'Infected devices'], ['notInModel6', '書類の偽造', 'Forged documents'],
  ['notInModel7', 'パスワードを忘れること', 'Forgetting a password'], ['notInModel8', 'SSOとパスワード管理ソフト', 'Single sign-on and password managers'],
  ['notInModel9', '乗っ取ったあとに攻撃者が回復先を書き換えること', 'An attacker changing recovery details after a takeover'],
  ['notInModel10', '漏れたパスワードがハッシュで守られていて解けない場合', 'Leaks where the passwords are protected by hashing and cannot be cracked'],
  ['paperFormIntro', '自分の構成は、この画面には入れません。印刷した空欄の用紙に、パスワードを書かずに記号で書きます。用紙には「保管注意（弱点の地図）」の欄があります。',
    'Your own setup is never entered on this page. Print the blank sheet and fill it in with symbols, without passwords. '
    + 'The sheet has a “Keep safe (map of weak points)” box.'],
  ['printButton', '印刷する（3人の地図と空欄の用紙）', 'Print (three maps and a blank sheet)'],
  ['printTitle', '{person}の地図（架空の人物）', 'Map: {person} (fictional)'],
  ['printDisclaimer', 'この地図は、架空の人物を単純化した規則で数えた結果です。実際のサービスは、不審なログインの検知や通知も持っています。'
    + '書類の確認を破る手口と、パスワードを忘れることは数えていません。',
  'This map counts a fictional person\'s accounts with simplified rules. Real services also detect suspicious log-ins and send notifications. '
    + 'Forged documents and forgotten passwords are not counted.'],
  ['formTitle', 'わたしの地図（記号で書く用紙）', 'My map (fill in with symbols)'],
  ['formColNo', 'No.', 'No.'], ['formColAccount', 'アカウント（略称）', 'Account (short)'], ['formColImportant', '★', '★'],
  ['formColRole', 'ロ／復', 'Log/Rec'], ['formColReq', '条件（記号）', 'Requirements (symbols)'], ['formColNotes', 'メモ', 'Notes'],
  ['printColAccount', 'アカウント', 'Account'], ['printColEntrances', '入口', 'Entrances'], ['printColLeak', '漏えい', 'Breach'],
  ['printColSimswap', 'SIM', 'SIM'], ['printColMail', 'メール乗っ取り', 'Email takeover'], ['printColDesk', '窓口', 'Desk'],
  ['printColPhone', 'スマホ', 'Phone'], ['printColNumber', '番号', 'Number'], ['printColMailLoss', '{mailHead}', '{mailHead}'],
  ['printBackdoor', '裏', 'bd'],
  ['printLegendSim', 'SIM＝SIMスワップ', 'SIM = SIM swap'], ['printLegendDesk', '窓口＝窓口のなりすまし', 'Desk = Help-desk impersonation'],
  ['printLegendBackdoor', '裏＝裏口', 'bd = backdoor'],
  ['printLegendNone', '－＝倒れない', '– = does not fall'], ['printLegendOk', '○＝入れる', '○ = can get in'],
  ['printLegendPlus', '○（＋番号で×）＝番号も失うと入れない', '○ (× if the number goes too) = losing the number too locks you out'],
  ['printGroupAttack', '攻撃カード', 'Attack cards'], ['printGroupLoss', '失ったとき', 'When lost'],
  ['formHow1', 'アカウントの名前は略してよい（例：メールA、銀行）。', 'Account names may be shortened (e.g. Mail A, Bank).'],
  ['formHow2', 'パスワードは書かない。同じパスワード（少し変えたものを含む）には同じ記号を付ける（赤Aなど）。',
    'Do not write passwords. Give the same symbol to the same password, including slight variations (Red A and so on).'],
  ['formHow3', '入口ごとに1行。ロ＝ログイン（カタカナのロ）、復＝復旧。条件が2つ以上なら＋でつなぐ（例：赤A＋SMS）。',
    'One line per entrance. Log = log-in, Rec = recovery. Join two or more requirements with + (e.g. Red A + SMS).'],
  ['formHow4', '書き終えたら、多くのアカウントの復旧の先になっているメールを探し、電話番号1本に頼る入口を数える。',
    'When finished, find the email that many accounts use for recovery, and count the entrances that rely on a single phone number.'],
];
// The symbols table (Japanese, then English); a blank cell of the spec is null
const SYMBOLS = {
  ja: [['赤Aなど', 'パスワードの系統', 'パスワードの系統', '漏えい（漏れたサービスの系統）', '（扱わない）'],
    ['スマホ', '認証アプリ・パスキー', '多要素', '（なし。端末の感染は模型の外）', 'スマホをなくした'],
    ['SMS', '電話番号に届くコード', 'SMS', 'SIMスワップ', '電話番号を手放した'],
    ['個人情報', '電話の窓口で答える情報', '窓口', '窓口のなりすまし', '（なくさない扱い）'],
    ['書類', '身分証・郵送での本人確認', '窓口', '（なし。偽造は模型の外）', '（なくさない扱い）'],
    ['紙', '紙の回復コード（1手で増える）', '紙の回復コード', '（なし）', '紙をなくした（2つ同時の行と、手のあとの表の「＋紙で×」だけ）'],
    ['メールの名前', 'メールのアカウント', 'メール', 'メールの乗っ取り（人ごとに1つ＝会社員は古いメール、親はプロバイダーのメール、学生は大学のメール）',
      'メールが消えた（同じく人ごとに1つ）'],
    ['ロ／復、＋', 'ログインの入口（カタカナのロ）／復旧の入口、かつ（図と印刷で使う。画面の表では「ログイン」「復旧」と書く）', '実線／破線', null, null],
    ['●1・×・消・★', '段1で倒れた・閉め出し・そのメール自体が消えた・重要', null, null, null]],
  en: [['Red A, etc.', 'Password family', 'Password family', 'Breach (the family the breached service uses)', '(not modeled)'],
    ['Phone', 'Authenticator app, passkey', 'Multi-factor', '(none; an infected device is outside the model)', 'Lost the phone'],
    ['SMS', 'Code sent to the phone number', 'SMS', 'SIM swap', 'Gave up the phone number'],
    ['Personal details', 'Answers given to a phone help desk', 'Help desk', 'Help-desk impersonation', '(treated as never lost)'],
    ['Documents', 'Identity check with photo ID or postal mail', 'Help desk', '(none; forgery is outside the model)', '(treated as never lost)'],
    ['Paper codes', 'Paper recovery codes (added by a change)', 'Paper recovery codes', '(none)',
      'Lost the paper recovery codes (only in two-at-once lines and “× if the paper codes go too” in the after-change table)'],
    ['Email name', 'An email account', 'Email', 'Email takeover (one per person: the old email, the ISP email, the university email)',
      'Email gone (one per person, likewise)'],
    ['Log / Rec, +', 'Log-in entrance / recovery entrance, AND (diagram and printed sheets only; tables use the words)', 'Solid / dashed', null, null],
    ['●1 · × · gone · ★', 'Fell at step 1 · locked out · the email itself is gone · important', null, null, null]],
};
// The four notes of the rules tab, as the spec writes them (the related tools are links on the screen)
const RULE_NOTES = {
  ja: ['SMSの線は、SIMスワップのカードがあるときだけ攻撃者に開きます。根拠の研究（Leeら、SOUPS 2020。携帯会社を調べたのは2019年）は'
    + '米国のプリペイド5社のもので、日本の携帯会社には当てはめません。',
  'パスキーと認証アプリはスマホの中の鍵として扱います。同期したパスキーをクラウドのアカウントの回復で取り出す経路と、端末の感染で乗っ取る経路は、'
    + 'この模型に入れていません。この模型にはスマホを攻撃者に渡すカードがないので、スマホを足す手で攻撃の面が悪くなることはありません。'
    + '「スマホをなくした」の値は、認証アプリやパスキーを、ほかの端末やクラウドに移していない（同期・バックアップしていない）場合の値です。',
  '電話の窓口は個人情報で通ります。この模型には、書類での本人確認を破るカードも、本人が書類をなくすカードもありません。'
    + 'このため、書類の確認へ付け替える手で、攻撃と閉め出しが悪くなることはありません。実際には書類は偽造で破られることがあり、'
    + '窓口での回復には待ち時間もかかります。実在の本人確認の手順は書きません。',
  '紙の回復コードは本人の手元にだけあります。この模型には紙を攻撃者に渡すカードがないので、紙へ付け替える手で攻撃の面が悪くなることはありません。'
    + '実際には置き場所が新しい入口になり、打ち込む場面では偽サイトに強くありません。閉め出しの面では、紙をほかのものと一緒になくすと入れなくなることがあります。'
    + '紙を分けて保管するならDay124 Scatter Seeds・Day125 Overlay QR Sharesへ。'],
  en: ['An SMS line opens for the attacker only with the SIM-swap card. The study behind it (Lee et al., SOUPS 2020; carrier tests run in 2019) '
    + 'covered five US prepaid carriers and is not applied to Japanese carriers.',
  'Passkeys and authenticator apps are treated as keys inside the phone. Retrieving synced passkeys through cloud-account recovery, '
    + 'and takeover through an infected device, are outside this model. No card here hands the phone to the attacker, '
    + 'so adding the phone never makes the attack side worse. The “Lost the phone” values assume the authenticator app and passkeys '
    + 'are not synced or backed up to another device or the cloud.',
  'A phone help desk accepts personal details. This model has no card that defeats a document check and no card for the owner losing their '
    + 'documents, so moving a line to a document check never makes the attack or the lockout worse here. In reality documents can be forged, '
    + 'and recovery at a desk takes time. Real identity-check procedures are not described.',
  'Paper recovery codes exist only in the owner\'s hands. No card here hands the paper codes to the attacker, so moving a line to paper codes '
    + 'never makes the attack side worse. In reality, where you keep them becomes a new entrance, and they are not phishing-resistant when you '
    + 'type them in. On the lockout side, losing the paper codes together with something else can lock you out. To keep them split across places, '
    + 'see Day124 Scatter Seeds and Day125 Overlay QR Shares.'],
};
// The four notes as app.js puts them together (the note on passkeys ends with the phone note of the lockout tab, and the
// paper note carries the 2nd to 4th sentences that tab 3 uses after a change to paper)
const ruleNotes = (lang) => {
  const T = M[lang];
  return [T.noteSms, V.fill(T.notePasskey, { sync: T.lockNoteSync }), T.noteDesk,
    V.fill(T.notePaperRules, { paper: T.notePaper, day124: T.toolDay124, day125: T.toolDay125 })];
};

test('G: the screen text of tab 4 and of the printed sheets is the text of the spec', () => {
  for (const [key, ja, en] of RULES_TEXT) assert.deepEqual([M.ja[key], M.en[key]], [ja, en], key);
  for (const lang of ['ja', 'en']) {
    const symbols = V.symbolTable(M, lang);
    assert.deepEqual(symbols.columns, ['symbolColSymbol', 'symbolColMeaning', 'symbolColLine', 'symbolColAttack', 'symbolColLoss']
      .map((key) => M[lang][key]), lang);
    assert.deepEqual(symbols.rows.map((row) => row.cells), SYMBOLS[lang], lang);
    assert.deepEqual(ruleNotes(lang), RULE_NOTES[lang], lang);
  }
  // The keep-safe box and the dates line of the blank sheet (Japanese as the spec writes them; the English box title is the
  // one the paper intro names, and the English dates line carries the three labels of the spec)
  assert.equal(M.ja.formKeepTitle, '保管注意（弱点の地図）');
  assert.equal(M.ja.formKeepText, 'この用紙には、どのアカウントがどの線で開くかという弱点の地図を書きます。パスワードそのものは書かず、'
    + '系統の記号（色と英字）だけを書きます。写真に撮ったり、クラウドやメッセージで送ったりしないでください。人目に触れない場所に保管し、'
    + '要らなくなったら細かく破いて捨ててください。');
  assert.equal(M.ja.formDates, '書いた日：＿＿＿＿　保管する場所：＿＿＿＿＿＿　見直す日：＿＿＿＿');
  assert.ok(M.en.paperFormIntro.includes('“' + M.en.formKeepTitle + '”') && M.ja.paperFormIntro.includes('「' + M.ja.formKeepTitle + '」'));
  for (const label of ['Date written', 'Kept at', 'Review on']) assert.ok(M.en.formDates.includes(label + ':'), label);
  // The marks under the legend of each printed page are the marks of the table cells (none, can get in, one more loss)
  for (const lang of ['ja', 'en']) {
    const L = M[lang], mark = (key) => L[key].split(lang === 'ja' ? '＝' : ' = ')[0];
    assert.deepEqual([mark('printLegendNone'), mark('printLegendOk'), mark('printLegendPlus')],
      [L.cellNone, L.cellOk, V.fill(L.cellPlus1, { p: L.partnerNumber })], lang);
  }
});

// The three people of the spec ("3人（既知の値）"), row by row: account (★ and full name), entrances (symbols), the four
// attack cards, the three losses. The print leaves out the "（パスキー）" the spec adds to the brokerage's phone.
const PRINT_TABLES = {
  worker: [
    ['★メインのメール', 'ロ：赤A／復：SMS／復：古いメール', '●1', '●1裏', '●1裏', '●2裏', '○', '○', '○'],
    ['古いメール（前のプロバイダー）', 'ロ：灰C／復：個人情報', '－', '－', '●0', '●1裏', '○', '○', '消'],
    ['ポイントアプリ', 'ロ：赤A／復：メインのメール', '●1', '●2裏', '●2裏', '●3裏', '○', '○', '○'],
    ['通販（カード登録あり）', 'ロ：赤A／復：メインのメール', '●1', '●2裏', '●2裏', '●3裏', '○', '○', '○'],
    ['SNS', 'ロ：赤A＋SMS／復：メインのメール', '●2裏', '●2裏', '●2裏', '●3裏', '○', '○', '○'],
    ['フリマアプリ（売上金）', 'ロ：SMS／復：メインのメール', '●2裏', '●1', '●2裏', '●3裏', '○', '○', '○'],
    ['写真のクラウド', 'ロ：赤A＋スマホ／復：メインのメール', '●2裏', '●2裏', '●2裏', '●3裏', '○', '○', '○'],
    ['★ネット銀行', 'ロ：青B＋スマホ／復：SMS＋個人情報', '－', '－', '－', '－', '○（＋番号で×）', '○（＋スマホで×）', '○'],
    ['★ネット証券', 'ロ：スマホ／復：メインのメール＋SMS', '－', '●2裏', '－', '－', '○（＋番号で×）', '○（＋スマホで×）', '○'],
  ],
  parent: [
    ['★プロバイダーのメール', 'ロ：黄A／復：個人情報', '●1', '－', '●0', '●1裏', '○', '○', '消'],
    ['★銀行のネットバンキング', 'ロ：黄A＋SMS／復：SMS', '－', '●1裏', '－', '－', '○（＋番号で×）', '×', '○（＋番号で×）'],
    ['ポイントアプリ', 'ロ：黄A／復：プロバイダーのメール', '●1', '－', '●1裏', '●2裏', '○', '○', '○'],
    ['通販', 'ロ：黄A／復：プロバイダーのメール', '●1', '－', '●1裏', '●2裏', '○', '○', '○'],
    ['メッセージアプリ（家族との連絡）', 'ロ：スマホ／復：SMS＋黄A', '－', '－', '－', '－', '○（＋番号で×）', '○（＋スマホで×）', '○'],
    ['写真のクラウド', 'ロ：黄A／復：プロバイダーのメール', '●1', '－', '●1裏', '●2裏', '○', '○', '○'],
    ['★ネット証券（NISA）', 'ロ：スマホ／復：プロバイダーのメール＋SMS', '－', '－', '－', '－', '○（＋番号か＋プロバイダーのメールで×）',
      '○（＋スマホで×）', '○（＋スマホで×）'],
  ],
  student: [
    ['大学のメール', 'ロ：紫B＋スマホ／復：書類', '－', '－', '●0', '－', '○', '○', '消'],
    ['★フリーメール', 'ロ：緑A／復：大学のメール／復：SMS', '●1', '●1裏', '●1裏', '－', '○', '○', '○'],
    ['★SNS', 'ロ：緑A／復：大学のメール', '●1', '－', '●1裏', '－', '○', '○', '○'],
    ['ゲーム（課金・アイテム）', 'ロ：緑A／復：フリーメール', '●1', '●2裏', '●2裏', '－', '○', '○', '○'],
    ['フリマアプリ', 'ロ：SMS／復：フリーメール', '●2裏', '●1', '●2裏', '－', '○', '○', '○'],
    ['動画のサブスク（学割）', 'ロ：大学のメール', '－', '－', '●1', '－', '○（＋大学のメールで×）', '○（＋大学のメールで×）', '×'],
    ['★ネット証券（つみたて）', 'ロ：スマホ／復：フリーメール', '●2裏', '●2裏', '●2裏', '－', '○', '○', '○'],
  ],
};
const PRINT_HEADS = {
  ja: ['アカウント', '入口', '漏えい', 'SIM', 'メール乗っ取り', '窓口', 'スマホ', '番号'],
  en: ['Account', 'Entrances', 'Breach', 'SIM', 'Email takeover', 'Desk', 'Phone', 'Number'],
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
    // English: the same marks (the backdoor mark is " bd", none is "–"), as many entrances, and no Japanese
    const toEnglish = (cell) => cell.replace(/^(●\d)裏$/, '$1 bd').replace(/^－$/, '–');
    printRows(en).forEach((row, i) => {
      assert.deepEqual(row.slice(2, 6), PRINT_TABLES[id][i].slice(2, 6).map(toEnglish), id + ' ' + row[0]);
      assert.equal(row[1].split(' / ').length, PRINT_TABLES[id][i][1].split('／').length, id + ' ' + row[1]);
      assert.doesNotMatch(row.join(' '), JAPANESE, id);
    });
  }
  assert.deepEqual(PEOPLE.map((id) => PRINT_TABLES[id].length), [9, 7, 7]);
  // Known English rows (the entrance symbols "Log: Red A / Rec: SMS" of the spec, and the cells of the lockout tables)
  const worker = printRows(V.printTable(persona('worker'), pv('worker'), M, 'en'));
  assert.deepEqual(worker[0], ['★Main email', 'Log: Red A / Rec: SMS / Rec: Old email', '●1', '●1 bd', '●1 bd', '●2 bd', '○', '○', '○']);
  assert.deepEqual(worker[8], ['★Online brokerage', 'Log: Phone / Rec: Main email + SMS', '–', '●2 bd', '–', '–',
    '○ (× if the number goes too)', '○ (× if the phone goes too)', '○']);
  const parent = printRows(V.printTable(persona('parent'), pv('parent'), M, 'en'));
  assert.deepEqual(parent[6].slice(6), ['○ (× if the number or the ISP email goes too)', '○ (× if the phone goes too)',
    '○ (× if the phone goes too)']);
});

// ===== The lessons of the help =====
// The names of the ten lessons of the spec (the title adds the number)
const LESSON_NAMES = ['アカウントの地図と「かつ・または」', '使い回しとリスト型攻撃', '復旧の線は入口にもなる（裏口）', 'SMSとSIMスワップ',
  '窓口（ヘルプデスク）', 'パスキーと証券口座', '閉め出し', '外すか、付け替えるか（紙の回復コード）', '模型の約束と研究の形式', '関連ツールと点検画面との関係'];
const lessonText = (n, lang) => Object.keys(M[lang]).filter((k) => new RegExp('^lesson' + n + 'Text\\d+$').test(k)).map((k) => M[lang][k]).join('\n');
// The sentences the spec gives for the lessons, word for word (Japanese, then English when the spec gives it too)
const LESSON_SENTENCES = [
  ['lesson2Text3', '2026年10月、国内のポイントサイトで、よそで漏れたIDとパスワードの組によって不正にログインされた可能性のあるアカウントが249件あると'
    + '公表されました。', null],
  ['lesson9Text2', 'この例は論文の形式（パスワードも失いうる）での比べ方で、画面の喪失カードとは別です。', null],
  ['lesson9Text3', '2020年に20人を面接した研究（CHI 2022）では、2つのメールが互いの回復先になっている輪が3つ見つかっています。', null],
  ['lesson9Text4', '裏口の印は、Hammannらの定義26を点数なしの二値にしたものです（このカードで倒れたアカウントのうち、復旧の入口をまとめて外したグラフでは'
    + '倒れないものが裏口）。1手の比較は、入口や条件を1つずつ変えて前後を比べる形にしました。論文の点数とaccess setの全列挙は持ちません。', null],
  ['lesson10Text1', 'Day083 Intrusion Path Mapperでも、アカウントをノードにして「メールが乗っ取られたらどこまで届くか」を見られます。ただしDay083の経路は'
    + '1本の道筋で、成功確率は各ノードの値の積です。本ツールは、2つの鍵がそろったときだけ開く「かつ」（多要素）、1つのパスワードが複数のアカウントを'
    + '同時に開く使い回し、復旧の線、本人の閉め出しを、決まった規則で扱います。',
  'Day083 Intrusion Path Mapper can also show, with accounts as nodes, how far a hijacked email account reaches. Its paths are single chains, '
    + 'though, and their success probability is a product of per-node values. This tool applies fixed rules to an account that opens only when '
    + 'two keys are both present (multi-factor), one password opening several accounts at once (reuse), recovery lines, and the owner being '
    + 'locked out.'],
];
// Phrases that the English text must carry (the wording given for the English lessons), lesson by lesson
const ENGLISH_PHRASES = {
  2: ['249 accounts that may have been logged into without authorization', '43–51%', 'circulates as-is',
    'the password requirement is met on every entrance'],
  3: ['81.1% of 239 sites', 'A 2018 study', '37 of 71 sites', '26 of them by email alone', 'German- and English-language sites',
    'banking and investment sites', 'were excluded', 'In 2022'],
  4: ['“restricted”', 'a US federal guideline, not an obligation for Japanese companies', 'five US prepaid carriers in 2019'],
  5: ['noted that help-desk social engineering', 'was being discussed, and recommended reviewing reset procedures',
    '(for organizations\' internal help desks)'],
  6: ['a self-regulatory guideline', 'supervisory guidelines', 'Neither is a law.', '“multifactor authentication resilient to phishing attacks”',
    '“make it essential (set as initial setting)”', 'the cryptography was not broken'],
  7: ['interviews with 20 people in 2020', 'A study that asked 185 users of either of two major providers\' accounts (about half living in the US, '
    + 'half in Germany) about their settings in January 2023 found that 27 of them could be locked out by losing a single thing, nearly always '
    + 'their main phone'],
  8: ['does not necessarily rule out lockout'],
  9: ['three cycles were found in which two emails were each other\'s recovery address'],
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
    5: ['議論されていることに触れ', 'リセット手順の見直しを勧めました', '企業の社内ヘルプデスク', '秘密の質問は入っていません'],
    6: ['自主規制のガイドライン', '監督指針', 'どちらも法令ではありません', '原則2026年6月末', '代替の多要素認証も認めています', '依存します',
      '暗号が破られたわけではありません'],
    7: ['2020年に20人を面接した研究', '30日', '2カ月', '2023年1月', '185人', '27人', 'ほとんどがメインのスマホ'],
    8: ['64ビット以上の乱数', '要件ではありません', '偽サイトに強くありません', 'AAL2', '閉め出しがなくなるとは限りません'],
  };
  for (const [n, phrases] of Object.entries(JA)) {
    for (const phrase of phrases) assert.ok(lessonText(n, 'ja').includes(phrase), 'lesson ' + n + ': ' + phrase);
  }
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
    ['Jsda2025', '日本証券業協会「インターネット取引における不正アクセス等防止に向けたガイドライン」（2025-10-15 施行）',
      'Japan Securities Dealers Association (JSDA), "Guidelines for Prevention of Unauthorized Access, etc. in Internet Transactions" '
        + '(in Japanese), effective 2025-10-15'],
    ['FsaGuidelines', '金融庁「金融商品取引業者等向けの総合的な監督指針」（2025-10-15 適用の改正）',
      'Financial Services Agency (FSA), "Comprehensive Guidelines for Supervision of Financial Instruments Business Operators, etc." '
        + '(in Japanese), amended 2025-10-15'],
    ['FsaDialogue', '金融庁「業界団体との意見交換会において金融庁が提起した主な論点」（2025-07-15 開催、日本証券業協会）',
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
  // The sentence of the spec for lesson 7 (in Japanese in the polite form of the lessons) and the English sentence given for
  // it, word for word; the authors are named in the bibliography only
  assert.equal(M.ja.lesson7Text3, '2023年1月に、大手2社のどちらか一方のアカウントについて、米国とドイツの居住者ほぼ半数ずつの185人に設定を尋ねた研究では、'
    + '27人が、1つを失うだけで入れなくなるおそれのある設定で、失うものはほとんどがメインのスマホでした。');
  assert.equal(M.en.lesson7Text3, 'A study that asked 185 users of either of two major providers\' accounts (about half living in the US, half in '
    + 'Germany) about their settings in January 2023 found that 27 of them could be locked out by losing a single thing, nearly always their main phone.');
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
