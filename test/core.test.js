'use strict';
// A-E: the calculation in domino-core.js against the known vectors (test/vectors.json) and known examples.
// Note: PAPER, paperVectors() and vectors.paper are the examples from Hammann et al. (CCS 2019). They are unrelated
// to paper recovery codes (credentials "paper:<account>" and the loss card "paper").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('../domino-core.js');
const D = require('../domino-data.js');

const sampleRaw = fs.readFileSync(path.join(__dirname, 'sample.json'));
const vectorsRaw = fs.readFileSync(path.join(__dirname, 'vectors.json'));
const sample = JSON.parse(sampleRaw.toString('utf8'));
const vectors = JSON.parse(vectorsRaw.toString('utf8'));
const VECTORS_SHA256 = 'ec98f2a1da86dfa5c654ef3ee8e5187aa62e04af20dbd650deee77740d56f379';
const PEOPLE = ['worker', 'parent', 'student'];
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const personOf = (id) => sample.personas.find((p) => p.id === id);
const cache = new Map();
const pv = (id) => {
  if (!cache.has(id)) cache.set(id, C.personaVectors(personOf(id)));
  return cache.get(id);
};
const moveOf = (id, moveId) => pv(id).moves.find((m) => m.id === moveId);

test('A: copied data keeps its bytes, and the embedded data equals test/sample.json', () => {
  assert.equal(sha256(sampleRaw), vectors.sampleSha256);
  assert.equal(sha256(vectorsRaw), VECTORS_SHA256);
  assert.equal(vectors.schema, 'account-domino-mapper/vectors@1');
  assert.equal(D.schema, sample.schema);
  assert.deepEqual(D.personas, sample.personas);
});

test('A: personaVectors equals the known vectors for the three people (every key)', () => {
  assert.deepEqual(Object.keys(vectors.personas), PEOPLE);
  for (const id of PEOPLE) assert.deepEqual(pv(id), vectors.personas[id], id);
});

test('A: paper examples, the 150 random graphs and the whole vector file', () => {
  assert.deepEqual(C.paperVectors(), vectors.paper);
  const rng = C.xorshift32(1029);
  const random = Array.from({ length: 150 }, () => C.randomVector(C.randomSpec(rng)));
  assert.equal(vectors.random.length, 150);
  assert.deepEqual(random, vectors.random);
  const built = C.buildVectors(sample, vectors.sampleSha256);
  assert.deepEqual(built, vectors);
  const leaves = C.compareLeaves(built, vectors);
  assert.equal(leaves.leaves, 15966);
  assert.deepEqual(leaves.mismatches, []);
});

test('A: selfTest(300) passes (counting = stepped reach, BFS is a superset, monotone, definition 18 within the complement)', () => {
  const st = C.selfTest(300);
  assert.equal(st.graphs, 300);
  assert.equal(st.def18MissAcyclic, 0);
});

test('A: the number of changes per person and kind', () => {
  const kinds = (id) => pv(id).moves.reduce((k, m) => ({ ...k, [m.kind]: k[m.kind] + 1 }), { add: 0, replace: 0, remove: 0 });
  assert.deepEqual(kinds('worker'), { add: 5, replace: 26, remove: 10 });
  assert.deepEqual(kinds('parent'), { add: 3, replace: 14, remove: 7 });
  assert.deepEqual(kinds('student'), { add: 4, replace: 13, remove: 7 });
  assert.deepEqual(PEOPLE.map((id) => pv(id).services.length), [9, 7, 7]);
});

test('A: invalid data gives the same results as the reference implementation', () => {
  const worker = () => clone(personOf('worker'));
  const service = (p, id) => p.services.find((s) => s.id === id);
  const label = { ja: 'x', en: 'x' };
  let p = worker();
  p.credentials.push({ id: 'pw:red', type: 'pw', family: 'red', symbol: 'A', label });
  assert.throws(() => C.validatePersona(p), { message: 'duplicate node id' });
  p = worker();
  service(p, 'mailMain').methods[0].requires = ['pw:nope'];
  assert.throws(() => C.validatePersona(p), { message: 'unknown atom pw:nope in mailMain.login' });
  p = worker();
  service(p, 'mailMain').methods[0].requires = [];
  assert.throws(() => C.validatePersona(p), { message: 'empty body mailMain.login' });
  p = worker();
  service(p, 'points').methods[1].requires = ['points'];
  assert.deepEqual(C.validatePersona(p), ['self requirement points']);
  p = worker();
  service(p, 'sns').methods[1].requires = ['points'];
  assert.deepEqual(C.validatePersona(p), ['requirement must be a credential or an email account: points']);
  p = worker();
  p.cards[0].gives = ['phone'];
  assert.deepEqual(C.validatePersona(p), ['card needs exactly one of leaks/gives: leak']);
  p = worker();
  delete p.cards[0].leaks;
  assert.deepEqual(C.validatePersona(p), ['card needs exactly one of leaks/gives: leak']);
  p = worker();
  service(p, 'mailMain').methods = [{ id: 'login', role: 'login', requires: ['mailOld'], label }];
  service(p, 'mailOld').methods = [{ id: 'login', role: 'login', requires: ['mailMain'], label }];
  assert.deepEqual(C.validatePersona(p), ['owner cannot reach mailMain', 'owner cannot reach mailOld']);
  for (const id of PEOPLE) assert.deepEqual(C.validatePersona(personOf(id)), [], id);
});

test('A: graphFrom rejects an empty body, an unknown node, an unknown head and a duplicate id', () => {
  const nodes = [{ id: 'a' }, { id: 'b' }];
  assert.throws(() => C.graphFrom({ nodes, clauses: [{ head: 'b', method: 'b.m', body: [] }] }), { message: 'empty body b.m' });
  assert.throws(() => C.graphFrom({ nodes, clauses: [{ head: 'b', method: 'b.m', body: ['z'] }] }), { message: 'unknown atom z in b.m' });
  assert.throws(() => C.graphFrom({ nodes, clauses: [{ head: 'z', method: 'z.m', body: ['a'] }] }), { message: 'unknown head z' });
  assert.throws(() => C.graphFrom({ nodes: [{ id: 'a' }, { id: 'a' }], clauses: [] }), { message: 'duplicate node id' });
});

test('B: a breadth-first search that treats every line as OR is wrong where AND matters', () => {
  const worker = personOf('worker');
  const g = C.personaGraph(worker);
  const gives = C.cardGives(worker, worker.cards.find((c) => c.id === 'simswap'));
  assert.equal(C.reach(g, gives).has('bank'), false);
  assert.equal(C.naiveBfs(g, gives).has('bank'), true);
  assert.deepEqual(pv('worker').cards.simswap.naiveExtra, ['bank']);
  assert.deepEqual(pv('parent').cards.leak.naiveExtra, ['bank', 'msg', 'sec']);
  for (const card of ['leak', 'simswap', 'mail', 'desk']) assert.deepEqual(pv('student').cards[card].naiveExtra, [], card);
});

test('C: the paper cycle example (complement versus definition 18)', () => {
  const cycle = C.paperVectors().cycle;
  assert.equal(cycle.acyclic, false);
  assert.deepEqual(cycle.lostBoth, { complementLocked: ['mailA', 'mailB'], def18Locked: [] });
  assert.deepEqual(cycle.lostA, { complementLocked: [], def18Locked: [] });
  assert.deepEqual(cycle.lockoutBase.mailA, [['pwA', 'pwB']]);
  assert.deepEqual(cycle.lockoutBaseDef18.mailA, []);
});

// Two email accounts that are each other's backup, in the shape of a person.
const CYCLE = {
  id: 'cycle',
  label: { ja: '輪', en: 'Cycle' },
  story: { ja: '輪', en: 'Cycle' },
  credentials: [
    { id: 'pwA', type: 'pw', family: 'red', symbol: 'A', label: { ja: 'パスワード 赤A', en: 'Password Red A' } },
    { id: 'pwB', type: 'pw', family: 'blue', symbol: 'B', label: { ja: 'パスワード 青B', en: 'Password Blue B' } },
  ],
  services: [
    {
      id: 'mailA', mail: true, offers: [], label: { ja: 'メールA', en: 'Mail A' },
      methods: [
        { id: 'login', role: 'login', requires: ['pwA'], label: { ja: 'パスワード', en: 'Password' } },
        { id: 'rec', role: 'recovery', requires: ['mailB'], label: { ja: '予備のメール', en: 'Backup email' } },
      ],
    },
    {
      id: 'mailB', mail: true, offers: [], label: { ja: 'メールB', en: 'Mail B' },
      methods: [
        { id: 'login', role: 'login', requires: ['pwB'], label: { ja: 'パスワード', en: 'Password' } },
        { id: 'rec', role: 'recovery', requires: ['mailA'], label: { ja: '予備のメール', en: 'Backup email' } },
      ],
    },
  ],
  cards: [],
  losses: [
    { id: 'a', lost: ['pwA'], label: { ja: 'Aをなくした', en: 'Lost A' } },
    { id: 'b', lost: ['pwB'], label: { ja: 'Bをなくした', en: 'Lost B' } },
  ],
};

test('C: the functions used by the screen count the lockout on a person-shaped cycle', () => {
  const g = C.personaGraph(CYCLE);
  assert.deepEqual(C.validatePersona(CYCLE), []);
  assert.equal(C.isAcyclic(g), false);
  assert.deepEqual(C.lossOutcome(CYCLE, g, ['a', 'b']).locked, ['mailA', 'mailB']);
  assert.deepEqual(C.lossOutcome(CYCLE, g, ['a', 'b']).locked, vectors.paper.cycle.lostBoth.complementLocked);
  assert.deepEqual(C.lossOutcome(CYCLE, g, ['a']).locked, []);
  assert.deepEqual(C.lossOutcome(CYCLE, g, ['a']).locked, vectors.paper.cycle.lostA.complementLocked);
  const table = C.lossTable(CYCLE);
  assert.deepEqual(table.columns, ['a', 'b']);
  assert.deepEqual(table.cells, {
    a: { mailA: { mark: 'ok', plus: ['b'] }, mailB: { mark: 'ok', plus: ['b'] } },
    b: { mailA: { mark: 'ok', plus: ['a'] }, mailB: { mark: 'ok', plus: ['a'] } },
  });
  assert.deepEqual(table.pairOnly, { 'a+b': ['mailA', 'mailB'] });
  // Definition 18 taken as a least fixed point misses this lockout.
  const def18 = C.lockoutDef18(g, ['pwA', 'pwB']);
  assert.deepEqual(['mailA', 'mailB'].filter((s) => def18.has(s)), []);
});

test('D: a breach gives the family that the breached service uses to log in now', () => {
  const cases = [
    ['worker', 'replace:points.login:pw:red>pw:own-points', ['mailMain', 'shop', 'sns', 'flea', 'cloud'], 'points', 6],
    ['parent', 'replace:points.login:pw:yellow>pw:own-points', ['mailIsp', 'shop', 'photo'], 'points', 4],
    ['student', 'replace:game.login:pw:green>pw:own-game', ['mailFree', 'sns', 'flea', 'sec'], 'game', 5],
  ];
  for (const [id, moveId, saved, service, wrongCount] of cases) {
    const p = personOf(id);
    const leak = p.cards.find((c) => c.id === 'leak');
    assert.deepEqual(moveOf(id, moveId).cards.leak.saved, saved, id);
    const q = C.applyMove(p, C.enumerateMoves(p).find((m) => m.id === moveId));
    const gq = C.personaGraph(q);
    const fallen = (gives) => q.services.map((s) => s.id).filter((s) => C.reach(gq, gives).has(s));
    assert.deepEqual(C.cardGives(q, leak), ['pw:own-' + service], id);
    assert.deepEqual(fallen(C.cardGives(q, leak)), [service], id);
    // Passing the person before the change would show the old family falling on the after-change map.
    assert.equal(fallen(C.cardGives(p, leak)).length, wrongCount, id);
    // A copy that fixes the family in "gives" would save nothing.
    const fixed = clone(p);
    const fixedLeak = fixed.cards.find((c) => c.id === 'leak');
    fixedLeak.gives = C.cardGives(p, leak);
    delete fixedLeak.leaks;
    assert.deepEqual(C.evaluateMoves(fixed).find((m) => m.id === moveId).cards.leak.saved, [], id);
    // Only this change makes the two choices of person differ on the after-change map.
    const differ = C.enumerateMoves(p).filter((mv) => {
      const after = C.applyMove(p, mv);
      return JSON.stringify(C.cardGives(after, leak)) !== JSON.stringify(C.cardGives(p, leak));
    }).map((mv) => mv.id);
    assert.deepEqual(differ, [moveId], id);
  }
});

test('E: two-at-once lockouts (usual, after a change, one to two at once, and counts)', () => {
  const emptyExcept = (pairOnly, kept) => {
    for (const [key, value] of Object.entries(pairOnly)) if (!kept.includes(key)) assert.deepEqual(value, [], key);
  };
  assert.deepEqual(pv('worker').lossTable.pairOnly['device+number'], ['bank', 'sec']);
  emptyExcept(pv('worker').lossTable.pairOnly, ['device+number']);
  assert.deepEqual(pv('parent').lossTable.pairOnly['device+number'], ['msg', 'sec']);
  assert.deepEqual(pv('parent').lossTable.pairOnly['device+mail'], ['sec']);
  emptyExcept(pv('parent').lossTable.pairOnly, ['device+number', 'device+mail']);
  emptyExcept(pv('student').lossTable.pairOnly, []);

  const student = moveOf('student', 'replace:sec.recMail:mailFree>paper:sec').pairLosses;
  assert.deepEqual(student['device+paper'], { newlyLocked: ['sec'], unlocked: [] });
  const worker = moveOf('worker', 'replace:sec.recMailSms:phone>paper:sec').pairLosses;
  assert.deepEqual(worker['device+number'], { newlyLocked: [], unlocked: ['sec'] });
  assert.deepEqual(worker['device+paper'], { newlyLocked: ['sec'], unlocked: [] });

  const oneToTwo = moveOf('parent', 'replace:bank.login:phone>device');
  assert.deepEqual(oneToTwo.losses.number.unlocked, ['bank']);
  assert.ok(oneToTwo.lossTable.pairOnly['device+number'].includes('bank'));
  for (const pair of Object.values(oneToTwo.pairLosses)) {
    assert.ok(!pair.newlyLocked.includes('bank') && !pair.unlocked.includes('bank'), 'one to two is not in pairLosses');
  }

  const newPair = { add: 0, replace: 0, remove: 0 };
  const single = { add: 0, replace: 0, remove: 0 };
  let unlockedPair = 0, both = 0;
  for (const id of PEOPLE) {
    for (const m of pv(id).moves) {
      const nw = Object.values(m.pairLosses).some((x) => x.newlyLocked.length > 0);
      const un = Object.values(m.pairLosses).some((x) => x.unlocked.length > 0);
      if (nw) newPair[m.kind]++;
      if (un) unlockedPair++;
      if (nw && un) both++;
      if (Object.values(m.losses).some((x) => x.newlyLocked.length > 0)) single[m.kind]++;
    }
  }
  assert.deepEqual(newPair, { add: 3, replace: 15, remove: 0 });
  assert.equal(unlockedPair, 7);
  assert.equal(both, 4);
  assert.deepEqual(single, { add: 0, replace: 0, remove: 10 });
});
