'use strict';
// F: the view helpers in domino-view.js (no DOM) against the known vectors (test/vectors.json).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../domino-core.js');
const D = require('../domino-data.js');
const V = require('../domino-view.js');

const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors.json'), 'utf8'));
const PEOPLE = ['worker', 'parent', 'student'];
const CARDS = ['leak', 'simswap', 'mail', 'desk'];
const pv = (id) => C.personaVectors(D.personas.find((p) => p.id === id));

test('F: lastStep is the step at which the last account falls to the card (0 when no account falls)', () => {
  for (const id of PEOPLE) {
    const computed = pv(id);
    for (const card of CARDS) {
      const known = vectors.personas[id].cards[card];
      const expected = known.services.reduce((max, service) => Math.max(max, known.rank[service]), 0);
      assert.equal(V.lastStep(computed, card), expected, id + ' ' + card);
    }
  }
  // The steps given with the highlights W1, P1, S1 and S2, and the student's help-desk card where nothing falls.
  const stated = [['worker', 'leak', 2], ['parent', 'simswap', 1], ['student', 'leak', 2], ['student', 'mail', 2], ['student', 'desk', 0]];
  for (const [id, card, step] of stated) assert.equal(V.lastStep(pv(id), card), step, id + ' ' + card);
});
