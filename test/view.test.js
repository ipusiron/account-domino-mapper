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

test('F: the diagram layout (columns, lines from left to right, no line under a card it passes, the viewBox width)', () => {
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
  let afterLines = 0, layouts = 0;
  const inspect = (L, lines, id, label) => {
    for (const line of lines) {
      const [from, to] = line.columns;
      assert.ok(from < to, label + ': ' + line.from + ' -> ' + line.to);
      assert.equal(from, L.colOf[line.from], label);
      assert.equal(to, L.colOf[line.to.split('.')[0]], label);
      const rects = [];
      for (let k = from + 1; k < to; k++) for (const box of L.columns[k]) rects.push(L.box[box]);
      let previous = null;
      for (const [x, y] of line.points) {
        if (previous) assert.ok(Math.hypot(x - previous[0], y - previous[1]) <= 1 + 1e-9, label + ': points at most 1px apart');
        previous = [x, y];
        for (const r of rects) {
          assert.ok(!(x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h), label + ': ' + line.from + ' -> ' + line.to + ' under a card');
        }
      }
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
  // The diagrams before and after every change keep the columns of the usual diagram; their lanes are never wider apart
  // than 4px, and always more than 2.5px apart.
  let narrowest = Infinity;
  for (const lang of ['ja', 'en']) {
    const p = persona('parent');
    const usual = V.layout(p, null, M, lang);
    for (const move of C.enumerateMoves(p)) {
      const L = V.layout(p, C.applyMove(p, move), M, lang);
      assert.equal(L.width, usual.width, move.id);
      for (const lines of [L.lines, L.linesBefore]) {
        for (const s of laneSpacing(L, lines)) if (s !== null) narrowest = Math.min(narrowest, s);
      }
    }
  }
  assert.ok(narrowest > 2.5 && narrowest <= 4 + 1e-9, 'narrowest lane spacing ' + narrowest);
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
  // The states of the highlights point at moves and accounts that exist, and the focus targets are the ones in the spec.
  for (const h of V.highlights) {
    if (h.state.move) assert.ok(pv(h.person).moves.some((m) => m.id === h.state.move), h.id);
    if (h.state.account) assert.ok(persona(h.person).services.some((s) => s.id === h.state.account), h.id);
  }
  assert.deepEqual(Object.fromEntries(V.highlights.map((h) => [h.id, h.target])), {
    W1: 'step:next', W2: 'compare-heading', W3: 'compare-heading', P1: 'detail-heading', P2: 'lock-acct:bank',
    P3: 'compare-heading', S1: 'step:next', S2: 'detail-heading', S3: 'lock-acct:sub' });
});
