'use strict';
// I: README.md and README.en.md against the spec of this tool: the front matter, the fixed opening, the headings of both languages,
// the numbers of the use cases particular to this tool (computed again with the calculation), the screenshots, the directory tree
// and the fixed sentences.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const C = require('../domino-core.js');
const D = require('../domino-data.js');
const V = require('../domino-view.js');
const M = require('../messages.js');
const root = path.join(__dirname, '..');
const SLUG = 'account-domino-mapper';
const FILES = { ja: 'README.md', en: 'README.en.md' };
const LANGS = ['ja', 'en'];
const JA_CLASS = '[\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff]', JA_CHAR = new RegExp(JA_CLASS);
const cache = {};
const doc = (lang) => (cache[lang] ??= fs.readFileSync(path.join(root, FILES[lang]), 'utf8').replace(/\r\n?/g, '\n'));

// The lines of a README with fenced code blocks and HTML comments blanked out (line numbers stay the same)
function prose(lang) {
  const out = [];
  let fence = null;
  const text = doc(lang).replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ''));
  for (const line of text.split('\n')) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
      out.push('');
    } else if (marker) {
      fence = marker[1];
      out.push('');
    } else out.push(line);
  }
  return out;
}
const headings = (lang) => prose(lang).flatMap((line, i) => {
  const m = line.match(/^(#{1,6}) +(.+?)\s*$/);
  return m ? [{ level: m[1].length, title: m[2], line: i }] : [];
});
// The H2 sections: the title, and the lines of the body (from the line after the heading to the next H2)
function sections(lang) {
  const h2 = headings(lang).filter((h) => h.level === 2), total = prose(lang).length;
  return h2.map((h, k) => ({ title: h.title, from: h.line + 1, to: k + 1 < h2.length ? h2[k + 1].line : total }));
}
function section(lang, title) {
  const found = sections(lang).filter((s) => s.title === title);
  assert.equal(found.length, 1, `${FILES[lang]}: one section "${title}"`);
  return found[0];
}
const bodyOf = (lang, s) => prose(lang).slice(s.from, s.to);
const firstH2 = (lang) => prose(lang).findIndex((line) => /^## /.test(line));
// Text as it reads: links and images keep their text, HTML tags, emphasis and code marks go, and the lines are joined
// (without a space in Japanese, with one in English)
function plain(lines, lang) {
  return lines.map((line) => line.trim()).filter(Boolean).join(lang === 'ja' ? '' : ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<[^>]+>/g, '').replace(/\*\*|`/g, '').replace(/ {2,}/g, ' ');
}

// The H2 sections of the spec, in order: Japanese, English
const H2 = [['🌐 デモページ', '🌐 Demo'], ['📸 スクリーンショット', '📸 Screenshots'], ['✨ 機能', '✨ Features'],
  ['📖 使い方', '📖 How to use'], ['📐 画面構成', '📐 Screen layout'], ['🔬 技術的な説明', '🔬 Technical notes'],
  ['🎯 ユースケース', '🎯 Use cases'], ['🔒 セキュリティ', '🔒 Security'], ['⚠️ 注意と限界', '⚠️ Notes and limits'],
  ['🔗 参考', '🔗 References'], ['🧪 テスト', '🧪 Tests'], ['📁 ディレクトリー構造', '📁 Directory structure'],
  ['💻 動作環境', '💻 Requirements'], ['📄 ライセンス', '📄 License'], ['🛠️ このツールについて', '🛠️ About this tool']];
const h2Title = (lang, icon) => H2.find((pair) => pair[0].startsWith(icon))[lang === 'ja' ? 0 : 1];

// The front matter of the spec (README.md only), with the keys in this order
const DESCRIPTION_JA = '架空の3人のアカウントを、ログインと復旧の入口（かつ・または）の地図で表し、漏えい・SIMスワップ・メールの乗っ取り・'
  + '窓口のなりすましの4枚のカードで、倒れていく順を段ごとに再生する教材。スマホ・電話番号・メールを失ったときの閉め出しと、入口を1つ変える1手'
  + '（スマホを足す・条件を付け替える・復旧の入口を外す）の前後を並べて比べる。本物の構成は入れず、外部へは何も送らない。日英対応。';
const DESCRIPTION_EN = 'A teaching aid that maps three fictional people\'s accounts by their log-in and recovery entrances (AND/OR) and replays, '
  + 'step by step, how a breach, a SIM swap, an email takeover or a help-desk impersonation topples them. It shows which accounts the '
  + 'owner is locked out of after losing the phone, the number or an email account, and compares before and after one change to a '
  + 'single entrance: adding the phone, replacing one requirement, or removing a recovery entrance. No real account details; nothing '
  + 'is sent anywhere. Japanese and English UI.';
const META = {
  id: 'day127', slug: SLUG, title: 'Account Domino Mapper',
  subtitle_ja: 'アカウントの連鎖と閉め出しを比べる教材', subtitle_en: 'Account takeover chains and lockouts, side by side',
  description_ja: DESCRIPTION_JA, description_en: DESCRIPTION_EN,
  category_ja: ['認証', 'セキュリティマネジメント'], category_en: ['Authentication', 'Security Management'],
  difficulty: '2',
  tags: ['account-recovery', 'account-takeover', 'password-reuse', 'sim-swap', 'multi-factor-authentication', 'lockout', 'education',
    'visualization'],
  repo_url: 'https://github.com/ipusiron/' + SLUG, demo_url: 'https://ipusiron.github.io/' + SLUG + '/', hub: 'true',
};
// Free text is double-quoted (the English description has ": " in it); the number and the boolean are bare
const QUOTED = ['title', 'subtitle_ja', 'subtitle_en', 'description_ja', 'description_en'];
const BARE = ['difficulty', 'hub'];

function frontMatter() {
  const match = doc('ja').match(/^<!--[ \t]*\n---[ \t]*\n([\s\S]*?)\n---[ \t]*\n!?-->[ \t]*(?:\n|$)/);
  assert.ok(match, 'README.md starts with the front matter (between --- lines) inside an HTML comment');
  const keys = [], values = {}, quotes = {};
  const lines = match[1].split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const entry = lines[i].match(/^([a-z_]+):(?: +(.*?))?\s*$/);
    assert.ok(entry, 'front matter line: ' + lines[i]);
    const [, key, scalar] = entry;
    assert.ok(!keys.includes(key), 'no duplicate key: ' + key);
    keys.push(key);
    if (scalar) {
      assert.doesNotMatch(scalar, /^[[{]/, key + ': block style, not flow style');
      const quoted = scalar.match(/^(["'])(.*)\1$/);
      values[key] = quoted ? quoted[2] : scalar;
      quotes[key] = quoted ? quoted[1] : '';
    } else {
      values[key] = [];
      while (i + 1 < lines.length && /^ {2}- \S/.test(lines[i + 1])) {
        const item = lines[++i].slice(4).trim(), quoted = item.match(/^(["'])(.*)\1$/);
        values[key].push(quoted ? quoted[2] : item);
      }
      assert.ok(values[key].length > 0, key + ': a block list (lines "  - value")');
    }
  }
  return { keys, values, quotes };
}

test('I: README.md front matter: block style, the keys in order and the values of the spec; none in README.en.md', () => {
  const { keys, values, quotes } = frontMatter();
  assert.deepEqual(keys, Object.keys(META), 'the keys and their order');
  for (const [key, value] of Object.entries(META)) assert.deepEqual(values[key], value, key);
  for (const key of QUOTED) assert.equal(quotes[key], '"', key + ' is double-quoted');
  for (const key of BARE) assert.equal(quotes[key], '', key + ' is not quoted');
  assert.doesNotMatch(doc('en'), /^<!--[ \t]*\n---/, 'README.en.md has no front matter');
  assert.doesNotMatch(doc('en'), /^(?:id|slug|subtitle_ja|description_ja|category_ja|repo_url|demo_url|hub):/m);
});

const H1_JA = '# Account Domino Mapper - アカウントの連鎖と閉め出しを1手で比べる教材';
const SWITCH = { ja: '[English](README.en.md) · 日本語', en: 'English · [日本語](README.md)' };
const SERIES = { ja: '**Day127 - 生成AIで作るセキュリティツール200**', en: '**Day127 - 200 Security Tools with Generative AI**' };
const LEARNING = {
  ja: '学習用の教材です。本物のアカウントの構成は入れません（入れる欄もありません）。自分の構成は、印刷した用紙に記号で書きます。',
  en: 'This is a learning aid. Real account setups are never entered (there are no fields for them). To map your own setup, '
    + 'print the blank sheet and fill it in with symbols.',
};
const BADGES = ['img.shields.io/github/stars/ipusiron/' + SLUG, 'img.shields.io/github/forks/ipusiron/' + SLUG,
  'img.shields.io/github/last-commit/ipusiron/' + SLUG, 'img.shields.io/github/license/ipusiron/' + SLUG,
  'img.shields.io/badge/demo-GitHub%20Pages'];

test('I: the opening of both READMEs: title, language switch, five badges in order, the series line and the learning-only sentences', () => {
  for (const lang of LANGS) {
    const lines = prose(lang), end = firstH2(lang), file = FILES[lang];
    assert.ok(end > 0, file + ': H2 sections');
    const opening = lines.slice(0, end);
    const h1 = opening.findIndex((line) => /^# /.test(line));
    assert.ok(h1 >= 0 && opening.slice(0, h1).every((line) => !line.trim() || line === SWITCH[lang]), file + ': the H1 comes first');
    if (lang === 'ja') assert.equal(opening[h1], H1_JA);
    else assert.match(opening[h1], /^# Account Domino Mapper - \S.*$/);
    if (lang === 'ja') assert.equal(opening.filter((line) => line.trim() === SWITCH.ja).length, 1, 'README.md: the language switch line');
    else assert.equal(doc('en').split('\n')[0], SWITCH.en, 'README.en.md: line 1 is the language switch');
    // The five badges, in order after the H1; the GitHub Pages badge links to the demo
    const text = opening.join('\n');
    let at = text.indexOf(opening[h1]);
    for (const badge of BADGES) {
      const next = text.indexOf(badge, at + 1);
      assert.ok(next > at, `${file}: badge ${badge} (in the order stars, forks, last commit, license, GitHub Pages)`);
      at = next;
    }
    assert.ok(text.slice(at).startsWith(BADGES[4]) && /^[^\n]*\]\(https:\/\/ipusiron\.github\.io\/account-domino-mapper\/\)/
      .test(text.slice(at)), file + ': the GitHub Pages badge links to the demo');
    // The series line: one whole bold line after the badges, not a quotation
    const series = opening.map((line, i) => [line.trimEnd(), i]).filter(([line]) => line === SERIES[lang]);
    assert.equal(series.length, 1, file + ': the series line ' + SERIES[lang]);
    assert.ok(opening.slice(0, series[0][1]).join('\n').includes(BADGES[4]), file + ': the series line comes after the badges');
    assert.doesNotMatch(doc(lang), /^\s*>.*Day127 - /m, file + ': the series line is not a quotation');
    // Near the start (before the first section): the learning-only sentences; in Japanese the overview opens with the sentence
    // type of the spec, right after the series line
    const asRead = (part) => plain(part.filter((line) => line.trim() !== SWITCH[lang] && !/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)), lang);
    assert.ok(asRead(opening).includes(LEARNING[lang]), file + ': ' + LEARNING[lang]);
    if (lang === 'ja') {
      assert.match(asRead(opening.slice(series[0][1] + 1)), /^Account Domino Mapperは、[^。]+教材です。/,
        'the first sentence: Account Domino Mapperは、…教材です。');
    }
  }
});

test('I: the H2 sections of both READMEs follow the table of the spec, and both languages have the same headings and levels', () => {
  for (const [k, lang] of LANGS.entries()) {
    const list = headings(lang), file = FILES[lang];
    assert.equal(list[0].level, 1, file + ': the first heading is the H1');
    assert.equal(list.filter((h) => h.level === 1).length, 1, file + ': one H1');
    for (let i = 1; i < list.length; i++) assert.ok(list[i].level <= list[i - 1].level + 1, file + ': no skipped level at ' + list[i].title);
    assert.deepEqual(list.filter((h) => h.level === 2).map((h) => h.title), H2.map((pair) => pair[k]), file + ': the 15 H2 sections');
  }
  assert.deepEqual(headings('en').map((h) => h.level), headings('ja').map((h) => h.level), 'the same heading levels in the same order');
  const h3 = (lang) => sections(lang).map((s) => headings(lang).filter((h) => h.level === 3 && h.line >= s.from && h.line < s.to).length);
  assert.deepEqual(h3('en'), h3('ja'), 'the same number of H3 in each section');
});

// The use cases particular to this tool: the first list of the 🎯 section, right after its first line (a lead in the text,
// not a heading). Returns the items as they read.
function particularUses(lang) {
  const lines = bodyOf(lang, section(lang, h2Title(lang, '🎯'))), file = FILES[lang];
  let i = lines.findIndex((line) => line.trim());
  assert.ok(i >= 0, file + ': the use cases section has text');
  assert.match(lines[i], lang === 'ja' ? /このツールならではの使い方/ : /Ways of using this tool in particular/i,
    file + ': the section starts with the lead of the use cases particular to this tool');
  assert.doesNotMatch(lines[i], /^\s*#/, file + ': the lead is not a heading');
  const marker = /^(\d+\.|[-*+]) +(?=\S)/;
  for (i++; i < lines.length && !marker.test(lines[i]); i++) assert.doesNotMatch(lines[i], /^#/, file + ': a list follows the lead');
  assert.ok(i < lines.length, file + ': a list follows the lead');
  const ordered = /^\d/.test(lines[i]), items = [];
  let blank = false;
  for (; i < lines.length; i++) {
    const line = lines[i], m = line.match(marker);
    if (m) {
      if (/^\d/.test(m[1]) !== ordered) break;
      items.push([line.slice(m[0].length)]);
      blank = false;
    } else if (!line.trim()) blank = true;
    else if (/^\s/.test(line)) {
      items[items.length - 1].push(line);
      blank = false;
    } else if (blank || /^(#|---|\*\*\*|___|\|)/.test(line)) break;
    else items[items.length - 1].push(line);
  }
  return items.map((item) => plain(item, lang));
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const toNumber = (w) => (/^\d+$/.test(w) ? Number(w) : WORDS.indexOf(w.toLowerCase()));
// The numbers written in a text (Day numbers aside); English also counts the number words
function numbersIn(text, lang) {
  const re = lang === 'ja' ? /\d+/g : new RegExp(`\\b(?:\\d+|${WORDS.join('|')})\\b`, 'gi');
  return (text.replace(/\bDay\d+/g, '').match(re) || []).map(toNumber);
}
// The numbers written with a unit: Japanese 4枚, 89手, 3人, 2つ, 1本 and 段2; English "4 cards" or "four cards", "step 2" and
// the kinds of change ("89 changes", "24 removals", "3 additions", "15 replacements")
const KINDS = ['change', 'removal', 'addition', 'replacement'];
function unitNumbers(text, lang) {
  const out = {}, add = (unit, n) => (out[unit] ??= []).push(n);
  if (lang === 'ja') {
    for (const m of text.matchAll(/(\d+)(枚|手|人|つ|本)/g)) add(m[2], Number(m[1]));
    for (const m of text.matchAll(/段(\d+)/g)) add('段', Number(m[1]));
  } else {
    for (const m of text.matchAll(new RegExp(`\\b(\\d+|${WORDS.join('|')}) cards?\\b`, 'gi'))) add('card', toNumber(m[1]));
    for (const m of text.matchAll(/\bstep (\d+)\b/gi)) add('step', Number(m[1]));
    const kinds = new RegExp(`\\b(\\d+|${WORDS.join('|')}) (${KINDS.join('|')})s?\\b`, 'gi');
    for (const m of text.matchAll(kinds)) add(m[2].toLowerCase(), toNumber(m[1]));
  }
  return out;
}
// The accepted forms: Japanese writes a range with 〜 (6〜7); English with an en dash or "to" (6–7, 6 to 7) and a single number
// with digits or a word (4, four). A range is bound to the words that give its meaning: 全9のうち6〜7 and そのうち3〜5,
// "6–7 of the 9 accounts" and "Of those, 3–5".
const range = (lang, [a, b], before = '', after = '') => (lang === 'ja' ? `${before}${a}〜${b}${after}`
  : new RegExp(`${before}\\b${a}(?:–| to )${b}\\b${after}`));
const num = (n) => new RegExp(`\\b(?:${n}${n < WORDS.length ? '|' + WORDS[n] : ''})\\b`, 'i');
const escaped = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const upper = (s) => s[0].toUpperCase() + s.slice(1);
const lower = (s) => s[0].toLowerCase() + s.slice(1);
// A number bound to the kind of change it counts, as Japanese binds 足す3手 and 付け替え15手 (English "3 additions")
const kindNum = (n, kind) => new RegExp(`\\b(?:${n}${n < WORDS.length ? '|' + WORDS[n] : ''}) ${kind}s?\\b`, 'i');
// The word of a requirement, as the symbols of the screen name it (an email account, the SMS, the personal details …)
function requirementWord(p, id, lang) {
  if (p.services.some((s) => s.id === id && s.mail)) return M[lang].symMailLine;
  const type = p.credentials.find((c) => c.id === id).type;
  return M[lang]['sym' + { phone: 'Sms', info: 'Info', device: 'Phone', idcheck: 'Doc', paper: 'Paper' }[type] + 'Name'];
}

// The facts behind the six use cases, computed with the calculation and the data (not taken from the README)
function useCaseFacts() {
  const P = Object.fromEntries(D.personas.map((p) => [p.id, p]));
  const ids = (p) => p.services.map((s) => s.id), card = (p, id) => p.cards.find((c) => c.id === id);
  const service = (p, id) => p.services.find((s) => s.id === id);
  const span = (values) => [Math.min(...values), Math.max(...values)];
  // 1: every card topples the main email; a single card topples fell[0]–fell[1] of the accounts (the main email included), and
  // through[0]–through[1] of them (the main email aside) only because the main email fell: blocking it keeps them standing
  const w = P.worker, gw = C.personaGraph(w);
  const perCard = w.cards.map((c) => {
    const gives = C.cardGives(w, c), reached = C.reach(gw, gives), blocked = C.reach(gw, gives, new Set(['mailMain']));
    const fell = ids(w).filter((s) => reached.has(s));
    return { fell, through: fell.filter((s) => s !== 'mailMain' && !blocked.has(s)) };
  });
  assert.ok(perCard.every((x) => x.fell.includes('mailMain')), 'the main email falls to every card');
  const uc1 = { cards: w.cards.length, accounts: ids(w).length, fell: span(perCard.map((x) => x.fell.length)),
    through: span(perCard.map((x) => x.through.length)), mail: service(w, 'mailMain').label };
  // 2: the brokerage falls at a step through its recovery entrance of two requirements, to the SIM swap alone
  const steps = C.stepReach(gw, C.cardGives(w, card(w, 'simswap'))), via = steps.via.get('sec');
  const secMethod = service(w, 'sec').methods.find((m) => 'sec.' + m.id === via), secBases = C.cardBases(w, gw, ['sec']).sec;
  assert.equal(secMethod.role, 'recovery');
  assert.deepEqual(secBases, [['simswap']]);
  const uc2 = { step: steps.rank.get('sec'), keys: secMethod.requires.length, cards: secBases[0].length,
    entrance: secMethod.requires.map((r) => requirementWord(w, r, 'ja')).join('＋'),
    entranceEn: secMethod.requires.map((r) => requirementWord(w, r, 'en')).join(' + ') };
  // 3: the online bank does not fall to the SIM swap alone; it needs two cards (its reset needs two requirements), named as the
  // screen names them (Japanese may use the short name of the four-cards table, such as 窓口)
  const bankBases = C.cardBases(w, gw, ['bank']).bank, bankReset = service(w, 'bank').methods.filter((m) => m.role === 'recovery');
  assert.ok(!C.reach(gw, C.cardGives(w, card(w, 'simswap'))).has('bank'));
  assert.equal(bankBases.length, 1);
  assert.equal(bankReset.length, 1);
  const cardName = (id, lang) => new RegExp(`(?:${[M[lang]['card' + upper(id)], ...(lang === 'ja' ? [M.ja['fourCardsCol' + upper(id)]] : [])]
    .map(escaped).join('|')})`, lang === 'en' ? 'i' : '');
  const uc3 = { cards: bankBases[0].length, entrance: bankReset[0].requires.map((r) => requirementWord(w, r, 'ja')).join('＋'),
    entranceEn: bankReset[0].requires.map((r) => requirementWord(w, r, 'en')).join(' + '),
    names: { ja: bankBases[0].map((id) => cardName(id, 'ja')), en: bankBases[0].map((id) => cardName(id, 'en')) } };
  // 4: the changes of the three people; those that lock out more after a single loss (all of them remove an entrance); the
  // changes that create a pair of losses that locks the owner out, by kind
  const uc4 = { people: D.personas.length, total: 0, removals: 0, increase: 0, pairs: { add: 0, replace: 0, remove: 0 } };
  for (const p of D.personas) {
    for (const mv of C.personaVectors(p).moves) {
      uc4.total++;
      if (mv.kind === 'remove') uc4.removals++;
      if (Object.values(mv.losses).some((l) => l.newlyLocked.length)) {
        assert.equal(mv.kind, 'remove', mv.id);
        uc4.increase++;
      }
      if (Object.values(mv.pairLosses).some((l) => l.newlyLocked.length)) uc4.pairs[mv.kind]++;
    }
  }
  // 5: the older parent's bank has entrances that all need the phone number: giving it up locks the bank, and losing the phone
  // leaves ○ with "× if the number goes too"
  const pa = P.parent, bank = service(pa, 'bank'), table = C.lossTable(pa);
  assert.ok(bank.methods.every((m) => m.requires.includes('phone')));
  assert.equal(table.cells.number.bank.mark, 'locked');
  assert.deepEqual(table.cells.device.bank, { mark: 'ok', plus: ['number'] });
  const cell = (lang) => M[lang].cellPlus1.replace('{p}', M[lang].partnerNumber);
  const uc5 = { entrances: bank.methods.length, cell: { ja: cell('ja'), en: cell('en') } };
  // 6: the SIM swap alone topples the bank and nothing else; one change (the bank's reset to a document check) stops both the
  // SIM swap and the lockout after giving up the number
  const gp = C.personaGraph(pa), simFell = ids(pa).filter((s) => C.reach(gp, C.cardGives(pa, card(pa, 'simswap'))).has(s));
  assert.deepEqual(simFell, ['bank']);
  const parentBases = C.cardBases(pa, gp, ['bank']).bank;
  assert.deepEqual(parentBases, [['simswap']]);
  const toDocuments = C.personaVectors(pa).moves.filter((mv) => mv.kind === 'replace' && mv.service === 'bank' && mv.to === 'idcheck'
    && bank.methods.find((m) => m.id === mv.method).role === 'recovery');
  assert.equal(toDocuments.length, 1);
  assert.ok(toDocuments[0].cards.simswap.saved.includes('bank') && toDocuments[0].losses.number.unlocked.includes('bank'));
  // The destination of that change as the screen names it: the short symbol in Japanese (書類), the requirement in English
  const to = { ja: V.names(pa, M, 'ja').tag[toDocuments[0].to], en: V.names(pa, M, 'en').req[toDocuments[0].to] };
  const uc6 = { cards: parentBases[0].length, moves: toDocuments.length, to };
  return { uc1, uc2, uc3, uc4, uc5, uc6 };
}

test('I: the use cases particular to this tool carry the numbers of the calculation (both languages, six items, no other number)',
  (t) => {
    const { uc1, uc2, uc3, uc4, uc5, uc6 } = useCaseFacts();
    const sim = M.ja.cardSimswap;
    // Per item: what Japanese and English must contain, every number allowed in the item (1 and 2 stand for "one card", "one
    // change", "two at once" and the like), and the numbers allowed with each unit
    const cases = [
      { ja: [`${uc1.cards}枚`, range('ja', uc1.fell, `全${uc1.accounts}のうち`), range('ja', uc1.through, 'そのうち'), uc1.mail.ja,
        '書いた用紙は本人が保管し', '集めたり見せ合ったり'],
      en: [num(uc1.cards), range('en', uc1.fell, '', ` of the ${uc1.accounts} accounts`), range('en', uc1.through, 'Of those, '),
        new RegExp(uc1.mail.en, 'i'),
        '(In training, too, each person keeps their own filled-in sheet; sheets are not collected or shown to others.)'],
      allowed: [1, uc1.cards, uc1.accounts, ...uc1.fell, ...uc1.through], units: { 枚: [uc1.cards, 1], card: [uc1.cards, 1] } },
      { ja: [`段${uc2.step}`, `${sim}${uc2.cards}枚`, `${uc2.keys}つ`, uc2.entrance],
        en: [new RegExp(`\\bstep ${uc2.step}\\b`, 'i'), new RegExp(escaped(uc2.entranceEn), 'i')],
        allowed: [1, uc2.step, uc2.keys, uc2.cards],
        units: { 枚: [uc2.cards], 段: [uc2.step], つ: [uc2.keys], 本: [1], card: [uc2.cards], step: [uc2.step] } },
      { ja: [`${uc3.cards}枚`, '1枚では', uc3.entrance, ...uc3.names.ja],
        en: [num(uc3.cards), new RegExp(escaped(uc3.entranceEn), 'i'), ...uc3.names.en], allowed: [1, uc3.cards],
        units: { 枚: [1, uc3.cards], card: [1, uc3.cards] } },
      { ja: [`${uc4.people}人`, `${uc4.total}手`, `${uc4.increase}手`, `外す${uc4.removals}手`, `足す${uc4.pairs.add}手`,
        `付け替え${uc4.pairs.replace}手`, `「${M.ja.sameRemove}」`],
      en: [kindNum(uc4.total, 'change'), num(uc4.increase), kindNum(uc4.removals, 'removal'), kindNum(uc4.pairs.add, 'addition'),
        kindNum(uc4.pairs.replace, 'replacement'), new RegExp(`\\b(?:${uc4.people}|${WORDS[uc4.people]}) people\\b`, 'i')],
      allowed: [1, 2, uc4.people, uc4.total, uc4.increase, uc4.removals, uc4.pairs.add, uc4.pairs.replace],
      units: { 人: [uc4.people], 手: [uc4.total, uc4.increase, uc4.removals, uc4.pairs.add, uc4.pairs.replace], つ: [1, 2],
        change: [uc4.total], removal: [uc4.removals], addition: [uc4.pairs.add], replacement: [uc4.pairs.replace] } },
      { ja: [`入口が${uc5.entrances}つ`, uc5.cell.ja], en: [num(uc5.entrances), uc5.cell.en], allowed: [1, uc5.entrances],
        units: { つ: [1, uc5.entrances] } },
      // The one change goes to documents: 書類の確認へ付け替える1手, "One change, moving … to a document check, …" (in one clause)
      { ja: [`${sim}${uc6.cards}枚`, `${uc6.to.ja}の確認へ付け替える${uc6.moves}手`],
        en: [new RegExp(`\\b(?:${uc6.moves}|${WORDS[uc6.moves]}) change\\b[^.;(]*\\bto ${escaped(uc6.to.en)}\\b`, 'i')],
        allowed: [1, uc6.cards, uc6.moves],
        units: { 枚: [uc6.cards], 手: [uc6.moves], 本: [1], card: [uc6.cards], change: [uc6.moves] } },
    ];
    assert.deepEqual([uc1.cards, uc1.accounts, uc1.fell, uc1.through, uc2.step, uc2.cards, uc3.cards, uc4.total, uc4.removals,
      uc4.increase, uc4.pairs, uc5.entrances], [4, 9, [6, 7], [3, 5], 2, 1, 2, 89, 24, 10, { add: 3, replace: 15, remove: 0 }, 2],
    'the values the spec gives for the use cases');
    for (const lang of LANGS) {
      const items = particularUses(lang), file = FILES[lang];
      assert.equal(items.length, cases.length, file + ': six use cases particular to this tool');
      cases.forEach((c, k) => {
        for (const want of c[lang]) {
          const ok = typeof want === 'string' ? items[k].includes(want) : want.test(items[k]);
          assert.ok(ok, `${file}: use case ${k + 1} has ${want}: ${items[k]}`);
        }
        const others = numbersIn(items[k], lang).filter((n) => !c.allowed.includes(n));
        assert.deepEqual(others, [], `${file}: use case ${k + 1} has a number not from the calculation: ${items[k]}`);
        for (const [unit, values] of Object.entries(unitNumbers(items[k], lang))) {
          if (!c.units[unit]) continue;
          const wrong = values.filter((n) => !c.units[unit].includes(n));
          assert.deepEqual(wrong, [], `${file}: use case ${k + 1}, numbers with ${unit}: ${items[k]}`);
        }
      });
    }
    t.diagnostic(`use case values: ${JSON.stringify({ uc1, uc2, uc3, uc4, uc5: uc5.entrances, uc6 },
      (key, value) => (value instanceof RegExp ? value.source : value))}`);
  });

// ===== The other numbers and tables of the READMEs, against the calculation and messages.js =====
const PERSON_KEYS = { worker: 'personWorker', parent: 'personParent', student: 'personStudent' };
// The words the READMEs use for the three people in running text (the role in the names of messages.js)
const ROLES = { ja: { worker: '会社員', parent: '親', student: '学生' }, en: { worker: 'office worker', parent: 'parent', student: 'student' } };
const STEP_WORDS = { ja: { n: '段{n}', last: '最後の段' }, en: { n: 'step {n}', last: 'last step' } };
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));
const keysOf = (re) => Object.keys(M.ja).filter((key) => re.test(key));
const sectionText = (lang, icon) => plain(bodyOf(lang, section(lang, h2Title(lang, icon))), lang);

// The facts behind the feature table, the technical notes and the screen layout, from the calculation and the data
function readmeFacts() {
  const P = Object.fromEntries(D.personas.map((p) => [p.id, p]));
  const pv = Object.fromEntries(D.personas.map((p) => [p.id, C.personaVectors(p)]));
  const all = D.personas.flatMap((p) => pv[p.id].moves.map((mv) => ({ p, mv })));
  const methodOf = (p, mv) => p.services.find((s) => s.id === mv.service).methods.find((m) => m.id === mv.method);
  const moves = Object.fromEntries(D.personas.map((p) => [p.id, pv[p.id].moves.length]));
  const kinds = Object.fromEntries(['add', 'replace', 'remove'].map((kind) => [kind, all.filter(({ mv }) => mv.kind === kind).length]));
  const twoRemoved = all.filter(({ p, mv }) => mv.kind === 'remove' && methodOf(p, mv).requires.length === 2).length;
  // The changes toward documents, paper codes or the phone: none makes an account newly fall or adds a lockout after one loss,
  // and the changes to documents add no pair of losses either (the claims of the technical notes)
  const toward = { doc: (mv) => mv.kind === 'replace' && mv.to === 'idcheck', paper: (mv) => mv.kind === 'replace' && /^paper:/.test(mv.to),
    addPhone: (mv) => mv.kind === 'add', toPhone: (mv) => mv.kind === 'replace' && mv.to === 'device' };
  const of = (kind) => all.filter(({ mv }) => toward[kind](mv)).map(({ mv }) => mv);
  const forty = Object.keys(toward).flatMap(of);
  const pairNew = (mv) => Object.values(mv.pairLosses).some((l) => l.newlyLocked.length);
  for (const mv of forty) {
    assert.ok(Object.values(mv.cards).every((c) => !c.exposed.length), mv.id + ': no account newly falls');
    assert.ok(Object.values(mv.losses).every((l) => !l.newlyLocked.length), mv.id + ': no lockout after one loss');
  }
  for (const mv of of('doc')) assert.ok(!pairNew(mv), mv.id + ': a change to documents adds no pair of losses');
  const towardCounts = { doc: of('doc').length, paper: of('paper').length, addPhone: of('addPhone').length, toPhone: of('toPhone').length,
    total: forty.length, same: forty.filter((mv) => Object.values(mv.cards).every((c) => !c.saved.length && !c.exposed.length)).length,
    pairPaper: of('paper').filter(pairNew).length, pairAddPhone: of('addPhone').filter(pairNew).length };
  // The widths of the diagrams, the same in both languages (the READMEs name the office worker and the student together)
  const widths = Object.fromEntries(D.personas.map((p) => [p.id, V.layout(p, null, M, 'ja').width]));
  for (const p of D.personas) assert.equal(V.layout(p, null, M, 'en').width, widths[p.id], p.id + ': the same width in English');
  assert.equal(widths.worker, widths.student);
  const perPerson = D.personas.map((p) => V.highlights.filter((h) => h.person === p.id).length);
  assert.ok(perPerson.every((n) => n === perPerson[0]), 'as many highlights per person');
  const screen = { rules: keysOf(/^rule\d+$/).length, notes: NOTE_KEYS.length, notInModel: keysOf(/^notInModel\d+$/).length,
    highlights: V.highlights.length, perPerson: perPerson[0], terms: keysOf(/^term[A-Z]\w*$/).filter((key) => !/Meaning$/.test(key)).length,
    lessons: keysOf(/^lesson\d+Title$/).length };
  return { P, pv, moves, total: all.length, people: D.personas.length, kinds, twoRemoved, toward: towardCounts, widths, screen };
}
// The four notes of the Rules tab, as app.js builds them (the paper note names Day124 and Day125 with their links)
const NOTE_KEYS = ['noteSms', 'notePasskey', 'noteDesk', 'notePaperRules'];
function rulesNotes(lang) {
  const tool = (id) => V.relatedTools.find((x) => x.id === id), link = (id) => `[${M[lang][tool(id).name]}](${tool(id).href})`;
  return [M[lang].noteSms, fill(M[lang].notePasskey, { sync: M[lang].lockNoteSync }), M[lang].noteDesk,
    fill(M[lang].notePaperRules, { paper: M[lang].notePaper, day124: link('day124'), day125: link('day125') })]
    // The READMEs write straight double quotes where the screen has curly ones
    .map((note) => note.replace(/[“”]/g, '"'));
}

test('I: the feature table, the technical notes and the screen layout give the numbers of the calculation (both languages)', () => {
  const f = readmeFacts(), t = f.toward, s = f.screen, w = f.widths;
  const roles = (lang) => ['worker', 'parent', 'student'].map((id) => `${ROLES[lang][id]}${lang === 'ja' ? '' : ' '}${f.moves[id]}`);
  const want = {
    ja: {
      '✨': [...D.personas.map((p) => `${M.ja[PERSON_KEYS[p.id]]}（アカウント${V.counts(p).accounts}・パスワードの系統${V.counts(p).families}）`),
        `${roles('ja').join('・')}、合わせて${f.total}`, `規則${s.rules}行`, `注記${s.notes}つ`, `入れていないもの${s.notInModel}項目`,
        `人物ごとに${s.perPerson}つ、合わせて${s.highlights}つ`, `用語${s.terms}語`, `座学${s.lessons}節`],
      '🔬': [`${roles('ja').join('・')}、合わせて${f.total}手`, `${f.people}人で${f.kinds.add}手`, `${f.people}人で${f.kinds.replace}手`,
        `${f.people}人で${f.kinds.remove}手。そのうち条件が2つの入口を外す手は${f.twoRemoved}手`,
        `書類へ付け替える${t.doc}手・紙へ付け替える${t.paper}手・スマホを足す${t.addPhone}手・スマホへ付け替える${t.toPhone}手の${t.total}手`,
        `新たに倒れるアカウントが0`, `攻撃の結果が何も変わらない手が${t.same}手`, `紙へ付け替える${t.pairPaper}手とスマホを足す${t.pairAddPhone}手`,
        `図の幅は${ROLES.ja.worker}と${ROLES.ja.student}が${w.worker}、${ROLES.ja.parent}が${w.parent}`, `${s.rules}行です`],
      '📐': [`${ROLES.ja.worker}と${ROLES.ja.student}の図（幅${w.worker}）`],
    },
    en: {
      '✨': [...D.personas.map((p) => `${M.en[PERSON_KEYS[p.id]]} (${V.counts(p).accounts} accounts, ${V.counts(p).families} password `
        + `${V.counts(p).families === 1 ? 'family' : 'families'})`), `${roles('en').join(', ')}; ${f.total} in all`,
      `The ${s.rules} rules`, `${s.notes} notes`, `the ${s.notInModel} items not in this model`,
      `${upper(WORDS[s.perPerson])} per person, ${WORDS[s.highlights]} in all`, `${s.terms} terms`, `${s.lessons} lessons`],
      '🔬': [`${roles('en').join(', ')}; ${f.total} changes in all`, `(${f.kinds.add} changes for the ${WORDS[f.people]} people)`,
        `(${f.kinds.replace} changes for the ${WORDS[f.people]} people)`,
        `(${f.kinds.remove} changes for the ${WORDS[f.people]} people, ${f.twoRemoved} of which remove an entrance with two requirements)`,
        `(${t.total} changes: ${t.doc} replacing with a document check, ${t.paper} replacing with paper codes, ${t.addPhone} adding the phone `
        + `and ${t.toPhone} replacing with the phone)`, 'make no new account fall', `${t.same} of them change nothing in the attack`,
        `${t.pairPaper} of the changes to paper codes and ${t.pairAddPhone} of the changes that add the phone`,
        `the diagrams are ${w.worker} wide for the ${ROLES.en.worker} and the ${ROLES.en.student}, and ${w.parent} for the ${ROLES.en.parent}`,
        `the same ${s.rules} rows`],
      '📐': [`the diagrams of the ${ROLES.en.worker} and the ${ROLES.en.student} (${w.worker} wide)`],
    },
  };
  for (const lang of LANGS) {
    for (const [icon, fragments] of Object.entries(want[lang])) {
      const text = sectionText(lang, icon);
      for (const fragment of fragments) assert.ok(text.includes(fragment), `${FILES[lang]} ${icon}: ${fragment}`);
    }
  }
});

test('I: the rules table and the four notes of the technical notes are those of the Rules tab, and the limits list what the model '
  + 'leaves out as the Rules tab does', () => {
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2Title(lang, '🔬'))), file = FILES[lang];
    const rules = tablesIn(lines).find((table) => table.header[0] === '#');
    assert.ok(rules, file + ': the rules table');
    const count = keysOf(/^rule\d+$/).length;
    assert.deepEqual(rules.rows, Array.from({ length: count }, (_, k) => [String(k + 1), M[lang]['rule' + (k + 1)]]), file + ': the rules');
    const note = lang === 'ja' ? /^注記([1-4])（[^）]+）：(.+)$/ : /^Note ([1-4]) \([^)]+\): (.+)$/;
    const notes = lines.map((line) => line.trim().match(note)).filter(Boolean);
    assert.deepEqual(notes.map((m) => Number(m[1])), [1, 2, 3, 4], file + ': notes 1 to 4 in order');
    assert.deepEqual(notes.map((m) => m[2]), rulesNotes(lang), file + ': the notes as the Rules tab shows them');
    // The model leaves out what the Rules tab lists under "Not in this model", in its order
    const values = keysOf(/^notInModel\d+$/).sort((a, b) => parseInt(a.slice(10), 10) - parseInt(b.slice(10), 10)).map((key) => M[lang][key]);
    // The list joins the items with 、 (English: ;), so no item holds that mark itself: the list reads as exactly the items
    const joiner = lang === 'ja' ? '、' : ';';
    assert.deepEqual(values.filter((value) => value.includes(joiner)), [], `${file}: an item with ${joiner} would read as two items`);
    const listed = lang === 'ja' ? `${values.join('、')}である。`
      : `${values.slice(0, -1).map(lower).join('; ')}; and ${lower(values[values.length - 1])}.`;
    assert.ok(sectionText(lang, '⚠️').includes(listed), `${file}: what the model leaves out: ${listed}`);
  }
});

test('I: the technical notes tell the two points on Definition 18 as lesson 9 does: derived and checked here, apart from what the '
  + 'paper defines; the least fixed point can miss a lockout in a cycle, not every time', () => {
  const want = {
    ja: ['論文の定義18は、閉め出しを最小不動点として定めています', '次の2つは、この教材で導いて確かめたことです', '閉め出しを見落とす場合がある'],
    en: ['Definition 18 in the paper defines lockout as a least fixed point', 'The next two points were derived and checked for this teaching aid',
      'can miss lockouts in a cycle'],
  };
  for (const lang of LANGS) {
    const text = sectionText(lang, '🔬'), file = FILES[lang];
    for (const phrase of want[lang]) assert.ok(text.includes(phrase), `${file} 🔬: ${phrase}`);
    assert.doesNotMatch(text, lang === 'ja' ? /見落とすことです/ : /\bmisses lockouts/, `${file} 🔬: not every lockout in a cycle is missed`);
  }
});

test('I: the highlights table of the use section is the nine highlights of the screen, with the state each one moves to', () => {
  const pv = Object.fromEntries(D.personas.map((p) => [p.id, C.personaVectors(p)]));
  const P = Object.fromEntries(D.personas.map((p) => [p.id, p]));
  const where = (h, lang) => {
    const s = h.state, parts = [M[lang][{ chain: 'tabChain', lockout: 'tabLockout', compare: 'tabCompare' }[s.tab]]];
    if (s.tab === 'chain') {
      parts.push(M[lang]['card' + upper(s.card)], s.step === 'last' ? STEP_WORDS[lang].last : fill(STEP_WORDS[lang].n, { n: s.step }));
    }
    if (s.tab === 'compare') parts.push(M[lang]['mode' + upper(s.mode)]);
    if (s.tab === 'lockout') parts.push(V.names(P[h.person], M, lang).full[s.account]);
    return parts.join(lang === 'ja' ? '・' : ', ');
  };
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2Title(lang, '📖'))), file = FILES[lang];
    const tables = tablesIn(lines);
    assert.equal(tables.length, 1, file + ': the highlights table');
    const titles = V.highlights.map((h) => V.highlightTitle(h, pv[h.person], M, lang));
    assert.deepEqual(tables[0].rows, V.highlights.map((h, k) => [M[lang][PERSON_KEYS[h.person]], titles[k], where(h, lang)]),
      file + ': the nine highlights');
    // The first step of the use section presses the first highlight by its title
    const quoted = lang === 'ja' ? `「${titles[0]}」` : `"${titles[0]}"`;
    assert.ok(plain(lines, lang).includes(quoted), `${file}: the first highlight ${quoted}`);
  }
});

// The first of the candidates, under the heading この模型での上位の手 / "Top changes in this model": the screen gives it no word or tag
// of its own, so the READMEs name it with the words of that heading (and the use section says that it ranks first in this model)
const TOP_FIRST = { ja: '上位の手の先頭', en: 'the first of the top changes' };
const OWN_WORD = { ja: /おすすめ|オススメ/, en: /suggest/i };

test('I: the use section opens with "First time here" of the help, and it and the screen layout name the candidates and the line '
  + 'under the lockout table as the screen shows them; README.md keeps the screen\'s word for the sum over the four cards, and both '
  + 'READMEs name the first of the candidates with the words of the screen', () => {
  const pa = D.personas.find((p) => p.id === 'parent');
  // The line under the lockout table names the SMS requirement with the phone number, as app.js draws it (lockTagPhone)
  const lockLine = Object.fromEntries(LANGS.map((lang) => [lang, { ...M[lang], tagPhone: M[lang].lockTagPhone }]));
  const quote = (lang, s) => (lang === 'ja' ? `「${s}」` : `"${s}"`);
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2Title(lang, '📖'))), file = FILES[lang];
    // The first paragraph: the order of "First time here", in the words of the help (straight quotes for the curly ones)
    const from = lines.findIndex((line) => line.trim());
    const to = lines.findIndex((line, i) => i > from && !line.trim());
    const first = plain(lines.slice(from, to), lang), order = M[lang].helpFirstText.replace(/[“”]/g, '"');
    assert.ok(first.includes(quote(lang, M[lang].helpFirst)), `${file}: the first paragraph names ${M[lang].helpFirst}: ${first}`);
    assert.ok(first.includes(order), `${file}: the first paragraph follows ${M[lang].helpFirst}: ${order}`);
    // The steps: the heading of the candidates, and the example of the line under the lockout table (the parent's bank)
    const text = plain(lines, lang), line = V.lockEntrances(pa, 'bank', lockLine, lang);
    assert.ok(text.includes(quote(lang, M[lang].candidatesHeading)), `${file}: the candidates heading ${M[lang].candidatesHeading}`);
    assert.ok(text.includes(lang === 'ja' ? `例：${line}` : `"${line}"`), `${file}: the line under the lockout table ${line}`);
    assert.ok(sectionText(lang, '📐').includes(M[lang].candidatesHeading), `${file}: the screen layout names ${M[lang].candidatesHeading}`);
  }
  // The screen names the sum over the four cards 4枚の合計 (termSum, the name of the mode as well), never 延べ
  if (!Object.values(M.ja).some((value) => String(value).includes('延べ'))) {
    assert.doesNotMatch(doc('ja'), /延べ/, `README.md: ${M.ja.termSum}, the word of the screen, not 延べ`);
  }
  // The first of the candidates: 上位の手の先頭 / "the first of the top changes" (the screenshot captions check where), never a word
  // that the screen does not show, such as おすすめ or "suggested change"
  for (const lang of LANGS) {
    assert.ok(!Object.values(M[lang]).some((value) => OWN_WORD[lang].test(String(value))), `${lang}: the screen has no such word`);
    assert.doesNotMatch(doc(lang), OWN_WORD[lang], `${FILES[lang]}: ${TOP_FIRST[lang]}, in the words of the screen`);
    assert.ok(plain(prose(lang), lang).includes(TOP_FIRST[lang]), `${FILES[lang]}: ${TOP_FIRST[lang]}`);
  }
});

// The accounts that a text names for each step, read from the one sentence of the text that tells step 1: every account of the
// person named in that sentence (its short name, as the screen writes it; the longest name first, so that a name inside a longer
// one is not counted again) belongs to the step whose mark follows it (after = false: "A and B fall at step 1, and C at step 2",
// AとBが段1、Cが段2) or comes before it (after = true: 段1でA・B、段2でC). The step numbers and the names are read together, so a
// name told at the wrong step is found even when every name and every step is in the text. Every other sentence of the text that
// has a step mark is read the same way (others), so that a sentence added later cannot tell a name at the wrong step either.
function namesByStep(text, lang, names, mark, after) {
  const sentences = lang === 'ja' ? text.split(/(?<=。)/) : text.split(/(?<=[.!?])\s+(?=[A-Z"(])/);
  const marked = sentences.map((s, i) => ({ s, i, n: [...s.matchAll(mark)].map((m) => m[1]) })).filter((x) => x.n.length);
  const told = marked.filter((x) => x.n.includes('1'));
  assert.equal(told.length, 1, `one sentence tells step 1: ${text}`);
  const others = marked.filter((x) => x.i !== told[0].i).map((x) => placeNames(x.s, lang, names, mark, after));
  return { ...placeNames(told[0].s, lang, names, mark, after), others };
}
// The accounts that one sentence names for each step (by the rule above), and those it names outside every step
function placeNames(sentence, lang, names, mark, after) {
  const marks = [...sentence.matchAll(mark)].map((m) => ({ n: Number(m[1]), from: m.index, to: m.index + m[0].length }));
  const taken = [];
  for (const [id, name] of Object.entries(names).sort((a, b) => b[1].length - a[1].length)) {
    const re = lang === 'en' ? new RegExp(`\\b${escaped(name)}\\b`, 'gi') : new RegExp(escaped(name), 'g');
    for (const m of sentence.matchAll(re)) {
      const from = m.index, to = m.index + m[0].length;
      if (!taken.some((x) => from < x.to && x.from < to)) taken.push({ id, from, to });
    }
  }
  const steps = {}, unplaced = [];
  for (const name of taken.sort((a, b) => a.from - b.from)) {
    const at = after ? marks.filter((m) => m.to <= name.from).pop() : marks.find((m) => m.from >= name.to);
    if (at) (steps[at.n] ??= []).push(name.id); else unplaced.push(name.id);
  }
  return { sentence, marks: marks.map((m) => m.n), steps, unplaced };
}
// The accounts of a person that fall at each step (rank === r) agree with the accounts a text names for that step
function assertStepsNamed(text, lang, p, steps, mark, after, label) {
  const last = Math.max(...steps.rank.values()), order = p.services.map((s) => s.id);
  const sorted = (ids) => [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const told = namesByStep(text, lang, V.names(p, M, lang).short, mark, after);
  assert.deepEqual(told.marks, Array.from({ length: last }, (_, r) => r + 1), `${label}: the steps 1 to ${last} in order: ${told.sentence}`);
  assert.deepEqual(told.unplaced, [], `${label}: every account named belongs to a step: ${told.sentence}`);
  for (let r = 1; r <= last; r++) {
    const fell = order.filter((id) => steps.rank.get(id) === r);
    assert.deepEqual(sorted(told.steps[r] || []), fell, `${label}: the accounts named for step ${r} are those falling at step ${r}: ${told.sentence}`);
  }
  // Another sentence with a step mark names only accounts that fall at the step it gives them, and gives each one a step in the
  // form of the text (a name it does not place, a sentence in the other form among them, is not read and fails)
  for (const other of told.others) {
    assert.deepEqual(other.unplaced, [], `${label}: every account named belongs to a step: ${other.sentence}`);
    for (const [r, ids] of Object.entries(other.steps)) {
      assert.deepEqual(ids.filter((id) => steps.rank.get(id) !== Number(r)), [],
        `${label}: the accounts named for step ${r} fall at step ${r}: ${other.sentence}`);
    }
  }
}
const STEP_MARKS = { caption: { ja: [/段(\d+)で/g, true], en: [/\bat step (\d+)\b/gi, false] },
  example: { ja: [/段(\d+)/g, false], en: [/\bat step (\d+)\b/gi, false] } };

test('I: namesByStep reads the accounts of each step from the sentences with a step mark, and finds a name told at the wrong step, '
  + 'in another sentence too', () => {
  const w = D.personas.find((p) => p.id === 'worker');
  const steps = C.stepReach(C.personaGraph(w), C.cardGives(w, w.cards.find((c) => c.id === 'leak')));
  const ok = { ja: '地図。段1でメインのメール・ポイントアプリ・通販、段2でSNS・フリマアプリ・写真のクラウドが倒れます。',
    en: 'At step 2. The main email, the points app and the online shop fall at step 1, and social media, the flea-market app and '
      + 'the photo cloud at step 2.' };
  const swapped = { ja: '地図。段1でSNS・フリマアプリ・写真のクラウド、段2でメインのメール・ポイントアプリ・通販が倒れます。',
    en: 'At step 2. Social media, the flea-market app and the photo cloud fall at step 1, and the main email, the points app and '
      + 'the online shop at step 2.' };
  for (const lang of LANGS) {
    const [mark, after] = STEP_MARKS.caption[lang];
    assertStepsNamed(ok[lang], lang, w, steps, mark, after, lang);
    assert.throws(() => assertStepsNamed(swapped[lang], lang, w, steps, mark, after, lang), /step 1/, lang + ': the names of steps 1 and 2 swapped');
  }
  // Steps out of order, an account named outside every step, and an account added to a step are found too
  assert.throws(() => assertStepsNamed('メインのメール・ポイントアプリ・通販が段2、SNS・フリマアプリ・写真のクラウドが段1で倒れます。', 'ja', w, steps,
    ...STEP_MARKS.example.ja, 'ja'), /in order/);
  assert.throws(() => assertStepsNamed('ネット銀行のほか、段1でメインのメール・ポイントアプリ・通販、段2でSNS・フリマアプリ・写真のクラウドが倒れます。', 'ja', w,
    steps, ...STEP_MARKS.caption.ja, 'ja'), /belongs to a step/);
  assert.throws(() => assertStepsNamed('段1でメインのメール・ポイントアプリ・通販、段2でSNS・フリマアプリ・写真のクラウド・ネット銀行が倒れます。', 'ja', w,
    steps, ...STEP_MARKS.caption.ja, 'ja'), /step 2/);
  // Another sentence with a step mark (one sentence still tells step 1): read as well. Right, it passes; a name at the wrong step,
  // or a name it does not place (a sentence in the other form), is found
  const example = 'メインのメール・ポイントアプリ・通販が段1、SNS・フリマアプリ・写真のクラウドが段2で倒れます。';
  assertStepsNamed(example + 'SNSは段2で倒れます。', 'ja', w, steps, ...STEP_MARKS.example.ja, 'ja');
  assert.throws(() => assertStepsNamed(example + '通販は段2で倒れます。', 'ja', w, steps, ...STEP_MARKS.example.ja, 'ja'), /step 2/);
  assertStepsNamed(ok.en + ' The photo cloud falls at step 2.', 'en', w, steps, ...STEP_MARKS.caption.en, 'en');
  assert.throws(() => assertStepsNamed(ok.en + ' The online shop falls at step 2.', 'en', w, steps, ...STEP_MARKS.caption.en, 'en'),
    /step 2/);
  assertStepsNamed(ok.ja + '段2でSNSが倒れます。', 'ja', w, steps, ...STEP_MARKS.caption.ja, 'ja');
  assert.throws(() => assertStepsNamed(ok.ja + '段2で通販が倒れます。', 'ja', w, steps, ...STEP_MARKS.caption.ja, 'ja'), /step 2/);
  assert.throws(() => assertStepsNamed(ok.ja + 'SNSは段2で倒れます。', 'ja', w, steps, ...STEP_MARKS.caption.ja, 'ja'),
    /belongs to a step/);
});

test('I: the screenshot captions give the people, cards, steps, counts and sentences of the screen they show', () => {
  const w = D.personas.find((p) => p.id === 'worker'), pa = D.personas.find((p) => p.id === 'parent');
  // 1: the office worker's breach at its last step: the accounts that fall at each step, and how many in all
  const leak = C.stepReach(C.personaGraph(w), C.cardGives(w, w.cards.find((c) => c.id === 'leak')));
  const last = Math.max(...leak.rank.values());
  const fell = (r) => w.services.filter((s) => leak.rank.get(s.id) === r).map((s) => s.id);
  const fallen = w.services.filter((s) => leak.rank.get(s.id) > 0).length;
  // 2: the parent's bank in the lockout table: × in one column, ○ with "× if the number goes too" in the others
  const table = C.lossTable(pa), cells = table.columns.map((l) => [l, table.cells[l].bank]);
  const locked = cells.filter(([, c]) => c.mark === 'locked').map(([l]) => l), plus = cells.filter(([, c]) => c.mark === 'ok').map(([l]) => l);
  assert.deepEqual(locked, ['number']);
  assert.ok(plus.length === 2 && plus.every((l) => table.cells[l].bank.plus.join() === 'number'));
  // 3: the parent's first of the top changes for the SIM swap, named with the words of the screen
  const pvp = C.personaVectors(pa), p3 = pvp.moves.find((mv) => mv.id === pvp.best.simswap);
  assert.ok(M.ja.candidatesHeading.endsWith('上位の手') && M.en.candidatesHeading.startsWith('Top changes'), 'the heading of the candidates');
  // The line under the lockout table as the screen draws it: the SMS requirement names the phone number (lockTagPhone)
  const lockLine = Object.fromEntries(LANGS.map((lang) => [lang, { ...M[lang], tagPhone: M[lang].lockTagPhone }]));
  for (const lang of LANGS) {
    const [c1, c2, c3] = captions(lang), file = FILES[lang], nw = V.names(w, M, lang), np = V.names(pa, M, lang);
    const cell = fill(M[lang].cellPlus1, { p: M[lang].partnerNumber });
    const entrances = V.lockEntrances(pa, 'bank', lockLine, lang)
      .slice(lang === 'ja' ? `${np.full.bank}の入口：`.length : `${np.full.bank}: `.length);
    const title = V.moveTitle(pa, p3, M, lang);
    const want = lang === 'ja' ? [
      [c1, `${M.ja.personWorker}・${M.ja.cardLeak}・段${last}（最後の段）`,
        Array.from({ length: last }, (_, r) => `段${r + 1}で${fell(r + 1).map((id) => nw.short[id]).join('・')}`).join('、')
        + `が倒れ、合わせて${fallen}つ`],
      [c2, M.ja.personParent, np.full.bank, `${locked.map((l) => np.lossColumn[l]).join('と')}の列で×`,
        `${plus.map((l) => np.lossColumn[l]).join('と')}の列で${cell}`, `（${entrances}）`],
      [c3, M.ja.personParent, `${M.ja.modeSimswap}・${TOP_FIRST.ja}「${title}」の前後`],
    ] : [
      [c1, `step ${last}, the last step ("${V.mapCaption(w, 'leak', last, M, 'en')}")`, `${WORDS[fallen]} accounts in all`],
      [c2, np.full.bank, `× in the ${locked.map((l) => np.lossColumn[l]).join(' and ')} column`,
        `${cell} in the ${plus.map((l) => np.lossColumn[l]).join(' and ')} columns`, `(${entrances})`],
      [c3, `"${M.en.modeSimswap}" picked under "${M.en.modeHeading}"`, `${TOP_FIRST.en}, "${title}"`],
    ];
    for (const [caption, ...fragments] of want) {
      for (const fragment of fragments) assert.ok(caption.includes(fragment), `${file}: "${fragment}" in the caption: ${caption}`);
    }
    // Each step of caption 1 names the accounts that fall at that step (the step and its names read together; English names them
    // in running text, each short name whatever its case)
    assertStepsNamed(c1, lang, w, leak, ...STEP_MARKS.caption[lang], `${file}: caption 1`);
  }
});

test('I: the other uses of the use cases, and their limits, are the same lists in both languages; the class example follows the '
  + 'student\'s breach step by step', () => {
  const st = D.personas.find((p) => p.id === 'student'), gives = C.cardGives(st, st.cards.find((c) => c.id === 'leak'));
  const leak = C.stepReach(C.personaGraph(st), gives);
  const LEADS = { ja: ['このツールならではの使い方', 'ほかの使い方', '限界'], en: ['Ways of using this tool in particular', 'Other ways of using it', 'Limits'] };
  const counts = {};
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2Title(lang, '🎯'))), file = FILES[lang];
    const at = LEADS[lang].map((lead) => lines.findIndex((line) => line.trim() === lead));
    assert.ok(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1])), `${file}: the leads ${LEADS[lang].join(', ')} in order`);
    // The items of each list after its lead (up to the next lead)
    const lists = at.map((from, k) => lines.slice(from + 1, k + 1 < at.length ? at[k + 1] : lines.length)
      .filter((line) => /^(?:\d+\.|[-*+]) /.test(line)).map((line) => plain([line.replace(/^(?:\d+\.|[-*+]) /, '')], lang)));
    counts[lang] = lists.map((list) => list.length);
    // The class example: the family the breach card gives the student, and the accounts falling at each step
    const nm = V.names(st, M, lang), example = lists[1].filter((item) => item.includes(nm.tag[gives[0]]));
    assert.equal(example.length, 1, `${file}: one other use names ${nm.tag[gives[0]]}`);
    // Each step names the accounts that fall at that step (the step and its names read together)
    assertStepsNamed(example[0], lang, st, leak, ...STEP_MARKS.example[lang], `${file}: the class example`);
    if (lang === 'ja') assert.ok(example[0].includes(M.ja.personStudent), 'the student named as the screen names her');
  }
  assert.deepEqual(counts.en, counts.ja, 'the same number of uses and limits in both languages');
  assert.ok(counts.ja.every((n) => n > 0));
});

test('I: the lead of the use cases particular to this tool is not a heading in either language', () => {
  assert.ok(!headings('ja').some((h) => h.title.includes('このツールならではの使い方')));
  assert.ok(!headings('en').some((h) => /Ways of using this tool in particular/i.test(h.title)));
});

// The screenshots: three per language, in assets/ for Japanese and assets/en/ for English
const SHOTS = ['screenshot.png', 'screenshot2.png', 'screenshot3.png'];
function imageRefs(lang) {
  const text = prose(lang).join('\n');
  const refs = [...[...text.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
    ...[...text.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]),
    ...[...text.matchAll(/^ {0,3}\[[^\]]+\]:\s*<?(\S+?\.(?:png|jpe?g|gif|svg|webp))>?(?:\s|$)/gim)].map((m) => m[1])];
  return refs.filter((src) => !/^[a-z][a-z0-9+.-]*:/i.test(src)).map((src) => src.replace(/^\.\//, ''));
}
const pngs = (dir) => (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).filter((f) => /\.png$/i.test(f)) : []);
// The chunks of a PNG, each with its CRC checked: a cut or damaged file fails (CRC-32 of the PNG specification)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunks(png, image) {
  const chunks = [];
  let at = 8;
  while (at < png.length) {
    assert.ok(at + 12 <= png.length, image + ': a whole chunk at ' + at);
    const length = png.readUInt32BE(at), type = png.subarray(at + 4, at + 8).toString('latin1');
    assert.ok(at + 12 + length <= png.length, `${image}: the chunk ${type} ends inside the file`);
    assert.equal(png.readUInt32BE(at + 8 + length), crc32(png.subarray(at + 4, at + 8 + length)), `${image}: CRC of ${type} at ${at}`);
    chunks.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return chunks;
}
// The samples per pixel of each PNG color type, and the bit depths that the PNG specification allows for it
const PNG_COLOR = { 0: [1, [1, 2, 4, 8, 16]], 2: [3, [8, 16]], 3: [1, [1, 2, 4, 8]], 4: [2, [8, 16]], 6: [4, [8, 16]] };
// A PNG read down to its image data (no package): the chunks (each CRC), the IHDR (13 bytes: a width and height, a bit depth
// allowed for the color type, compression 0, filter method 0, no interlacing, as the screenshots are saved), one run of IDAT
// chunks whose joined data inflates with node:zlib to exactly one filter byte (0 to 4) and one row of samples per line.
function pngImage(png, image) {
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', image + ': PNG signature');
  const chunks = pngChunks(png, image), types = chunks.map((c) => c.type);
  assert.equal(types[0], 'IHDR', image + ': IHDR first');
  assert.equal(types[types.length - 1], 'IEND', image + ': IEND last');
  assert.equal(types.filter((t) => t === 'IHDR' || t === 'IEND').length, 2, `${image}: one IHDR and one IEND: ${types.join(' ')}`);
  const ihdr = chunks[0].data;
  assert.equal(ihdr.length, 13, image + ': IHDR is 13 bytes');
  const width = ihdr.readUInt32BE(0), height = ihdr.readUInt32BE(4), [depth, color, compression, filter, interlace] = ihdr.subarray(8);
  assert.ok(width > 0 && height > 0, `${image}: ${width} x ${height}`);
  assert.ok(PNG_COLOR[color] && PNG_COLOR[color][1].includes(depth), `${image}: bit depth ${depth} for color type ${color}`);
  assert.deepEqual([compression, filter, interlace], [0, 0, 0], image + ': compression 0, filter method 0, not interlaced');
  if (color === 3) assert.ok(types.indexOf('PLTE') > 0 && types.indexOf('PLTE') < types.indexOf('IDAT'), image + ': PLTE before IDAT');
  const first = types.indexOf('IDAT'), last = types.lastIndexOf('IDAT');
  assert.ok(first > 0 && types.slice(first, last + 1).every((t) => t === 'IDAT'), `${image}: one run of IDAT chunks: ${types.join(' ')}`);
  let data;
  try {
    data = zlib.inflateSync(Buffer.concat(chunks.slice(first, last + 1).map((c) => c.data)));
  } catch (error) {
    assert.fail(`${image}: the IDAT data does not inflate: ${error.message}`);
  }
  const row = Math.ceil((width * PNG_COLOR[color][0] * depth) / 8);
  assert.equal(data.length, height * (1 + row), `${image}: ${height} rows of ${row} bytes, each after its filter byte`);
  const filters = Array.from({ length: height }, (_, y) => data[y * (1 + row)]);
  assert.deepEqual(filters.filter((type) => type > 4), [], image + ': every row has a filter type from 0 to 4');
  return { width, height, depth, color, types };
}
// A small PNG made here (8-bit RGB unless told otherwise) from the data of its one IDAT chunk
function makePng(width, height, idat, color = 2, depth = 8) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4), crc = Buffer.alloc(4), name = Buffer.from(type, 'latin1');
    length.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = color;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

test('I: pngImage reads a PNG made here, and finds IDAT data that does not inflate, rows of the wrong number and a bad filter type', () => {
  // Two pixels of RGB per row, each row after its filter byte
  const rows = (filter, count = 2) => Buffer.concat(Array.from({ length: count }, () => Buffer.from([filter, 1, 2, 3, 4, 5, 6])));
  assert.deepEqual(pngImage(makePng(2, 2, zlib.deflateSync(rows(0))), 'two rows').types, ['IHDR', 'IDAT', 'IEND']);
  assert.throws(() => pngImage(makePng(2, 2, Buffer.from('not the data of a zlib stream')), 'garbage'), /does not inflate/);
  assert.throws(() => pngImage(makePng(2, 2, zlib.deflateSync(rows(0, 1))), 'one row'), /2 rows of 6 bytes/);
  assert.throws(() => pngImage(makePng(2, 2, zlib.deflateSync(rows(5))), 'filter 5'), /filter type from 0 to 4/);
  assert.throws(() => pngImage(makePng(2, 2, zlib.deflateSync(rows(0)), 2, 4), 'depth 4'), /bit depth 4 for color type 2/);
});

test('I: the images: every reference exists in the order of the tabs, each PNG in assets/ is used by its README, and the six PNGs '
  + 'decode (CRC of every chunk, the IHDR, the IDAT data inflated into rows with filter types 0 to 4), are different and fit the '
  + 'README width', () => {
  for (const lang of LANGS) {
    const refs = imageRefs(lang), file = FILES[lang];
    for (const ref of refs) assert.ok(fs.existsSync(path.join(root, ref)) && fs.statSync(path.join(root, ref)).isFile(), file + ': ' + ref);
    const own = SHOTS.map((name) => 'assets/' + (lang === 'en' ? 'en/' : '') + name);
    assert.deepEqual(refs, own, file + ': the screenshots of its language, once each, in the order of the tabs');
  }
  assert.deepEqual(pngs('assets').map((f) => 'assets/' + f).filter((f) => !imageRefs('ja').includes(f)), [],
    'every PNG directly in assets/ is used by README.md');
  assert.deepEqual(pngs('assets/en').map((f) => 'assets/en/' + f).filter((f) => !imageRefs('en').includes(f)), [],
    'every PNG in assets/en/ is used by README.en.md');
  const hashes = new Set();
  for (const image of [...SHOTS.map((n) => 'assets/' + n), ...SHOTS.map((n) => 'assets/en/' + n)]) {
    const png = fs.readFileSync(path.join(root, image));
    const { width, height } = pngImage(png, image);
    assert.equal(width, 808, image + ': width ' + width);
    assert.ok(height >= 1 && height <= 1100, image + ': height ' + height);
    assert.ok(png.length <= 300000, image + ': ' + png.length + ' bytes');
    hashes.add(crypto.createHash('sha256').update(png).digest('hex'));
  }
  assert.equal(hashes.size, SHOTS.length * 2, 'six different images');
});

// The README form of the series: each screenshot is shown on its own with a caption of one line in the form "> *…*" right after it
// (the image may stand alone or inside the same quotation, as in ">![…](…)", ">", ">*…*")
// The tabs the three screenshots show, in order; each caption starts with the name of its tab
const SHOT_TABS = ['tabChain', 'tabLockout', 'tabCompare'];
// The captions of the screenshots of a README, in order, as they read (without "> *" and "*")
function captions(lang) {
  const empty = (line) => /^>?\s*$/.test(line.trim());
  const lines = bodyOf(lang, section(lang, h2Title(lang, '📸'))), file = FILES[lang];
  const images = lines.map((line, i) => [line.trim(), i]).filter(([line]) => /^>?\s*!\[[^\]]*\]\([^)\s]+\.png\)$/.test(line));
  assert.equal(images.length, SHOTS.length, file + ': one image line per screenshot');
  return images.map(([line, i]) => {
    let j = i + 1;
    while (j < lines.length && empty(lines[j])) j++;
    const caption = (lines[j] || '').trim();
    assert.match(caption, /^> ?\*[^*\s](?:[^*]*[^*\s])?\*$/, `${file}: the caption after ${line}`);
    assert.ok(j + 1 >= lines.length || empty(lines[j + 1]), `${file}: the caption after ${line} is one line`);
    return caption.replace(/^> ?\*/, '').replace(/\*$/, '');
  });
}

test('I: each screenshot of both READMEs has a one-line caption "> *…*" right after the image, starting with the name of its tab', () => {
  for (const lang of LANGS) {
    captions(lang).forEach((caption, k) => {
      const head = M[lang][SHOT_TABS[k]] + (lang === 'ja' ? '：' : ': ');
      assert.ok(caption.startsWith(head), `${FILES[lang]}: caption ${k + 1} starts with "${head}": ${caption}`);
    });
  }
});

// The tree of the spec: the part of each line before the explanation, in order
const TREE = ['account-domino-mapper/', '|-- .gitattributes', '|-- .github/', '|   `-- workflows/', '|       `-- test.yml', '|-- LICENSE',
  '|-- README.md', '|-- README.en.md', '|-- index.html', '|-- style.css', '|-- theme-init.js', '|-- domino-core.js', '|-- domino-data.js',
  '|-- domino-view.js', '|-- messages.js', '|-- app.js', '|-- package.json', '|-- assets/', '|   |-- screenshot.png',
  '|   |-- screenshot2.png', '|   |-- screenshot3.png', '|   `-- en/', '|       |-- screenshot.png', '|       |-- screenshot2.png',
  '|       `-- screenshot3.png', '`-- test/', '    |-- core.test.js', '    |-- view.test.js', '    |-- text.test.js',
  '    |-- structure.test.js', '    |-- i18n.test.js', '    |-- format.test.js', '    |-- contrast.test.js', '    |-- theme-init.test.js',
  '    |-- readme.test.js', '    |-- sample.json', '    |-- vectors.json', '    |-- interface.browser.py', '    `-- startup.browser.py'];
// The files and folders of the repository; only .git (a folder, or a file in a linked work tree) is left out
function walk(dir = root, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.name !== '.git').flatMap((entry) => {
    const relative = prefix + entry.name;
    return entry.isDirectory() ? [relative + '/', ...walk(path.join(dir, entry.name), relative + '/')] : [relative];
  });
}
// The paths named by the tree lines (folders end with /)
function treePaths(lines) {
  const stack = [];
  return lines.slice(1).map((line) => {
    const m = line.match(/^((?:\| {3}| {4})*)(?:\|--|`--) (\S+)$/);
    assert.ok(m, 'tree line: ' + line);
    stack.length = m[1].length / 4;
    const full = [...stack, m[2]].join('/');
    if (m[2].endsWith('/')) stack.push(m[2].slice(0, -1));
    return full;
  });
}

test('I: both directory trees: an explanation on every line, the lines of the spec in order, and exactly the files of the repository',
  () => {
    assert.equal(TREE[0], SLUG + '/');
    assert.deepEqual(treePaths(TREE).sort(), walk().sort(), 'the tree of the spec and the files of the repository');
    for (const lang of LANGS) {
      const s = section(lang, h2Title(lang, '📁')), raw = doc(lang).split('\n').slice(s.from, s.to).join('\n'), file = FILES[lang];
      const fences = [...raw.matchAll(/^```[^\n]*\n([\s\S]*?)\n```[ \t]*$/gm)];
      assert.equal(fences.length, 1, file + ': one code block in the directory section');
      const lines = fences[0][1].split('\n').filter((line) => line.trim());
      const parts = lines.map((line) => {
        const m = line.match(/^(.*?\S)\s+# (\S.*)$/);
        assert.ok(m, `${file}: an explanation after "# " (one space) on the tree line: ${line}`);
        return m[1];
      });
      assert.deepEqual(parts, TREE, file + ': the tree lines and their order');
    }
  });

const HUB = {
  ja: 'ツールの一覧と学習の入口は、[ハッキング・ラボ・オンライン](https://hackinglab.online/)にまとめています。',
  en: 'All tools in the series are listed on [Hacking Lab Online](https://hackinglab.online/).',
};

test('I: the about section of both READMEs links the series page and ends with the line to the hub', () => {
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2Title(lang, '🛠️'))).filter((line) => line.trim()), file = FILES[lang];
    assert.equal(lines[lines.length - 1].trim(), HUB[lang], file + ': the last line of the about section');
    assert.ok(lines.join('\n').includes('https://akademeia.info/?page_id=44607'), file + ': the page of the series');
  }
});

const SECURITY = {
  ja: ['使い回しの情報は、パスワードそのものがなくても攻撃者の役に立ちうるものとして扱われています（MozillaのPassword Reuse Visualizerのwiki）。'
    + 'アカウントのつながりの形そのものを、パスワードとは別に守る対象とする道具もあります（LatticeのREADME）。'
    + 'このため、画面には本物の構成を入れる欄を置かず、自分の構成は印刷した用紙に記号で書く形にしました。',
  '公開ページの読み込みと、出典へのリンクを開く操作には通常の通信が発生します。入力を送る機能はありません（入力欄もありません）。'],
  // The quotations of the sources, the conclusion drawn from them (the same as the Japanese third sentence: no fields for real
  // setups, your own setup written in symbols on a printed sheet) and the paragraph on requests
  en: ['Password reuse data, even if unaccompanied by actual passwords or password hashes, can be of use to attackers.',
    'The graph topology (which nodes connect to which) is treated as sensitive on its own, not just individual passwords.',
    'the screen has no fields for real setups', 'your own setup is written in symbols on a printed sheet',
    'Loading the published page and opening source links involve normal network requests. The tool has no feature that sends '
      + 'anything you enter, and there are no input fields.'],
};
const SCRIPT_FILES = fs.readdirSync(root).filter((f) => f.endsWith('.js'));

test('I: the security section gives the reason for keeping real setups out, with its sources, and the paragraph on requests; '
  + 'its CSP and storage keys are those of the page', () => {
  const csp = fs.readFileSync(path.join(root, 'index.html'), 'utf8').match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)[1];
  const stored = [...new Set(SCRIPT_FILES.flatMap((f) => [...fs.readFileSync(path.join(root, f), 'utf8')
    .matchAll(/localStorage\.setItem\(\s*'([^']+)'/g)].map((m) => m[1])))].sort();
  assert.equal(stored.length, 2, 'the two storage keys of the scripts');
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2Title(lang, '🔒'))), text = plain(lines, lang), file = FILES[lang];
    // The English quotes keep the emphasis of the original (*topology*); the marks are not compared
    const read = lang === 'en' ? text.replace(/[*_]/g, '') : text;
    for (const sentence of SECURITY[lang]) assert.ok(read.includes(sentence), file + ': ' + sentence);
    assert.match(text, /Mozilla/);
    assert.match(text, /Lattice/);
    const codes = [...lines.join('\n').matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
    assert.deepEqual(codes.filter((code) => /default-src/.test(code)), [csp], file + ': the CSP of index.html');
    assert.deepEqual([...new Set(codes.filter((code) => /^account-domino-mapper\./.test(code)))].sort(), stored, file + ': the storage keys');
  }
});

test('I: the Node.js version named in both READMEs is the one of package.json', () => {
  const engine = require('../package.json').engines.node.match(/^>=(\d+)$/)[1];
  for (const lang of LANGS) {
    const named = [...doc(lang).matchAll(/\bNode(?:\.js)?\s*(\d+)/g)].map((m) => m[1]);
    assert.ok(named.length >= 2, FILES[lang] + ': Node.js named in the tests and the requirements');
    assert.deepEqual([...new Set(named)], [engine], FILES[lang] + ': Node.js ' + named.join(', '));
  }
});

const ABSENT = {
  ja: 'この組み合わせを持つ教材は、2026-10-29にGitHubの検索とWeb検索で調べた範囲（主な検索語：account access graph、account dependency mapping、'
    + 'account recovery graph、identity dependency graph、account lockout drill、phone number dependency accounts、account takeover simulator、'
    + 'アカウント 乗っ取り 連鎖 可視化）では見当たりませんでした。',
  en: 'No teaching aid with this combination was found in GitHub and web searches on 2026-10-29 (main search terms: account access graph, '
    + 'account dependency mapping, account recovery graph, identity dependency graph, account lockout drill, phone number dependency '
    + 'accounts, account takeover simulator, and one Japanese query for account takeover chain visualization).',
};
// Prior work of the spec (the eleven rows of the table and the tools named with Maat) and the related tools
const PRIOR = ['Hammann', 'DIVINA', 'DepAuth', 'lnschroeder', 'Account Access Graphs', 'PyTac', 'AAG Analyser', 'Karafili', 'Firebreak',
  'Number Exit Kit', 'Lockout Drill', 'Maat', 'Continuum', 'BLAST RADIUS', 'DominoGuard'];
// The eleven rows of the prior-work table of the spec, in order: the names in the first cell of each row
const PRIOR_ROWS = [['Hammann', 'ETH'], ['DIVINA'], ['DepAuth'], ['lnschroeder', 'Account Access Graphs'], ['PyTac'], ['AAG Analyser'],
  ['Karafili'], ['Firebreak'], ['Number Exit Kit'], ['Lockout Drill'], ['Maat']];
const MAAT_LIKE = ['Continuum', 'BLAST RADIUS', 'DominoGuard'];
const RELATED = [['Intrusion Path Mapper', 'intrusion-path-mapper'], ['Password Checker', 'password-checker'], ['PassCloud', 'passcloud'],
  ['Reverse Brute-force Demo', 'reverse-bruteforce-demo'], ['PatternLock Security Trainer', 'patternlock-security-trainer'],
  ['PIN Threat Simulator', 'pin-threat-simulator'], ['Scatter Seeds', 'scatter-seeds'], ['Overlay QR Shares', 'overlay-qr-shares']];
// The sentence of the spec on what can be said of the earlier work (Japanese with 「」 for the 『』 of the spec)
const EARLIER = {
  ja: 'アカウントの依存を「かつ・または」の規則で表す研究（Hammannら、CCS 2019／Ismailら、DIVINA 2015）、いちばん弱い部品で強さを測り対策の前後を'
    + '比べる推論器（Karafiliら、ETAA 2018）、自分の構成を描く道具（DepAuth、lnschroederのAccount Access Graphs、Firebreak、Lockout Drillなど）は'
    + 'すでにあります。本ツールは、その形式を、架空の3人と攻撃カードで体験する日英の教材にしたものです。入口を1つ変えたときに、攻撃の広がりと本人の閉め出し'
    + 'がどう変わるかを、同じ画面で前後に並べます。',
  en: 'Earlier work already exists: research that models account dependencies with AND/OR rules (Hammann et al., CCS 2019; Ismail et al., '
    + 'DIVINA, 2015), a reasoner that measures strength by the weakest component and compares countermeasures before and after (Karafili '
    + 'et al., ETAA 2018), and tools that map your own setup, such as DepAuth, lnschroeder\'s Account Access Graphs, Firebreak and Lockout '
    + 'Drill. This tool turns that formalism into a Japanese/English teaching aid with three fictional people and attack cards, and shows '
    + 'side by side how changing one entrance affects both the attack\'s spread and the owner\'s lockout.',
};
// The DOIs of the prior work of the spec that are not sources of the lessons (the ETH tool, DIVINA, Karafili et al., Jin et al.)
const PRIOR_DOIS = ['10.5905/ethz-1007-306', '10.1145/2740908.2742836', '10.1007/978-3-030-04372-8_7', '10.1109/DSN-W52860.2021.00013'];
// The markdown tables of some lines: the header cells and the rows of cells after the delimiter row
function tablesIn(lines) {
  const tables = [];
  let current = null;
  for (const line of [...lines, '']) {
    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
      if (!current) current = { header: cells, rows: [], delimiter: false };
      else if (!current.delimiter) current.delimiter = cells.every((cell) => /^:?-{3,}:?$/.test(cell));
      else current.rows.push(cells);
    } else if (current) {
      tables.push(current);
      current = null;
    }
  }
  return tables;
}
// The links to https://doi.org/ in a text: the text of the link and the DOI (a DOI may hold parentheses, as 0743-1066(84)90014-1)
function doiLinks(text) {
  return [...text.matchAll(/\[([^\]]*)\]\(https:\/\/doi\.org\//g)].map((m) => {
    let doi = '', depth = 0;
    for (const ch of text.slice(m.index + m[0].length)) {
      if (/\s/.test(ch) || (ch === ')' && depth === 0)) break;
      depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
      doi += ch;
    }
    return { text: m[1], doi };
  });
}

test('I: the references give the dated absence sentence with its search terms, the prior work and the related tools', () => {
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2Title(lang, '🔗'))), text = plain(lines, lang), raw = lines.join('\n'), file = FILES[lang];
    assert.ok(text.includes(ABSENT[lang]), file + ': ' + ABSENT[lang]);
    for (const name of PRIOR) assert.ok(text.includes(name), file + ': prior work ' + name);
    for (const [name, route] of RELATED) {
      assert.ok(text.includes(name), file + ': related tool ' + name);
      assert.ok(raw.includes('(https://ipusiron.github.io/' + route + '/)'), file + ': link to ' + route);
    }
  }
});

test('I: the references keep the prior-work table of the spec, its fixed sentences, and the related tools of lesson 10', () => {
  for (const lang of LANGS) {
    const lines = bodyOf(lang, section(lang, h2Title(lang, '🔗'))), text = plain(lines, lang), file = FILES[lang];
    const tables = tablesIn(lines);
    // The eleven rows of the prior work, in the order of the spec, each with a link; the Maat row names its kin
    const prior = tables[0];
    assert.equal(prior.header.length, 3, file + ': the prior-work table has three columns');
    assert.equal(prior.rows.length, PRIOR_ROWS.length, file + ': the eleven rows of the prior work');
    prior.rows.forEach((row, k) => {
      for (const name of PRIOR_ROWS[k]) assert.ok(row[0].includes(name), `${file}: prior-work row ${k + 1} names ${name}: ${row[0]}`);
      assert.match(row[0], /\]\(https:\/\//, `${file}: prior-work row ${k + 1} links its source`);
    });
    for (const name of MAAT_LIKE) assert.ok(prior.rows[PRIOR_ROWS.length - 1][1].includes(name), `${file}: the Maat row names ${name}`);
    // DepAuth: what the owner cannot reach are accounts (the lockout); "cards" are the attack cards of this teaching aid
    if (lang === 'en') assert.ok(prior.rows[2][1].includes('unreachable accounts (lockout)'), `${file}: DepAuth: ${prior.rows[2][1]}`);
    // The comparison with Day083 is the first paragraph of lesson 10 on the screen; the sentence on the earlier work is the spec's
    assert.ok(text.includes(M[lang].lesson10Text1), file + ': the comparison with Day083 (lesson 10): ' + M[lang].lesson10Text1);
    assert.ok(text.includes(EARLIER[lang]), file + ': ' + EARLIER[lang]);
    assert.match(text, /SentiNet/, file + ': SentiNet, below the table');
    assert.ok(text.includes(PRIOR_DOIS[3]), file + ': the DOI of Jin et al.');
    // The related tools: the rows of lesson 10 (name, page and what it teaches), in its order
    const related = tables.find((table) => table.header[0] === M[lang].lesson10ColTool);
    assert.ok(related, file + ': the table of related tools');
    assert.deepEqual(related.header, [M[lang].lesson10ColTool, M[lang].lesson10ColLearn], file + ': the related tools columns');
    assert.deepEqual(related.rows, V.relatedTools.map((tool) => [`[${M[lang][tool.name]}](${tool.href})`, M[lang][tool.learn]]),
      file + ': the related tools of lesson 10');
    // Under them, the second paragraph of lesson 10 word for word: the checkups of other tools in the words of the screen
    assert.ok(text.includes(M[lang].lesson10Text2), file + ': the second paragraph of lesson 10: ' + M[lang].lesson10Text2);
  }
});

test('I: every source of the lessons is linked in both READMEs, and every DOI link goes to a source of the spec with its own DOI', () => {
  const lessonDois = Object.values(V.lessonRefs).filter((href) => href.startsWith('https://doi.org/')).map((href) => href.slice(16));
  for (const lang of LANGS) {
    const text = prose(lang).join('\n'), file = FILES[lang];
    for (const [key, href] of Object.entries(V.lessonRefs)) assert.ok(text.includes(`](${href})`), `${file}: the source ${key} ${href}`);
    const links = doiLinks(text);
    assert.ok(links.length >= lessonDois.length + PRIOR_DOIS.length, file + ': the DOI links');
    for (const link of links) {
      assert.ok([...lessonDois, ...PRIOR_DOIS].includes(link.doi), `${file}: a DOI of the spec: ${link.doi}`);
      if (/^10\./.test(link.text)) assert.equal(link.text, link.doi, `${file}: the text of the link is its DOI`);
    }
    for (const doi of PRIOR_DOIS) assert.ok(links.some((link) => link.doi === doi), `${file}: the prior work ${doi}`);
  }
});

// Japanese letters and the full-width marks (、。「」（）：＋ and the like)
const JA_WIDE = '[\\u3000-\\u303f\\u3040-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uff00-\\uffef]';

test('I: README.md has no half-width space between Japanese (or a full-width mark) and Latin letters, digits or code (front matter, '
  + 'code blocks and URLs aside)', () => {
  const pattern = new RegExp(`${JA_WIDE} +[A-Za-z0-9]|[A-Za-z0-9] +${JA_WIDE}`);
  const found = [];
  prose('ja').forEach((line, i) => {
    // Inline code, HTML and URLs stand for one Latin letter, so that a space next to them counts as well
    const body = line.replace(/`[^`\n]*`/g, 'x').replace(/\]\([^)]*\)/g, ']').replace(/<[^>]*>/g, 'x')
      .replace(/https?:\/\/[^\s)>\]]+/g, 'x');
    const m = body.match(pattern);
    if (m) found.push(`README.md:${i + 1}: "${m[0]}" in ${line.trim().slice(0, 80)}`);
  });
  assert.deepEqual(found, [], 'spaces between Japanese and Latin letters or digits:\n' + found.join('\n'));
});

test('I: emphasis stays rare: at most two bold spans per section (the opening counts the series line), and no bold item names', () => {
  for (const lang of LANGS) {
    const lines = prose(lang), file = FILES[lang];
    const blocks = [{ title: 'the opening', from: 0, to: firstH2(lang) }, ...sections(lang)];
    const counts = blocks.map((b) => {
      const marks = (lines.slice(b.from, b.to).join('\n').replace(/`[^`\n]*`/g, '').match(/\*\*/g) || []).length;
      return [b.title, Math.ceil(marks / 2)];
    });
    for (const [title, spans] of counts) assert.ok(spans <= 2, `${file}: ${spans} bold spans in ${title}`);
    const bold = lines.map((line, i) => [line, i]).filter(([line]) => /^\s*(?:[-*+]|\d+\.)\s+\*\*/.test(line));
    assert.deepEqual(bold.map(([line, i]) => `${file}:${i + 1}: ${line}`), [], file + ': list items do not start with bold');
  }
});

test('I: README.en.md has no Japanese letter or full-width mark outside its first line (code blocks and tables included)', () => {
  const wide = new RegExp(JA_WIDE);
  const found = doc('en').split('\n').map((line, i) => [line, i]).filter(([line, i]) => i > 0 && wide.test(line));
  assert.deepEqual(found.map(([line, i]) => `README.en.md:${i + 1}: ${line}`), []);
  assert.match(doc('en').split('\n')[0], JA_CHAR, 'the first line links README.md by its Japanese name');
});

test('I: both READMEs use the words of the screen: the four tabs and the three people as messages.js names them', () => {
  const keys = ['tabChain', 'tabLockout', 'tabCompare', 'tabRules', 'personWorker', 'personParent', 'personStudent'];
  for (const lang of LANGS) {
    const text = plain(prose(lang), lang);
    for (const key of keys) assert.ok(text.includes(M[lang][key]), `${FILES[lang]}: ${key} "${M[lang][key]}"`);
  }
});

test('I: the test section names npm test and Node.js 22, and no README writes results into the repository', () => {
  for (const lang of LANGS) {
    const text = bodyOf(lang, section(lang, h2Title(lang, '🧪'))).join('\n');
    assert.match(text, /npm test/, FILES[lang]);
    assert.match(text, /Node(?:\.js)?\s*22/, FILES[lang]);
    assert.doesNotMatch(doc(lang), /\.work\b/, FILES[lang]);
  }
});
