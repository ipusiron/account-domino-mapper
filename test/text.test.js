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

test('G: the ranking note follows the mode, and the one-account step summary is singular in English', () => {
  for (const mode of ['leak', 'simswap', 'mail', 'desk', 'all']) {
    assert.ok(V.rankingNote(mode, M, 'ja').startsWith('閉め出しを1つでも増やす手は後ろに並べます。'), mode);
    assert.ok(V.rankingNote(mode, M, 'en').startsWith('Changes that add any lockout go last.'), mode);
  }
  assert.ok(V.rankingNote('lockout', M, 'ja').startsWith('閉め出しの増減（減る手が先）'));
  assert.ok(V.rankingNote('lockout', M, 'en').startsWith('Ranked by the change in lockouts (largest decrease first)'));
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
