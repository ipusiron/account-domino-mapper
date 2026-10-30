'use strict';
// F: the view helpers in domino-view.js (no DOM) against the known vectors (test/vectors.json) and the known values of the spec.
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
const CARDS = ['leak', 'simswap', 'mail', 'desk'];
const MODES = [...CARDS, 'all', 'lockout'];
const persona = (id) => D.personas.find((p) => p.id === id);
const cache = {};
const pv = (id) => (cache[id] ||= C.personaVectors(persona(id)));

// The candidates table of the spec: per person and mode, [move id, effect (ja), effect (en)] in order, or the reason when empty.
const CANDIDATES = {
  worker: {
    leak: [['replace:points.login:pw:red>pw:own-points', '守れる5（★1）', 'Saves: 5 (★1)'],
      ['add:mailMain.login:+device', '守れる4（★1）', 'Saves: 4 (★1)'],
      ['replace:sns.recMail:mailMain>mailOld', '守れる1・2つ同時で新たに×1', 'Saves: 1 · New two-at-once lockouts: 1']],
    simswap: [['replace:mailMain.recSms:phone>paper:mailMain', '守れる6（★2）', 'Saves: 6 (★2)'],
      ['replace:sec.recMailSms:mailMain>mailOld', '守れる1（★1）・2つ同時で新たに×1', 'Saves: 1 (★1) · New two-at-once lockouts: 1'],
      ['replace:points.recMail:mailMain>mailOld', '守れる1', 'Saves: 1']],
    mail: [['replace:mailMain.recMail:mailOld>paper:mailMain', '守れる6（★1）', 'Saves: 6 (★1)'],
      ['replace:shop.recMail:mailMain>paper:shop', '守れる1', 'Saves: 1'],
      ['replace:sns.recMail:mailMain>paper:sns', '守れる1・2つ同時で新たに×1', 'Saves: 1 · New two-at-once lockouts: 1']],
    desk: [['replace:mailOld.recDesk:info>idcheck', '守れる7（★1）', 'Saves: 7 (★1)'],
      ['replace:mailMain.recMail:mailOld>paper:mailMain', '守れる6（★1）', 'Saves: 6 (★1)'],
      ['replace:shop.recMail:mailMain>paper:shop', '守れる1', 'Saves: 1']],
    all: [['replace:mailMain.recMail:mailOld>paper:mailMain', '守れる（延べ）12（★2）', 'Saves (sum over 4 cards): 12 (★2)'],
      ['replace:mailMain.recSms:phone>paper:mailMain', '守れる（延べ）6（★2）', 'Saves (sum over 4 cards): 6 (★2)'],
      ['replace:mailOld.recDesk:info>idcheck', '守れる（延べ）7（★1）', 'Saves (sum over 4 cards): 7 (★1)']],
    lockout: 'noLockout',
  },
  parent: {
    leak: [['replace:points.login:pw:yellow>pw:own-points', '守れる3（★1）', 'Saves: 3 (★1)'],
      ['replace:mailIsp.login:pw:yellow>pw:own-mailIsp', '守れる1（★1）', 'Saves: 1 (★1)']],
    simswap: [['replace:bank.recSms:phone>idcheck', '守れる1（★1）', 'Saves: 1 (★1)']],
    mail: [['replace:shop.recMail:mailIsp>paper:shop', '守れる1', 'Saves: 1'],
      ['replace:photo.recMail:mailIsp>paper:photo', '守れる1', 'Saves: 1'], ['remove:points.recMail', '守れる1', 'Saves: 1']],
    desk: [['replace:mailIsp.recDesk:info>idcheck', '守れる4（★1）', 'Saves: 4 (★1)'],
      ['replace:shop.recMail:mailIsp>paper:shop', '守れる1', 'Saves: 1'], ['replace:photo.recMail:mailIsp>paper:photo', '守れる1', 'Saves: 1']],
    all: [['replace:mailIsp.recDesk:info>idcheck', '守れる（延べ）4（★1）', 'Saves (sum over 4 cards): 4 (★1)'],
      ['replace:points.login:pw:yellow>pw:own-points', '守れる（延べ）3（★1）', 'Saves (sum over 4 cards): 3 (★1)'],
      ['replace:bank.recSms:phone>idcheck', '守れる（延べ）1（★1）', 'Saves (sum over 4 cards): 1 (★1)']],
    lockout: [['replace:bank.recSms:phone>idcheck', '閉め出しが解ける1', 'Unlocks: 1'],
      ['replace:bank.login:phone>device', '閉め出しが解ける1', 'Unlocks: 1']],
  },
  student: {
    leak: [['replace:game.login:pw:green>pw:own-game', '守れる4（★3）', 'Saves: 4 (★3)'],
      ['add:mailFree.login:+device', '守れる3（★2）', 'Saves: 3 (★2)'],
      ['add:sns.login:+device', '守れる1（★1）・2つ同時で新たに×1', 'Saves: 1 (★1) · New two-at-once lockouts: 1']],
    simswap: [['replace:mailFree.recSms:phone>paper:mailFree', '守れる3（★2）', 'Saves: 3 (★2)'],
      ['replace:sec.recMail:mailFree>mailUni', '守れる1（★1）・2つ同時で新たに×1', 'Saves: 1 (★1) · New two-at-once lockouts: 1'],
      ['replace:game.recMail:mailFree>mailUni', '守れる1', 'Saves: 1']],
    mail: [['replace:mailFree.recMail:mailUni>paper:mailFree', '守れる4（★2）', 'Saves: 4 (★2)'],
      ['replace:sns.recMail:mailUni>paper:sns', '守れる1（★1）', 'Saves: 1 (★1)'],
      ['replace:sec.recMail:mailFree>paper:sec', '守れる1（★1）・2つ同時で新たに×1', 'Saves: 1 (★1) · New two-at-once lockouts: 1']],
    desk: 'noFall',
    all: [['replace:game.login:pw:green>pw:own-game', '守れる（延べ）4（★3）', 'Saves (sum over 4 cards): 4 (★3)'],
      ['replace:sec.recMail:mailFree>paper:sec', '守れる（延べ）3（★3）・2つ同時で新たに×1',
        'Saves (sum over 4 cards): 3 (★3) · New two-at-once lockouts: 1'],
      ['replace:mailFree.recMail:mailUni>paper:mailFree', '守れる（延べ）4（★2）', 'Saves (sum over 4 cards): 4 (★2)']],
    lockout: [['replace:sub.login:mailUni>mailFree', '閉め出しが解ける1・新たに倒れる（延べ）2', 'Unlocks: 1 · Newly fallen (sum over 4 cards): 2']],
  },
};

test('F: lastStep is the step at which the last account falls to the card (0 when no account falls)', () => {
  for (const id of PEOPLE) {
    for (const card of CARDS) {
      const known = vectors.personas[id].cards[card];
      const expected = known.services.reduce((max, service) => Math.max(max, known.rank[service]), 0);
      assert.equal(V.lastStep(pv(id), card), expected, id + ' ' + card);
    }
  }
  // The steps given with the highlights W1, P1, S1 and S2, and the student's help-desk card where nothing falls.
  const stated = [['worker', 'leak', 2], ['parent', 'simswap', 1], ['student', 'leak', 2], ['student', 'mail', 2], ['student', 'desk', 0]];
  for (const [id, card, step] of stated) assert.equal(V.lastStep(pv(id), card), step, id + ' ' + card);
});

test('F: the ranking and the suggested change are the known vectors', () => {
  for (const id of PEOPLE) {
    assert.deepEqual(pv(id).ranking, vectors.personas[id].ranking, id);
    assert.deepEqual(pv(id).best, vectors.personas[id].best, id);
  }
});

test('F: candidates (up to three, one per entrance, the suggestion first) and their effect lines in Japanese and English', () => {
  for (const id of PEOPLE) {
    for (const mode of MODES) {
      const expected = CANDIDATES[id][mode];
      const got = V.candidates(persona(id), pv(id), mode);
      if (typeof expected === 'string') {
        assert.deepEqual(got, { ids: [], reason: expected }, id + ' ' + mode);
        assert.equal(vectors.personas[id].best[mode], null, id + ' ' + mode);
        continue;
      }
      assert.deepEqual(got, { ids: expected.map((row) => row[0]), reason: null }, id + ' ' + mode);
      assert.equal(got.ids[0], vectors.personas[id].best[mode], id + ' ' + mode + ' starts with the suggestion');
      for (const [move, ja, en] of expected) {
        assert.equal(V.effectText(persona(id), pv(id), move, mode, M, 'ja'), ja, id + ' ' + mode + ' ' + move);
        assert.equal(V.effectText(persona(id), pv(id), move, mode, M, 'en'), en, id + ' ' + mode + ' ' + move);
      }
    }
  }
  // The effect numbers behind one button: the worker's two-at-once side effect under the SIM swap.
  assert.deepEqual(V.effect(persona('worker'), pv('worker'), 'replace:sec.recMailSms:mailMain>mailOld', 'simswap'),
    { saved: 1, imp: 1, unlocked: 0, newly: 0, exposedAll: 0, pairNew: 1 });
});

test('F: the map after a change uses the person after the change (89 changes × 4 cards)', () => {
  let scenes = 0;
  for (const id of PEOPLE) {
    const known = vectors.personas[id];
    for (const move of known.moves) {
      for (const card of CARDS) {
        const after = V.afterMap(persona(id), move.id, card);
        const before = known.cards[card].services;
        const { saved, exposed } = move.cards[card];
        const expected = known.services.filter((s) => (before.includes(s) && !saved.includes(s)) || exposed.includes(s));
        assert.deepEqual(after.services, expected, id + ' ' + move.id + ' ' + card);
        assert.equal(after.changedMethod, move.service + '.' + move.method);
        for (const s of after.backdoor) assert.ok(after.services.includes(s), 'a backdoor account falls');
        scenes++;
      }
    }
  }
  assert.equal(scenes, 89 * 4);
  // The breach suggestions: one account falls after the change (the breached service itself).
  for (const [id, move, service] of [['worker', 'replace:points.login:pw:red>pw:own-points', 'points'],
    ['parent', 'replace:points.login:pw:yellow>pw:own-points', 'points'], ['student', 'replace:game.login:pw:green>pw:own-game', 'game']]) {
    const after = V.afterMap(persona(id), move, 'leak');
    assert.deepEqual(after.services, [service], id);
    assert.deepEqual(after.gives, ['pw:own-' + service], id);
  }
  // Known backdoor after a change: the student's subscription after moving its log-in code to the free email.
  const sub = (card) => V.afterMap(persona('student'), 'replace:sub.login:mailUni>mailFree', card);
  for (const card of ['leak', 'simswap', 'mail']) {
    assert.equal(sub(card).rank.sub, 2, card);
    assert.equal(sub(card).via.sub, 'sub.login', card);
  }
  assert.equal(sub('simswap').backdoor.includes('sub'), true);
  assert.equal(sub('mail').backdoor.includes('sub'), true);
  assert.equal(sub('leak').backdoor.includes('sub'), false);
});

test('F: a changed entrance is named from its requirement tags, not from the data label', () => {
  const cases = [['replace:sub.login:mailUni>mailFree', 'sub', 'ログイン：フリーメール', 'Log-in: Free email'],
    ['replace:sns.recMail:mailUni>mailFree', 'sns', '復旧：フリーメール', 'Recovery: Free email']];
  for (const [move, account, ja, en] of cases) {
    const after = V.afterMap(persona('student'), move, 'simswap');
    const step = V.maxRank(after);
    for (const [lang, name, university] of [['ja', ja, '大学'], ['en', en, 'niversity']]) {
      const row = V.mapRows(after.person, after, step, M, lang, after.changedMethod).find((r) => r.id === account);
      assert.equal(row.cell.fallen, true, move);
      assert.ok(row.cell.text.includes('（' + name + '）') || row.cell.text.includes('(' + name + ')'), row.cell.text);
      const text = [row.cell.text, row.cell.sr, ...row.entrances].join(' ');
      assert.doesNotMatch(text, new RegExp(university), move + ' ' + lang + ': ' + text);
    }
  }
});

test('F: the same-entrance table for W3 (the worker\'s brokerage re-registration), in Japanese and English', () => {
  const ids = V.sameEntrance(pv('worker'), 'remove:sec.recMailSms');
  assert.deepEqual(ids, ['replace:sec.recMailSms:mailMain>mailOld', 'replace:sec.recMailSms:mailMain>paper:sec',
    'replace:sec.recMailSms:phone>paper:sec', 'replace:sec.recMailSms:phone>idcheck', 'remove:sec.recMailSms']);
  const ja = V.sameRows(persona('worker'), pv('worker'), 'remove:sec.recMailSms', M, 'ja');
  assert.equal(ja.heading, 'ネット証券の復旧（メール＋SMSでパスキーを再登録）を変える手（5）');
  assert.deepEqual(ja.rows.map((r) => [r.move, r.saved, r.newly, r.lock, r.pair]), [
    ['メインのメール→古いメール', 1, 0, '－', '新たに：スマホと古いメール'],
    ['メインのメール→紙', 1, 0, '－', '新たに：スマホと紙'],
    ['SMS→紙', 1, 0, '－', 'スマホと番号→スマホと紙'],
    ['SMS→書類', 1, 0, '－', '解ける：スマホと番号'],
    ['外す', 1, 0, '新たに×：ネット証券（スマホ）', '－'],
  ]);
  const en = V.sameRows(persona('worker'), pv('worker'), 'remove:sec.recMailSms', M, 'en');
  assert.equal(en.heading, 'Online brokerage: changes to recovery (Re-register passkey by email + SMS) (5)');
  assert.deepEqual(en.rows.map((r) => [r.move, r.saved, r.newly, r.lock, r.pair]), [
    ['Main email → Old email', 1, 0, '–', 'New: Phone and Old email'],
    ['Main email → Paper codes', 1, 0, '–', 'New: Phone and Paper codes'],
    ['SMS → Paper codes', 1, 0, '–', 'Phone and Number → Phone and Paper codes'],
    ['SMS → Documents', 1, 0, '–', 'Unlocked: Phone and Number'],
    ['Remove', 1, 0, 'Newly locked out: Online brokerage (Phone)', '–'],
  ]);
});

test('F: the same-entrance table names accounts in full (the parent\'s brokerage, whose name ends in (NISA))', () => {
  // Built from the data labels and the known vectors: the heading names the account and the entrance, and the cell of the
  // removal names the account that the lost phone now locks out.
  const p = persona('parent');
  const sec = p.services.find((s) => s.id === 'sec');
  const method = sec.methods.find((m) => m.id === 'recMailSms');
  const moves = vectors.personas.parent.moves.filter((m) => m.service === 'sec' && m.method === 'recMailSms');
  const removal = moves.find((m) => m.kind === 'remove');
  assert.deepEqual(removal.losses.device.newlyLocked, ['sec']);
  assert.ok(/）$/.test(sec.label.ja) && /\)$/.test(sec.label.en));
  const ja = V.sameRows(p, pv('parent'), removal.id, M, 'ja');
  assert.equal(ja.heading, sec.label.ja + 'の復旧（' + method.label.ja + '）を変える手（' + moves.length + '）');
  assert.equal(ja.rows.find((r) => r.id === removal.id).lock, '新たに×：' + sec.label.ja + '（スマホ）');
  const en = V.sameRows(p, pv('parent'), removal.id, M, 'en');
  assert.equal(en.heading, sec.label.en + ': changes to recovery (' + method.label.en + ') (' + moves.length + ')');
  assert.equal(en.rows.find((r) => r.id === removal.id).lock, 'Newly locked out: ' + sec.label.en + ' (Phone)');
});

test('F: the select of tab 3 lists every change of the person, grouped by account, without the account at the head', () => {
  // The change sentences of the spec (W2, W3, P3 and the office worker's breach suggestion), less "{account}：" / "{account}: "
  const known = {
    worker: [['replace:mailMain.recMail:mailOld>paper:mailMain', '復旧（予備のメールで再設定）の古いメールを紙の回復コードに付け替える',
      'in recovery (Reset via backup email), replace the old email with paper recovery codes'],
    ['remove:sec.recMailSms', '復旧（メール＋SMSでパスキーを再登録）を外す', 'remove recovery (Re-register passkey by email + SMS)'],
    ['replace:points.login:pw:red>pw:own-points', 'ログイン（パスワード）のパスワード 赤Aをこのアカウントだけの系統に付け替える',
      'in log-in (Password), replace Password Red A with a family used only here']],
    parent: [['replace:bank.recSms:phone>idcheck', '復旧（SMSで再設定）の電話番号（SMS）を書類での本人確認に付け替える',
      'in recovery (Reset by SMS), replace the phone number (SMS) with a document check']],
    student: [],
  };
  const total = { worker: 41, parent: 24, student: 24 };
  for (const id of PEOPLE) {
    const p = persona(id);
    for (const lang of ['ja', 'en']) {
      const groups = V.moveOptions(p, pv(id), M, lang);
      // one group per account that has a change, in the order of the data, named by the full name
      const accounts = p.services.filter((s) => vectors.personas[id].moves.some((m) => m.service === s.id));
      assert.deepEqual(groups.map((g) => [g.account, g.label]), accounts.map((s) => [s.id, s.label[lang]]), id + ' ' + lang);
      // every change of the person once, in the order of the list
      assert.deepEqual(groups.flatMap((g) => g.moves.map((m) => m.id)), vectors.personas[id].moves.map((m) => m.id), id + ' ' + lang);
      assert.equal(groups.flatMap((g) => g.moves).length, total[id]);
      for (const g of groups) {
        for (const m of g.moves) assert.ok(m.text && !m.text.startsWith(g.label) && !/^[：:]/.test(m.text), id + ' ' + m.id + ': ' + m.text);
      }
      const text = (moveId) => groups.flatMap((g) => g.moves).find((m) => m.id === moveId).text;
      for (const [moveId, ja, en] of known[id]) assert.equal(text(moveId), lang === 'ja' ? ja : en, moveId);
    }
  }
});

// The cell of a lockout table from the known vectors and the cell types of the screen text (tab 2), for comparison.
const LOCK_CELL = {
  ja: { ok: '○', locked: '×', gone: '消', partner: { device: 'スマホ', number: '番号', paper: '紙' },
    plus: (ps) => '○（＋' + ps.join('か＋') + 'で×）' },
  en: { ok: '○', locked: '×', gone: 'gone', partner: { device: 'the phone', number: 'the number', paper: 'the paper codes' },
    plus: (ps, last) => '○ (× if ' + ps.join(' or ') + (last === 'paper' ? ' go too)' : ' goes too)') },
};
const lockText = (id, cell, lang) => {
  const f = LOCK_CELL[lang];
  if (cell.mark !== 'ok') return f[cell.mark];
  if (!cell.plus.length) return f.ok;
  const mail = persona(id).losses.find((l) => l.id === 'mail').lost[0];
  const mailName = (s) => (lang === 'ja' ? s.label.ja : 'the ' + s.label.en.replace(/\s*\([^)]*\)$/, '').replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase()));
  const name = (x) => (x === 'mail' ? mailName(persona(id).services.find((s) => s.id === mail)).replace(/（[^（）]*）$/, '') : f.partner[x]);
  return f.plus(cell.plus.map(name), cell.plus[cell.plus.length - 1]);
};

test('F: the lockout table before and after a change: only the accounts whose cells change, three losses × before and after', () => {
  let tables = 0, rows = 0;
  for (const id of PEOPLE) {
    const known = vectors.personas[id];
    for (const mv of known.moves) {
      for (const lang of ['ja', 'en']) {
        const t = V.lockChanges(persona(id), pv(id), mv.id, M, lang);
        const changed = known.services.filter((s) => known.lossTable.columns.some((c) =>
          JSON.stringify(known.lossTable.cells[c][s]) !== JSON.stringify(mv.lossTable.cells[c][s])));
        assert.deepEqual(t.rows.map((r) => r.id), changed, id + ' ' + mv.id);
        for (const row of t.rows) {
          const cells = known.lossTable.columns.flatMap((c) => [known.lossTable.cells[c][row.id], mv.lossTable.cells[c][row.id]]);
          assert.deepEqual(row.cells.map((c) => c.text), cells.map((c) => lockText(id, c, lang)), id + ' ' + mv.id + ' ' + row.id);
          assert.deepEqual(row.cells.map((c) => c.phase), ['before', 'after', 'before', 'after', 'before', 'after']);
          if (lang === 'ja') rows++;
        }
        if (lang === 'ja' && t.rows.length) tables++;
      }
    }
  }
  assert.ok(tables > 0 && rows >= tables);
  // Headings: each loss card before and after; W3 (the worker's brokerage, removed re-registration)
  const ja = V.lockChanges(persona('worker'), pv('worker'), 'remove:sec.recMailSms', M, 'ja');
  assert.deepEqual(ja.columns.map((c) => c.head), ['スマホ（前）', 'スマホ（後）', '番号（前）', '番号（後）', '古いメール（前）', '古いメール（後）']);
  assert.deepEqual(ja.rows.map((r) => [r.id, r.name, r.cells.map((c) => c.text)]),
    [['sec', 'ネット証券', ['○（＋番号で×）', '×', '○（＋スマホで×）', '○（＋スマホで×）', '○', '○（＋スマホで×）']]]);
  const en = V.lockChanges(persona('worker'), pv('worker'), 'remove:sec.recMailSms', M, 'en');
  assert.deepEqual(en.columns.map((c) => c.head), ['Phone (Before)', 'Phone (After)', 'Number (Before)', 'Number (After)',
    'Old email (Before)', 'Old email (After)']);
  // W2 changes nothing in the lockout table; P3 unlocks the bank when the number is given up (× before, ○ after)
  assert.deepEqual(V.lockChanges(persona('worker'), pv('worker'), 'replace:mailMain.recMail:mailOld>paper:mailMain', M, 'ja').rows, []);
  const p3 = V.lockChanges(persona('parent'), pv('parent'), 'replace:bank.recSms:phone>idcheck', M, 'ja').rows;
  assert.deepEqual(p3.map((r) => r.id), ['bank']);
  assert.deepEqual(p3[0].cells.slice(2, 4).map((c) => c.text), ['×', '○']);
});

test('F: the attack table marks the row of the mode\'s card only: never the total, which is not a card', () => {
  for (const id of PEOPLE) {
    const v = pv(id);
    for (const mode of MODES) {
      for (const lang of ['ja', 'en']) {
        const rows = V.sentences(persona(id), v, v.moves[0].id, M, lang, mode).attack;
        assert.deepEqual(rows.map((r) => r.card), [...CARDS, 'all'], id + ' ' + mode);
        assert.deepEqual(rows.map((r) => r.selected), [...CARDS.map((card) => card === mode), false], id + ' ' + mode + ' ' + lang);
      }
    }
    // Without a mode (the sum of the four cards is the default), no row is marked either
    assert.ok(V.sentences(persona(id), v, v.moves[0].id, M, 'ja').attack.every((r) => !r.selected), id);
  }
});

test('F: the map rows name the entrances of each account (so that the changed entrance can be marked)', () => {
  for (const id of PEOPLE) {
    const p = persona(id);
    const rows = V.mapRows(p, pv(id).cards.leak, 0, M, 'ja');
    assert.deepEqual(rows.map((r) => r.methods), p.services.map((s) => s.methods.map((m) => m.id)), id);
    assert.deepEqual(rows.map((r) => r.entrances.length), p.services.map((s) => s.methods.length), id);
  }
  // After removing an entrance, the account keeps the other entrances only
  const after = V.afterMap(persona('worker'), 'remove:sec.recMailSms', 'simswap');
  const sec = V.mapRows(after.person, after, V.maxRank(after), M, 'ja', after.changedMethod).find((r) => r.id === 'sec');
  assert.deepEqual(sec.methods, ['login']);
  assert.deepEqual(sec.entrances, ['ログイン：スマホ']);
  assert.equal(sec.cell.text, '－');
});

// The points of a drawn path (the d of a <path>) from its start to its end, at most 1px apart, as one flat list x0, y0, x1, y1, …
// M, L, C (a cubic, split until its points are at most 1px apart) and A (an arc of equal radii and no rotation, by the
// endpoint-to-center conversion of SVG, following its large-arc and sweep flags; a radius of 0 draws a straight line).
// Any other form throws, so that a path is never read in part.
function samplePath(d) {
  const tokens = d.match(/[A-Za-z]|-?\d+(?:\.\d+)?/g) || [];
  const xy = [];
  let i = 0, x0 = NaN, y0 = NaN;
  const num = () => {
    const n = Number(tokens[i++]);
    if (!Number.isFinite(n)) throw new Error('a number is missing in the path ' + d);
    return n;
  };
  const straight = (x1, y1) => {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let k = 1; k <= n; k++) xy.push(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n);
    x0 = x1;
    y0 = y1;
  };
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command !== 'M' && !xy.length) throw new Error('the path does not start with M: ' + d);
    if (command === 'M') {
      x0 = num();
      y0 = num();
      xy.push(x0, y0);
    } else if (command === 'L') straight(num(), num());
    else if (command === 'C') {
      const bx = num(), by = num(), cx = num(), cy = num(), ex = num(), ey = num();
      // from as many pieces as the control polygon is long, doubled until no two points are more than 1px apart
      let n = Math.max(8, Math.ceil(Math.hypot(bx - x0, by - y0) + Math.hypot(cx - bx, cy - by) + Math.hypot(ex - cx, ey - cy)));
      for (let pieces = null; !pieces; n *= 2) {
        pieces = [];
        for (let k = 1, px = x0, py = y0; k <= n; k++) {
          const t = k / n, u = 1 - t, w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
          const qx = w0 * x0 + w1 * bx + w2 * cx + w3 * ex, qy = w0 * y0 + w1 * by + w2 * cy + w3 * ey;
          if ((qx - px) ** 2 + (qy - py) ** 2 > 1) {
            pieces = null;
            break;
          }
          pieces.push(qx, qy);
          px = qx;
          py = qy;
        }
        if (pieces) for (const v of pieces) xy.push(v);
      }
      x0 = ex;
      y0 = ey;
    } else if (command === 'A') {
      const rx = Math.abs(num()), ry = Math.abs(num()), rotation = num(), large = num() ? 1 : 0, sweep = num() ? 1 : 0, x1 = num(), y1 = num();
      if (rx !== ry || rotation !== 0) throw new Error('an arc of unequal radii or with a rotation: ' + d);
      if (rx === 0) {
        straight(x1, y1);
        continue;
      }
      const dx = (x0 - x1) / 2, dy = (y0 - y1) / 2;
      // a radius too small for the chord is made just large enough (SVG)
      const r = rx * Math.max(1, Math.hypot(dx, dy) / rx);
      const f = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (r * r - dx * dx - dy * dy) / (dx * dx + dy * dy)));
      const cx = f * dy + (x0 + x1) / 2, cy = -f * dx + (y0 + y1) / 2;
      const a0 = Math.atan2(y0 - cy, x0 - cx);
      let da = Math.atan2(y1 - cy, x1 - cx) - a0;
      if (sweep && da < 0) da += 2 * Math.PI;
      if (!sweep && da > 0) da -= 2 * Math.PI;
      const n = Math.max(2, Math.ceil(Math.abs(da) * r));
      for (let k = 1; k <= n; k++) xy.push(cx + r * Math.cos(a0 + da * k / n), cy + r * Math.sin(a0 + da * k / n));
      x0 = x1;
      y0 = y1;
    } else throw new Error('a path command not read here: ' + command + ' in ' + d);
  }
  return xy;
}

// The first point of `path` farther than 1px from every point of `other`, or null (both flat lists x0, y0, x1, y1, …). Both run
// from the start of the same line to its end, so the search for each point goes on from the point found for the point before it.
function strayPoint(path, other) {
  let j = 0;
  for (let i = 0; i < path.length; i += 2) {
    const x = path[i], y = path[i + 1];
    while (j < other.length && (other[j] - x) ** 2 + (other[j + 1] - y) ** 2 > 1) j += 2;
    if (j >= other.length) return [x, y];
  }
  return null;
}

test('F: the diagram layout (columns, lines from left to right, no drawn line under a card it passes, the viewBox width)', () => {
  const credentials = (id) => persona(id).credentials.map((c) => c.id);
  const expectedColumns = {
    worker: [credentials('worker'), ['mailOld'], ['mailMain'], ['points', 'shop', 'sns', 'flea', 'cloud', 'bank', 'sec']],
    parent: [credentials('parent'), ['mailIsp'], ['bank', 'points', 'shop', 'msg', 'photo', 'sec']],
    student: [credentials('student'), ['mailUni'], ['mailFree'], ['sns', 'game', 'flea', 'sub', 'sec']],
  };
  assert.deepEqual(PEOPLE.map((id) => expectedColumns[id][0].length), [7, 5, 6]);
  // The parent's three columns are wider than the average gap would make them (512), so that the vertical lanes keep 4px
  // between them (see the lane test)
  const limit = { worker: 704, parent: 532, student: 704 };
  const near = (a, b) => Math.abs(a - b) < 0.01;
  let afterLines = 0, layouts = 0;
  const inspect = (L, lines, id, label) => {
    for (const line of lines) {
      const [from, to] = line.columns;
      const name = label + ': ' + line.from + ' -> ' + line.to;
      assert.ok(from < to, name);
      assert.equal(from, L.colOf[line.from], label);
      assert.equal(to, L.colOf[line.to.split('.')[0]], label);
      // The drawn path (d, sampled here, not the points that DominoView returns) starts on the right edge of its box and ends
      // on the left edge of its row
      const drawn = samplePath(line.d), n = drawn.length;
      const source = L.box[line.from], row = L.rows[line.to];
      assert.ok(n >= 4, name + ' draws nothing');
      assert.ok(near(drawn[0], source.x + source.w) && drawn[1] >= source.y && drawn[1] <= source.y + source.h,
        name + ' starts at ' + drawn.slice(0, 2));
      assert.ok(near(drawn[n - 2], row.x) && drawn[n - 1] >= row.y && drawn[n - 1] <= row.y + row.h, name + ' ends at ' + drawn.slice(-2));
      // ... and no point of it is under a card of a column between its two ends
      const rects = [];
      for (let k = from + 1; k < to; k++) for (const box of L.columns[k]) rects.push(L.box[box]);
      for (let i = 0; i < n; i += 2) {
        const x = drawn[i], y = drawn[i + 1];
        if (rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) assert.fail(name + ' under a card at ' + [x, y]);
      }
      // The points that DominoView returns with the line are at most 1px apart and follow the drawn path: the same start and
      // end, every point within 1px of the drawn path, and every point of the drawn path within 1px of them
      const points = new Array(line.points.length * 2), m = points.length;
      line.points.forEach(([x, y], k) => {
        points[2 * k] = x;
        points[2 * k + 1] = y;
      });
      assert.ok(m >= 4, name + ' has no points');
      for (let i = 2; i < m; i += 2) {
        if ((points[i] - points[i - 2]) ** 2 + (points[i + 1] - points[i - 1]) ** 2 > (1 + 1e-9) ** 2) {
          assert.fail(name + ': points more than 1px apart at ' + points.slice(i, i + 2));
        }
      }
      assert.ok([0, 1].every((k) => near(points[k], drawn[k]) && near(points[m - 2 + k], drawn[n - 2 + k])),
        name + ': the points run from ' + points.slice(0, 2) + ' to ' + points.slice(-2) + ', the drawn path from ' + drawn.slice(0, 2)
        + ' to ' + drawn.slice(-2));
      const off = strayPoint(points, drawn), away = strayPoint(drawn, points);
      assert.equal(off, null, name + ': the point ' + off + ' is off the drawn path');
      assert.equal(away, null, name + ': the drawn path at ' + away + ' is away from the points');
    }
    assert.ok(L.width <= limit[id], label + ': width ' + L.width);
    layouts++;
  };
  for (const id of PEOPLE) {
    const p = persona(id);
    for (const lang of ['ja', 'en']) {
      const base = V.layout(p, null, M, lang);
      assert.deepEqual(base.columns, expectedColumns[id], id + ' ' + lang);
      assert.equal(base.width, limit[id], id + ' ' + lang);
      inspect(base, base.lines, id, id + ' ' + lang);
      for (const move of C.enumerateMoves(p)) {
        const L = V.layout(p, C.applyMove(p, move), M, lang);
        assert.deepEqual(L.columns.slice(1), expectedColumns[id].slice(1), move.id);
        for (const [key, row] of Object.entries(base.rows)) assert.equal(L.rows[key].x, row.x, move.id);
        inspect(L, L.lines, id, id + ' ' + lang + ' after ' + move.id);
        inspect(L, L.linesBefore, id, id + ' ' + lang + ' before ' + move.id);
        if (lang === 'ja') afterLines += L.lines.length;
      }
    }
  }
  assert.equal(afterLines, 1736);
  assert.equal(layouts, 3 * 2 + 89 * 2 * 2);
});

// The straight pieces of a drawn path (M, L, A and C commands; a C counts only when it is a flat horizontal line).
function straightPieces(d) {
  const tokens = d.match(/[MLCA]|-?\d+(?:\.\d+)?/g);
  const out = [];
  let i = 0, current = null;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M') current = [num(), num()];
    else if (command === 'L') {
      const point = [num(), num()];
      out.push([current, point]);
      current = point;
    } else if (command === 'C') {
      const c1 = [num(), num()], c2 = [num(), num()], point = [num(), num()];
      if ([c1, c2, point].every((q) => Math.abs(q[1] - current[1]) < 0.01)) out.push([current, point]);
      current = point;
    } else if (command === 'A') {
      num(); num(); num(); num(); num();
      current = [num(), num()];
    }
  }
  return out.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01);
}

test('F: no two lines lie on top of each other, and the vertical lanes stay inside the gaps between columns', () => {
  let layouts = 0, pairs = 0;
  const inspect = (L, lines, label) => {
    const pieces = [];
    for (const line of lines) for (const [a, b] of straightPieces(line.d)) pieces.push({ line: line.from + ' -> ' + line.to, a, b });
    for (let i = 0; i < pieces.length; i++) {
      for (let j = i + 1; j < pieces.length; j++) {
        const s = pieces[i], u = pieces[j];
        if (s.line === u.line) continue;
        for (const along of [0, 1]) {
          const across = 1 - along;
          const flat = (q) => Math.abs(q.a[across] - q.b[across]) < 0.01;
          if (!flat(s) || !flat(u)) continue;
          const shared = Math.min(Math.max(s.a[along], s.b[along]), Math.max(u.a[along], u.b[along]))
            - Math.max(Math.min(s.a[along], s.b[along]), Math.min(u.a[along], u.b[along]));
          const distance = Math.abs(s.a[across] - u.a[across]);
          pairs++;
          // the same straight section for more than 2px, or two parallel lines closer than 2px for more than 12px
          assert.ok(!(distance < 0.5 && shared > 2) && !(distance < 2 && shared > 12),
            label + ': ' + s.line + ' and ' + u.line + ' (' + distance + 'px apart for ' + shared + 'px)');
        }
      }
    }
    // A line that crosses two or more columns goes down and up only in the gaps, at least 2px away from the cards.
    const edges = L.columns.slice(0, -1).map((ids, k) => [L.box[ids[0]].x + L.box[ids[0]].w, L.box[L.columns[k + 1][0]].x]);
    for (const line of lines.filter((l) => l.channel !== null)) {
      for (const [a, b] of straightPieces(line.d).filter(([a2, b2]) => Math.abs(a2[0] - b2[0]) < 0.01)) {
        assert.ok(edges.some(([lo, hi]) => a[0] >= lo + 2 && a[0] <= hi - 2), label + ': ' + line.from + ' -> ' + line.to + ' at x ' + a[0]);
        assert.ok(Math.abs(b[1] - a[1]) > 0);
      }
    }
    layouts++;
  };
  for (const id of PEOPLE) {
    const p = persona(id);
    for (const lang of ['ja', 'en']) {
      const base = V.layout(p, null, M, lang);
      assert.equal(base.gaps.reduce((a, b) => a + b, 0) + 2 * 12 + 104 + 160 * (base.columns.length - 1), base.width, id);
      inspect(base, base.lines, id + ' ' + lang);
      for (const move of C.enumerateMoves(p)) {
        const L = V.layout(p, C.applyMove(p, move), M, lang);
        assert.deepEqual(L.gaps, base.gaps, move.id + ': the columns stay put before and after a change');
        inspect(L, L.lines, id + ' ' + lang + ' after ' + move.id);
        inspect(L, L.linesBefore, id + ' ' + lang + ' before ' + move.id);
      }
    }
  }
  assert.equal(layouts, 3 * 2 + 89 * 2 * 2);
  assert.ok(pairs > 0);
});

// The smallest distance between two vertical lanes in each gap between columns (the x of the vertical pieces of the lines
// that cross two or more columns), or null for a gap with fewer than two lanes.
function laneSpacing(L, lines) {
  const gaps = L.columns.slice(0, -1).map((ids, k) => [L.box[ids[0]].x + L.box[ids[0]].w, L.box[L.columns[k + 1][0]].x]);
  const xs = gaps.map(() => new Set());
  for (const line of lines.filter((l) => l.channel !== null)) {
    for (const [a, b] of straightPieces(line.d).filter(([p, q]) => Math.abs(p[0] - q[0]) < 0.01)) {
      gaps.forEach(([lo, hi], g) => { if (a[0] > lo && a[0] < hi && b[1] !== a[1]) xs[g].add(a[0]); });
    }
  }
  return xs.map((set) => {
    const sorted = [...set].sort((p, q) => p - q);
    return sorted.length < 2 ? null : Math.min(...sorted.slice(1).map((x, i) => x - sorted[i]));
  });
}

test('F: the lanes of the usual diagrams: 4px apart for the parent (its diagram is made wider for that); worker and student', () => {
  // worker: 704 wide with 3.5px in the outer gaps; student: 704 wide with 4px; parent: 532 wide (within the 649px that a
  // 720px screen shows without scrolling the figure) with 4px in both gaps
  const expected = { worker: [704, [3.5, 4, 3.5]], parent: [532, [4, 4]], student: [704, [4, 4, 4]] };
  for (const id of PEOPLE) {
    for (const lang of ['ja', 'en']) {
      const L = V.layout(persona(id), null, M, lang);
      const [width, spacing] = expected[id];
      assert.equal(L.width, width, id + ' ' + lang);
      assert.deepEqual(laneSpacing(L, L.lines).map((s) => (s === null ? null : Math.round(s * 100) / 100)), spacing, id + ' ' + lang);
    }
  }
  assert.ok(expected.parent[0] <= 649);
  // The parent's diagrams before and after every change keep the width of the usual diagram, and every lane spacing of each of
  // them (per change, before and after, language and gap) is more than 2.5px and at most 4px. Both gaps of all of them have two
  // lanes or more (24 changes × before and after × ja and en × 2 gaps), so that no diagram passes for want of a spacing.
  let checked = 0;
  for (const lang of ['ja', 'en']) {
    const p = persona('parent');
    const usual = V.layout(p, null, M, lang);
    for (const move of C.enumerateMoves(p)) {
      const L = V.layout(p, C.applyMove(p, move), M, lang);
      assert.equal(L.width, usual.width, move.id);
      for (const [side, lines] of [['after', L.lines], ['before', L.linesBefore]]) {
        laneSpacing(L, lines).forEach((s, gap) => {
          const label = 'parent ' + move.id + ' ' + lang + ' ' + side + ' gap ' + gap + ': ' + s;
          assert.ok(s !== null, label);
          assert.ok(s > 2.5 && s <= 4 + 1e-9, label);
          checked++;
        });
      }
    }
  }
  assert.equal(checked, 24 * 2 * 2 * 2);
});

// The four-cards table: per person, every account (row) and every card (column): ●step or – and the sentence read aloud.
// The expected cells are built from the ranks of the known vectors and the sentence types of the screen text.
const FOUR = {
  ja: { heads: [['leak', '漏えい', '漏えい'], ['simswap', 'SIM', 'SIMスワップ'], ['mail', 'メール', 'メールの乗っ取り'],
    ['desk', '窓口', '窓口のなりすまし']], none: '－', readNone: '倒れない', readGiven: 'カードが直接渡した', readFalls: (r) => '段' + r + 'で倒れる' },
  en: { heads: [['leak', 'Breach', 'Breach'], ['simswap', 'SIM', 'SIM swap'], ['mail', 'Email', 'Email takeover'],
    ['desk', 'Desk', 'Help-desk impersonation']], none: '–', readNone: 'Does not fall', readGiven: 'Given directly by the card',
  readFalls: (r) => 'Falls at step ' + r },
};
const shortLabel = (label) => label.replace(/\s*[（(][^（）()]*[）)]$/, '');

test('F: every cell of the four-cards table follows the known ranks (three people, every account, four cards)', () => {
  const kinds = { given: 0, falls: 0, none: 0 };
  for (const id of PEOPLE) {
    const known = vectors.personas[id];
    const data = persona(id);
    for (const lang of ['ja', 'en']) {
      const f = V.fourCards(data, pv(id), M, lang);
      assert.deepEqual(f.columns.map((c) => [c.id, c.short, c.full]), FOUR[lang].heads, id + ' ' + lang);
      assert.deepEqual(f.rows.map((r) => [r.id, r.name]), data.services.map((s) => [s.id, shortLabel(s.label[lang])]), id + ' ' + lang);
      for (const row of f.rows) {
        assert.deepEqual(row.cells.map((c) => c.card), FOUR[lang].heads.map(([card]) => card));
        for (const cell of row.cells) {
          const rank = known.cards[cell.card].rank[row.id];
          const expected = rank === undefined ? { text: FOUR[lang].none, sr: FOUR[lang].readNone }
            : { text: '●' + rank, sr: rank === 0 ? FOUR[lang].readGiven : FOUR[lang].readFalls(rank) };
          assert.deepEqual({ text: cell.text, sr: cell.sr }, expected, id + ' ' + lang + ' ' + row.id + ' ' + cell.card);
          if (lang === 'ja') kinds[rank === undefined ? 'none' : rank === 0 ? 'given' : 'falls']++;
        }
      }
    }
  }
  // 23 accounts × 4 cards, and every kind of cell is there
  assert.equal(kinds.given + kinds.falls + kinds.none, 23 * 4);
  assert.ok(kinds.given > 0 && kinds.falls > 0 && kinds.none > 0, JSON.stringify(kinds));
});

test('F: the nine highlights (three per person) and the counts in their titles', () => {
  assert.deepEqual(V.highlights.map((h) => h.id), ['W1', 'W2', 'W3', 'P1', 'P2', 'P3', 'S1', 'S2', 'S3']);
  for (const id of PEOPLE) assert.equal(V.highlights.filter((h) => h.person === id).length, 3, id);
  const title = (hid, lang) => {
    const h = V.highlights.find((x) => x.id === hid);
    return V.highlightTitle(h, pv(h.person), M, lang);
  };
  assert.equal(title('W1', 'ja'), '漏えい1枚で、6つのアカウントが倒れるまで');
  assert.equal(title('W1', 'en'), 'One breach, 6 accounts falling');
  assert.equal(title('S2', 'ja'), '大学のメールの乗っ取りで、7つすべて');
  assert.equal(title('S2', 'en'), 'University email taken over: all 7');
  // The person and the whole state of each highlight are the column 状態 of the spec's table (3人の見せ場の置き場所):
  // tab 1 = chain, tab 2 = lockout, tab 3 = compare; 4枚の合計 = all; 段0 = 0, 最後の段 = last; 選ぶ = the account chosen
  const STATES = {
    W1: ['worker', { tab: 'chain', card: 'leak', step: 0, account: 'mailMain' }],
    W2: ['worker', { tab: 'compare', mode: 'all', move: 'replace:mailMain.recMail:mailOld>paper:mailMain' }],
    W3: ['worker', { tab: 'compare', mode: 'simswap', move: 'remove:sec.recMailSms' }],
    P1: ['parent', { tab: 'chain', card: 'simswap', step: 'last', account: 'bank' }],
    P2: ['parent', { tab: 'lockout', account: 'bank' }],
    P3: ['parent', { tab: 'compare', mode: 'simswap', move: 'replace:bank.recSms:phone>idcheck' }],
    S1: ['student', { tab: 'chain', card: 'leak', step: 0, account: 'sec' }],
    S2: ['student', { tab: 'chain', card: 'mail', step: 'last', account: 'mailUni' }],
    S3: ['student', { tab: 'lockout', account: 'sub' }],
  };
  assert.deepEqual(Object.fromEntries(V.highlights.map((h) => [h.id, [h.person, { ...h.state }]])), STATES);
  // ... and they point at moves and accounts that exist; the focus targets are the ones in the spec.
  for (const [hid, [id, state]] of Object.entries(STATES)) {
    if (state.move) assert.ok(pv(id).moves.some((m) => m.id === state.move), hid);
    if (state.account) assert.ok(persona(id).services.some((s) => s.id === state.account), hid);
  }
  assert.deepEqual(Object.fromEntries(V.highlights.map((h) => [h.id, h.target])), {
    W1: 'step:next', W2: 'compare-heading', W3: 'compare-heading', P1: 'detail-heading', P2: 'lock-acct:bank',
    P3: 'compare-heading', S1: 'step:next', S2: 'detail-heading', S3: 'lock-acct:sub' });
});

// The marks of the printed tables, written out per language: a card's step and the backdoor mark, and a lockout cell
const PRINT_MARK = {
  ja: { none: '－', backdoor: (rank) => '●' + rank + '裏', ok: '○', locked: '×', gone: '消', plus: '○（＋' },
  en: { none: '–', backdoor: (rank) => '●' + rank + ' bd', ok: '○', locked: '×', gone: 'gone', plus: '○ (× if ' },
};

test('F: the printed tables follow the known vectors: one row per account (9, 7, 7), the cards at their last step, the lockout cells', () => {
  const sizes = {};
  for (const id of PEOPLE) {
    const known = vectors.personas[id];
    for (const lang of ['ja', 'en']) {
      const table = V.printTable(persona(id), pv(id), M, lang);
      sizes[id] = table.rows.length;
      assert.equal(table.columns.length, 9, id);
      assert.deepEqual(table.rows.map((row) => row.id), persona(id).services.map((s) => s.id), id);
      for (const row of table.rows) {
        const service = persona(id).services.find((s) => s.id === row.id);
        assert.equal(row.name, service.label[lang], id + ' ' + row.id);
        assert.equal(row.important, !!service.important, id + ' ' + row.id);
        CARDS.forEach((card, i) => {
          const rank = known.cards[card].rank[row.id];
          const mark = PRINT_MARK[lang];
          const expected = rank === undefined ? mark.none : known.cards[card].backdoor.includes(row.id) ? mark.backdoor(rank) : '●' + rank;
          assert.equal(row.attack[i], expected, id + ' ' + row.id + ' ' + card);
        });
        known.lossTable.columns.forEach((loss, i) => {
          const cell = known.lossTable.cells[loss][row.id];
          const text = row.loss[i], mark = PRINT_MARK[lang];
          if (cell.mark === 'ok' && cell.plus.length) assert.ok(text.startsWith(mark.plus), id + ' ' + row.id + ' ' + loss + ' ' + text);
          else assert.equal(text, mark[cell.mark], id + ' ' + row.id + ' ' + loss);
        });
        // One entrance per method, each with its role symbol
        assert.equal(row.entrances.split(M[lang].sepLines).length, service.methods.length, id + ' ' + row.id);
      }
    }
  }
  assert.deepEqual(sizes, { worker: 9, parent: 7, student: 7 });
});

test('F: the symbols table has nine rows of five columns, the blank cells of the spec left empty', () => {
  for (const lang of ['ja', 'en']) {
    const symbols = V.symbolTable(M, lang);
    assert.equal(symbols.caption, M[lang].symbolCaption);
    assert.equal(symbols.rows.length, 9);
    assert.ok(symbols.rows.every((row) => row.cells.length === 5));
    assert.deepEqual(symbols.rows.map((row) => row.cells.filter((cell) => cell !== null).length), [5, 5, 5, 5, 5, 5, 5, 3, 2]);
  }
});

// ===== The lessons of the help: every number of their tables is computed again here from test/vectors.json and test/sample.json =====
const sample = JSON.parse(fs.readFileSync(path.join(__dirname, 'sample.json'), 'utf8'));
const people = () => D.personas.map((p) => ({ p, pv: pv(p.id) }));
const lessonTable = (kind, lang) => V.lessonTable(kind, people(), M, lang);
const known = (id) => vectors.personas[id];
const samplePerson = (id) => sample.personas.find((p) => p.id === id);
const PERSON_NAMES = { ja: { worker: '会社員 ハルト', parent: '高齢の親 シズエ', student: '学生 ミオ' },
  en: { worker: 'Haruto, office worker', parent: 'Shizue, older parent', student: 'Mio, student' } };
const fillText = (template, values) => template.replace(/\{(\w+)\}/g, (m, name) => (name in values ? String(values[name]) : m));
const COLOR_KEYS = { red: 'colorRed', blue: 'colorBlue', gray: 'colorGray', yellow: 'colorYellow', green: 'colorGreen', purple: 'colorPurple' };
const TAG_KEYS = { device: 'tagDevice', phone: 'tagPhone', info: 'tagInfo', idcheck: 'tagIdcheck' };
// The short tag of a requirement, written from the data and the message templates (not from DominoView)
const tagOf = (id, person, lang) => {
  const c = person.credentials.find((x) => x.id === id);
  if (!c) return shortLabel(person.services.find((s) => s.id === id).label[lang]);
  if (c.type === 'pw') return fillText(M[lang].tagFamily, { color: M[lang][COLOR_KEYS[c.family]], symbol: c.symbol });
  return M[lang][TAG_KEYS[c.type]];
};
const entranceOf = (m, person, lang) => fillText(M[lang][m.role === 'login' ? 'entranceLogin' : 'entranceRecovery'],
  { req: m.requires.map((r) => tagOf(r, person, lang)).join(M[lang].sepPlus) });

test('F: lesson 1, the social media of the office worker under the breach card (step by step) and AND / OR for the bank', () => {
  const k = known('worker').cards.leak, worker = samplePerson('worker');
  const sns = worker.services.find((s) => s.id === 'sns');
  // The known scene of the spec: log-in Red A + SMS, recovery by the main email, falls at step 2 through the recovery entrance
  assert.deepEqual(sns.methods.map((m) => [m.role, m.requires]), [['login', ['pw:red', 'phone']], ['recovery', ['mailMain']]]);
  assert.equal(k.rank.sns, 2);
  assert.equal(k.via.sns, 'sns.recMail');
  for (const lang of ['ja', 'en']) {
    const T = M[lang], table = lessonTable('flow', lang);
    assert.equal(table.grid, false);
    assert.equal(table.caption, fillText(T.lesson1FlowCaption, { person: PERSON_NAMES[lang].worker, account: shortLabel(sns.label[lang]),
      card: T.cardLeak }));
    assert.deepEqual(table.heads, [T.lesson1ColStep, T.lesson1ColAdded, ...sns.methods.map((m) => entranceOf(m, worker, lang)),
      T.lessonColResult]);
    const ids = Object.keys(k.rank);
    const expected = [0, 1, 2].map((step) => {
      const held = new Set(ids.filter((id) => k.rank[id] <= step));
      const added = ids.filter((id) => k.rank[id] === step).map((id) => {
        const c = worker.credentials.find((x) => x.id === id);
        return c ? c.label[lang] : shortLabel(worker.services.find((s) => s.id === id).label[lang]);
      });
      return [fillText(T.lessonStep, { step }), added.join(T.sepList), ...sns.methods.map((m) => {
        const missing = m.requires.filter((r) => !held.has(r));
        return missing.length ? fillText(T.lessonMissing, { items: missing.map((r) => tagOf(r, worker, lang)).join(T.sepList) }) : T.lessonMet;
      }), step < 2 ? T.srNotYet : fillText(T.srFallen, { rank: 2, via: sns.methods[1].label[lang] })];
    });
    assert.deepEqual(table.rows, expected, lang);
  }
  // Written out once in Japanese: the flow of the spec
  assert.deepEqual(lessonTable('flow', 'ja').rows, [
    ['段0', 'パスワード 赤A', '足りない：SMS', '足りない：メインのメール', 'まだ倒れていない'],
    ['段1', 'メインのメール・ポイントアプリ・通販', '足りない：SMS', 'そろった', 'まだ倒れていない'],
    ['段2', 'SNS・フリマアプリ・写真のクラウド', '足りない：SMS', 'そろった', '段2で倒れる。開けた入口：登録メールで再設定']]);
  // The bank and the SIM-swap card: AND / OR keeps it standing, counting every line as OR makes it fall (test B of the spec)
  const s = known('worker').cards.simswap;
  assert.ok(!s.services.includes('bank') && s.naiveServices.includes('bank') && s.naiveExtra.includes('bank'));
  const recovery = worker.services.find((x) => x.id === 'bank').methods.find((m) => m.role === 'recovery');
  for (const lang of ['ja', 'en']) {
    const T = M[lang], table = lessonTable('andOr', lang);
    assert.deepEqual(table.heads, [T.lesson1ColCounting, entranceOf(recovery, worker, lang), T.lessonColResult]);
    assert.deepEqual(table.rows, [[T.lesson1CountAndOr, fillText(T.lessonMissing, { items: tagOf('info', worker, lang) }), T.srNone],
      [T.lesson1CountAllOr, fillText(T.lesson1OpensWith, { items: tagOf('phone', worker, lang) }), T.lessonFalls]], lang);
  }
  assert.deepEqual(lessonTable('andOr', 'ja').rows, [['かつ・または（この教材）', '足りない：個人情報', '倒れない'],
    ['すべての線を「または」として数える', 'SMSだけで開く', '倒れる']]);
});

test('F: lesson 2, the accounts of each password family (counted from the data)', () => {
  for (const lang of ['ja', 'en']) {
    const table = lessonTable('families', lang);
    const expected = [];
    for (const person of sample.personas) {
      for (const c of person.credentials.filter((x) => x.type === 'pw')) {
        const users = person.services.filter((s) => s.methods.some((m) => m.requires.includes(c.id)));
        expected.push([PERSON_NAMES[lang][person.id], tagOf(c.id, person, lang), String(users.length),
          users.map((s) => shortLabel(s.label[lang])).join(M[lang].sepList)]);
      }
    }
    assert.deepEqual(table.rows, expected, lang);
  }
  // The known values of the spec: Red A on five accounts, one family for the parent, Green A on the free email, social media and a game
  const rows = lessonTable('families', 'ja').rows;
  assert.deepEqual(rows[0].slice(1), ['赤A', '5', 'メインのメール・ポイントアプリ・通販・SNS・写真のクラウド']);
  assert.equal(rows.filter((row) => row[0] === '高齢の親 シズエ').length, 1);
  assert.deepEqual(rows.find((row) => row[1] === '緑A').slice(2), ['3', 'フリーメール・SNS・ゲーム']);
});

test('F: lessons 3, 4 and 5, the backdoors of every card and the results of the SIM swap and the help desk (from the vectors)', () => {
  // The known values of the spec: backdoors per person and card (leak, SIM swap, email, help desk)
  const BACKDOORS = { worker: [3, 6, 6, 7], parent: [0, 1, 3, 4], student: [2, 3, 5, 0] };
  for (const id of PEOPLE) assert.deepEqual(CARDS.map((c) => known(id).cards[c].backdoor.length), BACKDOORS[id], id);
  for (const lang of ['ja', 'en']) {
    const T = M[lang], table = lessonTable('backdoors', lang);
    assert.equal(table.grid, true);
    assert.deepEqual(table.heads, [T.attackColCard, ...PEOPLE.map((id) => PERSON_NAMES[lang][id])]);
    const shortCard = { leak: T.fourCardsColLeak, simswap: T.fourCardsColSimswap, mail: T.fourCardsColMail, desk: T.fourCardsColDesk };
    const fullCard = { leak: T.cardLeak, simswap: T.cardSimswap, mail: T.cardMail, desk: T.cardDesk };
    assert.deepEqual(table.rows, CARDS.map((card, i) => [{ text: shortCard[card], sr: fullCard[card] },
      ...PEOPLE.map((id) => String(BACKDOORS[id][i]))]), lang);
  }
  // SIM swap: worker 7, parent 1, student 4 accounts fall; help desk: 7, 4 and 0 (the spec), each with its backdoors
  const FALLS = { simswap: { worker: 7, parent: 1, student: 4 }, desk: { worker: 7, parent: 4, student: 0 } };
  for (const card of ['simswap', 'desk']) {
    for (const lang of ['ja', 'en']) {
      const T = M[lang], table = lessonTable(card, lang);
      assert.equal(table.caption, T[card === 'simswap' ? 'lesson4Caption' : 'lesson5Caption']);
      assert.deepEqual(table.heads, [T.lessonColPerson, T.lessonColFallen, T.lessonColBackdoor]);
      assert.deepEqual(table.rows, PEOPLE.map((id) => [PERSON_NAMES[lang][id], String(known(id).cards[card].services.length),
        String(known(id).cards[card].backdoor.length)]), card + ' ' + lang);
      assert.deepEqual(table.rows.map((row) => Number(row[1])), PEOPLE.map((id) => FALLS[card][id]), card);
    }
  }
});

test('F: lesson 6, the brokerage of the three people: entrances and the cards it falls to (cardBase of the vectors)', () => {
  for (const lang of ['ja', 'en']) {
    const T = M[lang], table = lessonTable('brokerage', lang);
    const cardName = { leak: T.cardLeak, simswap: T.cardSimswap, mail: T.cardMail, desk: T.cardDesk };
    assert.deepEqual(table.rows, PEOPLE.map((id) => {
      const person = samplePerson(id), bases = known(id).cardBase.sec;
      const one = bases.filter((b) => b.length === 1).map((b) => cardName[b[0]]);
      const combos = bases.filter((b) => b.length > 1).map((b) => b.map((c) => cardName[c]).join(T.sepAnd));
      const entrances = person.services.find((x) => x.id === 'sec').methods.map((m) => entranceOf(m, person, lang));
      return [PERSON_NAMES[lang][id], entrances.join(T.sepLines), one.length ? one.join(T.sepList) : T.lessonNone,
        combos.length ? combos.join(T.sepCombos) : T.lessonNone];
    }), lang);
  }
  // The spec's known values: the worker's brokerage falls to the SIM swap alone; the parent's to two cards together (with the SIM swap)
  assert.deepEqual(lessonTable('brokerage', 'ja').rows.map((row) => row.slice(2)), [['SIMスワップ', 'なし'],
    ['なし', '漏えいとSIMスワップ、SIMスワップとメールの乗っ取り、SIMスワップと窓口のなりすまし'], ['漏えい・SIMスワップ・メールの乗っ取り', 'なし']]);
});

test('F: lesson 7, the accounts with × or one more loss in the lockout tables of the three people (from the vectors)', () => {
  for (const lang of ['ja', 'en']) {
    const T = M[lang], table = lessonTable('lockout', lang);
    assert.deepEqual(table.heads, [T.lessonColPerson, T.colAccount, T.lockColPhone, T.lockColNumber, T.lesson7ColMail]);
    const expected = [];
    for (const id of PEOPLE) {
      const lt = known(id).lossTable;
      assert.deepEqual(lt.columns, ['device', 'number', 'mail']);
      for (const s of samplePerson(id).services) {
        const cells = lt.columns.map((loss) => lt.cells[loss][s.id]);
        if (!cells.some((c) => c.mark === 'locked' || c.plus.length)) continue;
        expected.push([PERSON_NAMES[lang][id], s.label[lang], cells.map((c) => (c.plus.length ? 'plus' : c.mark))]);
      }
    }
    assert.deepEqual(table.rows.map((row) => [row[0], row[1].name, row.slice(2).map((c) => c.mark)]), expected, lang);
  }
  // The known rows of the spec's tables (the cells with × or "one more loss")
  const shown = lessonTable('lockout', 'ja').rows.map((row) => [row[0], (row[1].important ? '★' : '') + row[1].name,
    ...row.slice(2).map((c) => c.text)]);
  assert.deepEqual(shown, [
    ['会社員 ハルト', '★ネット銀行', '○（＋番号で×）', '○（＋スマホで×）', '○'],
    ['会社員 ハルト', '★ネット証券', '○（＋番号で×）', '○（＋スマホで×）', '○'],
    ['高齢の親 シズエ', '★銀行のネットバンキング', '○（＋番号で×）', '×', '○（＋番号で×）'],
    ['高齢の親 シズエ', 'メッセージアプリ（家族との連絡）', '○（＋番号で×）', '○（＋スマホで×）', '○'],
    ['高齢の親 シズエ', '★ネット証券（NISA）', '○（＋番号か＋プロバイダーのメールで×）', '○（＋スマホで×）', '○（＋スマホで×）'],
    ['学生 ミオ', '動画のサブスク（学割）', '○（＋大学のメールで×）', '○（＋大学のメールで×）', '×']]);
});

// The five rows of lesson 8 (the spec's lessons table, row 8 = research 03 §4-5: the worker's brokerage re-registration and main
// email SMS, the parent's bank SMS, the student's brokerage re-registration and university email help desk): the person, the change
// that removes the entrance, the change that moves it to paper codes or a document check (none for the help desk) and the tag of
// that change in Japanese and English
const LESSON8 = [
  ['worker', 'remove:sec.recMailSms', 'replace:sec.recMailSms:phone>paper:sec', 'SMS→紙', 'SMS → Paper codes'],
  ['worker', 'remove:mailMain.recSms', 'replace:mailMain.recSms:phone>paper:mailMain', 'SMS→紙', 'SMS → Paper codes'],
  ['parent', 'remove:bank.recSms', 'replace:bank.recSms:phone>idcheck', 'SMS→書類', 'SMS → Documents'],
  ['student', 'remove:sec.recMail', 'replace:sec.recMail:mailFree>paper:sec', 'フリーメール→紙', 'Free email → Paper codes'],
  ['student', 'remove:mailUni.recDesk', null, null, null],
];
const LOSS_WORDS = { device: 'Phone', number: 'Number', mail: 'Mail' };
// The summary of a change (tab 3, and the cells of lesson 8), written from the vectors and the sentence types of the spec, for the
// forms that the changes of lesson 8 take (asserted, so that another form is not written wrongly here): the attack line
// (sumAttackSaved for one set of accounts saved from one card or more, with accountsMany from four accounts, or sumAttackNone;
// nothing newly falls), the lockout line (lossOneNew and lossOneUnlocked for the phone and the number, in sumLock, or sumLockNone)
// and the line of two at once (pairMoved or pairNew per account, one pair each, in sumPair) when there is one
function summaryOf(id, mv, lang) {
  const T = M[lang], person = samplePerson(id), label = id + ' ' + mv.id + ' ' + lang;
  const full = (s) => person.services.find((x) => x.id === s).label[lang];
  const cardName = { leak: T.cardLeak, simswap: T.cardSimswap, mail: T.cardMail, desk: T.cardDesk };
  const cards = person.cards.map((c) => c.id);
  assert.ok(cards.every((c) => !mv.cards[c].exposed.length), label + ': nothing newly falls');
  const savedTo = cards.filter((c) => mv.cards[c].saved.length), saved = savedTo.length ? mv.cards[savedTo[0]].saved : [];
  assert.ok(savedTo.every((c) => mv.cards[c].saved.join() === saved.join()), label + ': one set of accounts saved');
  const accounts = saved.length >= 4 ? fillText(T.accountsMany, { first: shortLabel(full(saved[0])), n: saved.length })
    : saved.map((s) => shortLabel(full(s))).join(T.sepList);
  const lines = [savedTo.length ? fillText(T.sumAttackSaved, { cards: savedTo.map((c) => cardName[c]).join(T.sepAnd), accounts })
    : T.sumAttackNone];
  const one = [];
  for (const loss of mv.lossTable.columns) {
    const { newlyLocked, unlocked } = mv.losses[loss];
    if (!newlyLocked.length && !unlocked.length) continue;
    assert.ok(loss !== 'mail', label + ': no line for the email loss');
    const toPair = Object.entries(mv.lossTable.pairOnly).some(([pair, ids]) => pair.split('+').includes(loss) && unlocked.some((s) => ids.includes(s)));
    assert.ok(!toPair, label + ': no line from one loss to two at once');
    if (newlyLocked.length) {
      one.push(fillText(T.lossOneNew, { lossIf: T['lossIf' + LOSS_WORDS[loss]], accounts: newlyLocked.map(full).join(T.sepList) }));
    }
    if (unlocked.length) {
      one.push(fillText(T.lossOneUnlocked, { lossEven: T['lossEven' + LOSS_WORDS[loss]], accounts: unlocked.map(full).join(T.sepList) }));
    }
  }
  lines.push(one.length ? fillText(T.sumLock, { lines: one.join(T.sepLines) }) : T.sumLockNone);
  const partner = { device: T.partnerPhone, number: T.partnerNumber, paper: T.partnerPaper };
  const pairName = (pair) => {
    const [a, b] = pair.split('+');
    assert.ok(partner[a] && partner[b], label + ': a pair of the phone, the number and the paper codes');
    return fillText(T.pairName, { a: partner[a], b: partner[b] });
  };
  const pairs = [];
  for (const s of person.services.map((x) => x.id)) {
    const nw = Object.keys(mv.pairLosses).filter((k) => mv.pairLosses[k].newlyLocked.includes(s));
    const un = Object.keys(mv.pairLosses).filter((k) => mv.pairLosses[k].unlocked.includes(s));
    assert.ok(nw.length <= 1 && un.length <= nw.length, label + ': one pair each, and no pair unlocked alone');
    if (nw.length && un.length) pairs.push(fillText(T.pairMoved, { account: full(s), before: pairName(un[0]), after: pairName(nw[0]) }));
    else if (nw.length) pairs.push(fillText(T.pairNew, { account: full(s), pairs: pairName(nw[0]) }));
  }
  if (pairs.length) lines.push(fillText(T.sumPair, { lines: pairs.join(T.sepLines) }));
  return lines;
}

test('F: lesson 8, every cell of the five rows (the entrance, removing it, replacing it), from the vectors and the sentence types', () => {
  assert.deepEqual(V.lesson8Rows.map((row) => [...row]), LESSON8.map(([id, removeId, replaceId]) => [id, removeId, replaceId]));
  // The rows are those of the spec: a removal; a replacement of the same entrance by paper codes or a document check that adds no
  // lockout for a single loss; and no replacement at all for the university email's help desk
  for (const [id, removeId, replaceId] of LESSON8) {
    const remove = known(id).moves.find((m) => m.id === removeId);
    assert.ok(remove && remove.kind === 'remove', removeId);
    const sameEntrance = (m) => m.kind === 'replace' && m.service === remove.service && m.method === remove.method;
    if (replaceId) {
      const replace = known(id).moves.find((m) => m.id === replaceId);
      assert.ok(replace && sameEntrance(replace) && /^paper:|^idcheck$/.test(replace.to), replaceId);
      assert.ok(Object.values(replace.losses).every((l) => !l.newlyLocked.length), replaceId + ': no single-loss lockout is added');
    } else {
      // No change replaces that entrance (so the table says there is nothing to replace it with)
      assert.ok(!known(id).moves.some(sameEntrance), removeId);
    }
  }
  // Every cell in both languages: the entrance from the data labels and the sentence types, the two other columns from the vectors
  for (const lang of ['ja', 'en']) {
    const T = M[lang], table = lessonTable('removeReplace', lang);
    assert.deepEqual(table.heads, [T.lesson8ColEntrance, T.lesson8ColRemove, T.lesson8ColReplace]);
    assert.equal(table.rows.length, LESSON8.length, lang);
    LESSON8.forEach(([id, removeId, replaceId, tagJa, tagEn], i) => {
      const remove = known(id).moves.find((m) => m.id === removeId), replace = known(id).moves.find((m) => m.id === replaceId);
      const service = samplePerson(id).services.find((s) => s.id === remove.service);
      const method = service.methods.find((m) => m.id === remove.method);
      const label = id + ' ' + removeId + ' ' + lang;
      assert.equal(table.rows[i][0], fillText(T.lesson8Entrance, { person: PERSON_NAMES[lang][id], account: service.label[lang],
        method: fillText(T[method.role === 'login' ? 'methodLogin' : 'methodRecovery'], { label: method.label[lang] }) }), label);
      assert.deepEqual(table.rows[i][1], { lines: summaryOf(id, remove, lang) }, label);
      assert.deepEqual(table.rows[i][2], replace ? { lines: [lang === 'ja' ? tagJa : tagEn, ...summaryOf(id, replace, lang)] }
        : T.lesson8NoReplace, label);
    });
  }
  // Written out once in Japanese (research 03 §4-5 and the vectors): every line of the removing and replacing columns
  assert.deepEqual(lessonTable('removeReplace', 'ja').rows.map((row) => [row[1].lines, typeof row[2] === 'string' ? row[2] : row[2].lines]), [
    [['攻撃：SIMスワップでネット証券を守れる', '閉め出し：スマホをなくすと、ネット証券に入れなくなる'],
      ['SMS→紙', '攻撃：SIMスワップでネット証券を守れる', '閉め出し：変わらない',
        '2つ同時：ネット証券：入れなくなる2つの組み合わせが「スマホと番号」から「スマホと紙」に移る']],
    [['攻撃：SIMスワップでメインのメールなど6つを守れる', '閉め出し：変わらない'],
      ['SMS→紙', '攻撃：SIMスワップでメインのメールなど6つを守れる', '閉め出し：変わらない']],
    [['攻撃：SIMスワップで銀行のネットバンキングを守れる', '閉め出し：変わらない'],
      ['SMS→書類', '攻撃：SIMスワップで銀行のネットバンキングを守れる', '閉め出し：番号を手放しても、銀行のネットバンキングに入れるようになる']],
    [['攻撃：漏えいとSIMスワップとメールの乗っ取りでネット証券を守れる', '閉め出し：スマホをなくすと、ネット証券（つみたて）に入れなくなる'],
      ['フリーメール→紙', '攻撃：漏えいとSIMスワップとメールの乗っ取りでネット証券を守れる', '閉め出し：変わらない',
        '2つ同時：ネット証券（つみたて）：スマホと紙を一緒になくすと入れなくなる']],
    [['攻撃：どのカードでも変わらない', '閉め出し：スマホをなくすと、大学のメール・動画のサブスク（学割）に入れなくなる'], '付け替える先はない'],
  ]);
  // Known lines in English: W3 removed, P3 replaced, and the two lines of two at once of the spec
  const en = lessonTable('removeReplace', 'en').rows;
  assert.deepEqual(en[0][1].lines, ['Attack (saved from SIM swap): Online brokerage',
    'Lockout: If you lose the phone, you can no longer get into: Online brokerage']);
  assert.equal(en[2][2].lines[2], 'Lockout: Even after giving up the number, you can now get into: Online banking');
  assert.equal(en[0][2].lines[3], 'Two at once: Online brokerage: the pair of losses that locks you out moves from the phone and the number '
    + 'to the phone and the paper codes');
  assert.equal(en[3][2].lines[3], 'Two at once: Online brokerage (monthly investing): losing the phone and the paper codes together now '
    + 'locks you out');
});

test('F: lesson 9, the cycle of the paper (complement of reach versus the least fixed point of definition 18, from the vectors)', () => {
  const cycle = vectors.paper.cycle;
  assert.deepEqual([cycle.lostA.complementLocked, cycle.lostA.def18Locked, cycle.lostBoth.complementLocked, cycle.lostBoth.def18Locked],
    [[], [], ['mailA', 'mailB'], []]);
  for (const lang of ['ja', 'en']) {
    const T = M[lang], table = lessonTable('cycle', lang);
    assert.equal(table.grid, true);
    const name = { mailA: T.lesson9MailA, mailB: T.lesson9MailB };
    const list = (ids) => (ids.length ? ids.map((x) => name[x]).join(T.sepList) : T.lessonNone);
    assert.deepEqual(table.rows, [[T.lesson9PwA, list(cycle.lostA.complementLocked), list(cycle.lostA.def18Locked)],
      [[T.lesson9PwA, T.lesson9PwB].join(T.sepList), list(cycle.lostBoth.complementLocked), list(cycle.lostBoth.def18Locked)]], lang);
  }
  assert.deepEqual(lessonTable('cycle', 'ja').rows[1], ['パスワードa・パスワードb', 'メールA・メールB', 'なし']);
});

test('F: lesson 10 and the sources: the related tools and their pages, the sources of lessons 1 to 9, DOI links', () => {
  // The related tools of the spec (lesson 10) with the links of the spec
  const TOOLS = [['Day083 Intrusion Path Mapper', 'https://ipusiron.github.io/intrusion-path-mapper/'],
    ['Day001 Password Checker', 'https://ipusiron.github.io/password-checker/'],
    ['Day019 PassCloud', 'https://ipusiron.github.io/passcloud/'],
    ['Day060 Reverse Brute-force Demo', 'https://ipusiron.github.io/reverse-bruteforce-demo/'],
    ['Day064 PatternLock Security Trainer', 'https://ipusiron.github.io/patternlock-security-trainer/'],
    ['Day088 PIN Threat Simulator', 'https://ipusiron.github.io/pin-threat-simulator/'],
    ['Day124 Scatter Seeds', 'https://ipusiron.github.io/scatter-seeds/'],
    ['Day125 Overlay QR Shares', 'https://ipusiron.github.io/overlay-qr-shares/']];
  for (const lang of ['ja', 'en']) {
    const table = lessonTable('tools', lang);
    assert.deepEqual(table.rows.map((row) => [row[0].text, row[0].href]), TOOLS, lang);
    for (const row of table.rows) assert.ok(typeof row[1] === 'string' && row[1].trim(), lang);
  }
  // Ten lessons; lessons 1 to 9 name their sources, lesson 10 links the tools; every source has a bibliography entry in both languages
  assert.deepEqual(V.lessons.map((l) => l.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const lesson of V.lessons) {
    assert.ok(lesson.blocks.some(([kind]) => kind === 'table'), 'lesson ' + lesson.n + ' has a table');
    if (lesson.n < 10) assert.ok(lesson.refs.length >= 2, 'lesson ' + lesson.n + ' has sources');
    for (const ref of lesson.refs) for (const lang of ['ja', 'en']) assert.ok(M[lang]['lessonRef' + ref], ref);
  }
  // Every source key is used and has its bibliography; every link is HTTPS; a paper with a DOI in the spec links to https://doi.org/<DOI>
  const keys = Object.keys(V.lessonRefs).sort();
  assert.deepEqual([...new Set(V.lessons.flatMap((l) => l.refs))].sort(), keys);
  assert.deepEqual(Object.keys(M.ja).filter((k) => k.startsWith('lessonRef')).sort(), keys.map((k) => 'lessonRef' + k).sort());
  for (const href of [...Object.values(V.lessonRefs), ...TOOLS.map(([, href]) => href)]) assert.match(href, /^https:\/\/[^\s"'<>]+$/);
  const DOIS = { Hammann2019: '10.1145/3319535.3354193', Dowling1984: '10.1016/0743-1066(84)90014-1', Das2014: '10.14722/ndss.2014.23357',
    Li2018: '10.1109/INFOCOM.2018.8486017', Klivan2023: '10.1145/3576915.3623180', Nist: '10.6028/NIST.SP.800-63B-4',
    Chi2022: '10.1145/3491102.3502125', Buttner2024: '10.5220/0012319000003648' };
  for (const [ref, doi] of Object.entries(DOIS)) assert.equal(V.lessonRefs[ref], 'https://doi.org/' + doi, ref);
  assert.equal(Object.values(V.lessonRefs).filter((href) => href.startsWith('https://doi.org/')).length, Object.keys(DOIS).length);
});

// The blocks of the ten lessons in the order of the screen (kind:key): the paragraphs (p), the tables, the legend of the short card
// names under the backdoor table, the notes on the brokerage (noteBrokerage, noteBrokerageStudent) and the paragraph with the
// links to Day124 and Day125. The spec's lessons table gives what each lesson holds (lesson 1 the flow and the AND / OR tables,
// lesson 9 one sentence above its table and one below it); the paragraph keys are those of the screen text.
const LESSON_BLOCKS = {
  1: ['p:lesson1Text1', 'p:lesson1Text2', 'p:lesson1Text3', 'table:flow', 'p:lesson1Text4', 'table:andOr'],
  2: ['p:lesson2Text1', 'p:lesson2Text2', 'p:lesson2Text3', 'p:lesson2Text4', 'table:families'],
  3: ['p:lesson3Text1', 'p:lesson3Text2', 'p:lesson3Text3', 'p:lesson3Text4', 'table:backdoors', 'legend:fourCardsLegend'],
  4: ['p:lesson4Text1', 'p:lesson4Text2', 'p:lesson4Text3', 'p:lesson4Text4', 'table:simswap'],
  5: ['p:lesson5Text1', 'p:lesson5Text2', 'p:lesson5Text3', 'table:desk'],
  6: ['p:lesson6Text1', 'p:lesson6Text2', 'p:lesson6Text3', 'table:brokerage', 'note:noteBrokerage', 'note:noteBrokerageStudent'],
  7: ['p:lesson7Text1', 'p:lesson7Text2', 'p:lesson7Text3', 'p:lesson7Text4', 'table:lockout'],
  8: ['p:lesson8Text1', 'table:removeReplace', 'p:lesson8Text2', 'links:lesson8Text3'],
  9: ['p:lesson9Text1', 'p:lesson9Text2', 'table:cycle', 'p:lesson9Text3', 'p:lesson9Text4'],
  10: ['p:lesson10Text1', 'p:lesson10Text2', 'table:tools'],
};
// The sources of each lesson, in the order in which the spec's lessons table names them (lesson 10 links the related tools)
const LESSON_SOURCES = {
  1: ['Hammann2019', 'Dowling1984'],
  2: ['Das2014', 'Jpcert', 'SoumuSite', 'JapanPost', 'Nist'],
  3: ['Li2018', 'Klivan2023', 'Honan2012', 'Hammann2019'],
  4: ['Lee2020', 'Nist', 'NaraPolice', 'SoumuMobile'],
  5: ['Ncsc2025', 'Nist'],
  6: ['Jsda2025', 'FsaGuidelines', 'FsaDialogue', 'Nist', 'Unit42'],
  7: ['Hammann2019', 'Chi2022', 'Buttner2024'],
  8: ['Nist', 'Chi2022'],
  9: ['Hammann2019', 'Chi2022'],
  10: [],
};

test('F: the lessons show their paragraphs, tables and notes in the order of the screen, and the sources that the spec names', () => {
  assert.deepEqual(Object.fromEntries(V.lessons.map((l) => [l.n, l.blocks.map(([kind, key]) => kind + ':' + key)])), LESSON_BLOCKS);
  assert.deepEqual(Object.fromEntries(V.lessons.map((l) => [l.n, [...l.refs]])), LESSON_SOURCES);
  // Every lesson text of the dictionary is shown once (none is left out of its lesson), and every block names a table that is
  // built or a sentence of both languages
  const texts = Object.keys(M.ja).filter((k) => /^lesson\d+Text\d+$/.test(k)).sort();
  const shown = V.lessons.flatMap((l) => l.blocks.filter(([kind]) => kind === 'p' || kind === 'links').map(([, key]) => key)).sort();
  assert.deepEqual(shown, texts);
  for (const lesson of V.lessons) {
    for (const [kind, key] of lesson.blocks) {
      if (kind === 'table') assert.ok(lessonTable(key, 'ja').rows.length && lessonTable(key, 'en').rows.length, key);
      else assert.ok(typeof M.ja[key] === 'string' && typeof M.en[key] === 'string', key);
    }
  }
});

test('F: the line under the lockout table names the entrances of the account chosen, written as the map table writes them', () => {
  // Known: the parent's bank leans on the phone number at both entrances (log-in Yellow A + SMS, recovery SMS), and the
  // messaging app on the phone (log-in) and on the SMS with Yellow A (recovery). In English the account's name heads the line.
  assert.equal(V.lockEntrances(persona('parent'), 'bank', M, 'ja'), '銀行のネットバンキングの入口：ログイン：黄A＋SMS／復旧：SMS');
  assert.equal(V.lockEntrances(persona('parent'), 'bank', M, 'en'), 'Online banking: Log-in: Yellow A + SMS / Recovery: SMS');
  assert.equal(V.lockEntrances(persona('parent'), 'msg', M, 'ja'), 'メッセージアプリ（家族との連絡）の入口：ログイン：スマホ／復旧：SMS＋黄A');
  assert.equal(V.lockEntrances(persona('parent'), 'msg', M, 'en'), 'Messaging app (family chats): Log-in: Phone / Recovery: SMS + Yellow A');
  for (const id of PEOPLE) {
    const person = samplePerson(id);
    for (const lang of ['ja', 'en']) {
      for (const s of person.services) {
        assert.equal(V.lockEntrances(persona(id), s.id, M, lang), fillText(M[lang].lockEntrances,
          { account: s.label[lang], entrances: s.methods.map((m) => entranceOf(m, person, lang)).join(M[lang].sepLines) }), id + ' ' + s.id);
      }
    }
  }
});

test('F: the note on removals goes under the same-entrance table when the table has a removal other than the change chosen', () => {
  // A removal row may read "–" for lockout although the way back after a forgotten password goes; the change chosen, when it
  // is the removal, has the note above the table instead (moveNotes)
  const counts = {};
  for (const id of PEOPLE) {
    counts[id] = 0;
    for (const mv of known(id).moves) {
      for (const lang of ['ja', 'en']) {
        const same = V.sameRows(persona(id), pv(id), mv.id, M, lang);
        const removal = same.rows.some((r) => r.id.startsWith('remove:'));
        const expected = removal && !mv.id.startsWith('remove:') ? M[lang].noteRemove : null;
        assert.equal(same.removeNote, expected, id + ' ' + mv.id + ' ' + lang);
        if (lang === 'ja' && expected) counts[id] += 1;
      }
    }
  }
  assert.deepEqual(counts, { worker: 19, parent: 8, student: 8 });
  // P3 and W2 replace a condition of an entrance that can also be removed; W3 is the removal itself
  assert.equal(V.sameRows(persona('parent'), pv('parent'), 'replace:bank.recSms:phone>idcheck', M, 'ja').removeNote, M.ja.noteRemove);
  assert.equal(V.sameRows(persona('worker'), pv('worker'), 'replace:mailMain.recMail:mailOld>paper:mailMain', M, 'en').removeNote,
    M.en.noteRemove);
  assert.equal(V.sameRows(persona('worker'), pv('worker'), 'remove:sec.recMailSms', M, 'ja').removeNote, null);
});
