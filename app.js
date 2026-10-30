/* Account Domino Mapper - MIT (c) 2026 ipusiron. */
(function () {
  'use strict';
  const PREFIX = 'account-domino-mapper.';
  const $ = (id) => document.getElementById(id);
  const stored = (key) => {
    try { return localStorage.getItem(PREFIX + key); } catch (_) { return null; }
  };
  const validLanguage = (value) => (['ja', 'en'].includes(value) ? value : null);
  const queryLanguage = validLanguage(new URLSearchParams(location.search).get('lang'));
  const Core = DominoCore;
  const Data = DominoData;
  const View = DominoView;
  const Messages = DominoMessages;

  const PERSONAS = ['worker', 'parent', 'student'];
  const PERSON_KEYS = { worker: 'personWorker', parent: 'personParent', student: 'personStudent' };
  const STORY_KEYS = { worker: 'storyWorker', parent: 'storyParent', student: 'storyStudent' };
  const DEFAULT_ACCOUNT = { worker: 'mailMain', parent: 'bank', student: 'sec' };
  const TABS = ['chain', 'lockout', 'compare', 'rules'];
  const CARDS = ['leak', 'simswap', 'mail', 'desk'];
  const CARD_KEYS = { leak: 'cardLeak', simswap: 'cardSimswap', mail: 'cardMail', desk: 'cardDesk' };
  const CARD_SHORT_KEYS = { leak: 'fourCardsColLeak', simswap: 'fourCardsColSimswap', mail: 'fourCardsColMail', desk: 'fourCardsColDesk' };
  const MODES = [...CARDS, 'all', 'lockout'];
  const PHASES = ['before', 'after'];
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PLAY_INTERVAL = 900;

  // personaVectors is computed once per person and kept (language and theme changes only redraw).
  const vectorsCache = new Map();
  const persona = (id) => Data.personas.find((p) => p.id === id);
  function vectorsFor(id) {
    if (!vectorsCache.has(id)) vectorsCache.set(id, Core.personaVectors(persona(id)));
    return vectorsCache.get(id);
  }
  // The diagram coordinates depend on the person and the language only.
  const layoutCache = new Map();
  function layoutFor(id, language) {
    const key = id + '|' + language;
    if (!layoutCache.has(key)) layoutCache.set(key, View.layout(persona(id), null, Messages, language));
    return layoutCache.get(key);
  }
  // Tab 3: the steps and backdoors after a change are computed with the person after it (no personaVectors here), once
  // per person, change and card; the diagram before and after a change once per person, change and language.
  const afterCache = new Map();
  function afterFor(id, moveId, card) {
    const key = id + '|' + moveId + '|' + card;
    if (!afterCache.has(key)) afterCache.set(key, View.afterMap(persona(id), moveId, card));
    return afterCache.get(key);
  }
  const afterLayoutCache = new Map();
  function afterLayoutFor(id, moveId, language, q) {
    const key = id + '|' + moveId + '|' + language;
    if (!afterLayoutCache.has(key)) afterLayoutCache.set(key, View.layout(persona(id), q, Messages, language));
    return afterLayoutCache.get(key);
  }

  const state = {
    language: queryLanguage || validLanguage(stored('language')) || (navigator.language.startsWith('ja') ? 'ja' : 'en'),
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    tab: 'chain',
    persona: 'worker',
    card: 'leak',
    step: 0,
    account: DEFAULT_ACCOUNT.worker,
    mode: 'all',
    move: null,
    mapPhase: 'after',
    playing: false
  };
  // The short message under the person band; kept as a key so that it can follow the language.
  let announcement = null;
  let playTimer = null;

  const t = (key, values = {}) => (Messages[state.language][key] ?? key)
    .replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => String(values[name] ?? '{' + name + '}'));
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const narrowScreen = () => matchMedia('(max-width: 719px)').matches;
  const lastStep = () => View.lastStep(vectorsFor(state.persona), state.card);

  function saveLanguage() {
    try {
      localStorage.setItem('account-domino-mapper.language', state.language);
    } catch (_) { /* Preferences are optional. */ }
  }
  function saveTheme() {
    try {
      localStorage.setItem('account-domino-mapper.theme', state.theme);
    } catch (_) { /* Preferences are optional. */ }
  }

  // ===== Building elements (text only; no HTML strings) =====
  function E(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null || value === undefined || value === false) continue;
      if (name === 'class') element.className = value;
      else element.setAttribute(name, value === true ? '' : String(value));
    }
    for (const child of children.flat(Infinity)) if (child !== null && child !== undefined && child !== false) element.append(child);
    return element;
  }
  function S(tag, attributes = {}, text) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== null && value !== undefined) element.setAttribute(name, String(value));
    }
    if (text !== undefined) element.textContent = text;
    return element;
  }
  // Japanese words stay together where a box wraps (word-break: keep-all in style.css): a line breaks only at a <wbr>,
  // put after a particle before the next word, between katakana and kanji, before an opening bracket, after a closing
  // bracket and after ：＋＝／→・、, but never before a mark that may not start a line (、。・：）」ー, small kana and the
  // like) nor before ＋＝／→ (or a mark in `keep`). A name such as 古いメール stays whole.
  // keep-all holds only letters and numbers together, so a piece between two <wbr> that holds one of these marks goes out
  // in one nowrap span: in "番号か＋プロバイダーのメール" the ＋ is never left alone on a line of a narrow cell. The printed
  // lockout cells keep "で×）" together that way; the 390px screen has no room for that.
  // Text without Japanese comes back as it is (English breaks at its spaces).
  const PARTICLES = 'のでをにがはとかもへや';
  const NO_LINE_START = '、。，．・：；？！ー）」』】〕ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ';
  const JOINED = '＋＝／→';
  const scriptOf = (ch) => (/[\u30a0-\u30ff]/.test(ch) ? 'katakana' : /[\u3400-\u4dbf\u4e00-\u9fff]/.test(ch) ? 'kanji'
    : /[\u3040-\u309f]/.test(ch) ? 'hiragana' : 'other');
  function phrases(text, keep = '') {
    const joined = JOINED + keep;
    const chars = [...text], out = [];
    let piece = '';
    const flush = () => {
      const marked = [...piece].slice(1).some((ch) => joined.includes(ch)) && !/\s/.test(piece);
      out.push(marked ? E('span', { class: 'joined' }, piece) : piece);
      piece = '';
    };
    chars.forEach((ch, i) => {
      piece += ch;
      const next = chars[i + 1];
      if (next === undefined || NO_LINE_START.includes(next) || joined.includes(next)) return;
      const pair = scriptOf(ch) + '>' + scriptOf(next);
      if ((PARTICLES.includes(ch) && scriptOf(next) !== 'hiragana') || pair === 'katakana>kanji' || pair === 'kanji>katakana'
        || (next === '（' && ch !== ' ') || ch === '）' || '：＋＝／→・、'.includes(ch)) {
        flush();
        out.push(E('wbr'));
      }
    });
    if (piece) flush();
    return out;
  }
  // A symbol is hidden from screen readers and a sentence is read instead.
  const symbol = (text, sr) => [E('span', { 'aria-hidden': 'true' }, text), E('span', { class: 'visually-hidden' }, sr)];
  // ★n inside a sentence: the star is hidden and "n important" is read.
  function withStars(text) {
    const parts = [];
    let last = 0;
    for (const m of text.matchAll(/★(\d+)/g)) {
      parts.push(text.slice(last, m.index), ...symbol(m[0], t('srImportantCount', { imp: m[1] })));
      last = m.index + m[0].length;
    }
    parts.push(text.slice(last));
    return parts;
  }
  // The step line and the summary keep Japanese words together like the tables (word-break: keep-all in style.css)
  const phraseStars = (text) => withStars(text).flatMap((part) => (typeof part === 'string' ? phrases(part) : [part]));
  // The content of a table cell, caption or heading: its text (also inside an array) gets the <wbr> of phrases(), so that
  // a Japanese word stays whole in every table (word-break: keep-all in style.css); elements are kept as they are
  const words = (content) => (typeof content === 'string' ? phrases(content) : Array.isArray(content) ? content.map(words) : content);
  const readable = (text) => text.replace(/★(\d+)/g, (_, n) => t('srImportantCount', { imp: n }));
  // ★ and × inside the effect lines and the same-entrance cells of tab 3: the mark is hidden and a word is read instead
  const marked = (text) => text.split(/([★×])/).filter(Boolean)
    .map((part) => (part === '★' ? symbol('★', t('srImportant') + ' ') : part === '×' ? symbol('×', t('srLockMark') + ' ') : part));
  function nameButton(row, key, pressed, onClick) {
    const button = E('button', { type: 'button', class: 'name-button', 'data-key': key, 'aria-pressed': String(pressed) },
      row.important ? symbol('★', t('srImportant') + ' ') : null, phrases(row.name));
    button.addEventListener('click', onClick);
    return button;
  }
  // Button labels with ▶ or ■: the symbol is hidden from screen readers.
  function setLabel(button, text) {
    button.replaceChildren(...text.split(/([▶■])/).filter(Boolean)
      .map((part) => (/^[▶■]$/.test(part) ? E('span', { 'aria-hidden': 'true' }, part) : part)));
  }

  // ===== Person band and tabs =====
  function renderPersons() {
    for (const id of PERSONAS) $('person-' + id).setAttribute('aria-pressed', String(id === state.persona));
    const counts = View.counts(persona(state.persona));
    $('person-counts').textContent = t('personCounts', { n: counts.accounts, f: counts.families });
    let text = '';
    if (announcement && announcement.person) text = t(announcement.key, { person: t(PERSON_KEYS[announcement.person]) });
    if (announcement && announcement.highlight) {
      const h = View.highlights.find((x) => x.id === announcement.highlight);
      text = t('statusHighlight', { title: View.highlightTitle(h, vectorsFor(h.person), Messages, state.language) });
    }
    if ($('person-status').textContent !== text) $('person-status').textContent = text;
  }
  function renderTabs() {
    for (const name of TABS) {
      const selected = name === state.tab;
      const tab = $('tab-' + name);
      // A tab name wraps only between its words (for example 1手で／比べる on a 320px screen)
      tab.replaceChildren(...phrases(t(tab.dataset.i18n)));
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $('panel-' + name).hidden = !selected;
    }
  }

  // ===== Tab 1: follow the chain =====
  function renderHighlights(pv) {
    const items = View.highlights.filter((h) => h.person === state.persona).map((h) => {
      const button = E('button', { type: 'button', class: 'highlight-button', 'data-key': 'hl:' + h.id },
        View.highlightTitle(h, pv, Messages, state.language));
      button.addEventListener('click', () => pressHighlight(h));
      return E('div', { class: 'highlight-item' }, h.id === 'W1' ? E('span', { class: 'start-tag' }, t('startTag')) : null, button);
    });
    $('highlights').replaceChildren(...items);
  }
  function renderSteps(last) {
    const edge = (id, atEdge) => {
      if (atEdge) $(id).setAttribute('aria-disabled', 'true'); else $(id).removeAttribute('aria-disabled');
    };
    setLabel($('step-first'), t('stepFirst'));
    setLabel($('step-next'), t('stepNext'));
    setLabel($('step-last'), t('stepLast'));
    setLabel($('step-play'), t(state.playing ? 'stop' : 'play'));
    edge('step-first', state.step === 0);
    edge('step-next', state.step >= last);
    edge('step-last', state.step >= last);
    $('step-play').setAttribute('aria-pressed', String(state.playing));
  }
  // The diagram (wide screens only; CSS hides it below 720px). Drawn in order: lines, credential boxes, account cards, marks.
  // It is built once per person and language; a step or a card only changes the classes, the marks and the two texts,
  // so that the border colors of the accounts that fall change with the CSS transition.
  // phase (tab 3 only): 'before' draws the person before the change (without the credentials the change adds), 'after' the
  // person after it (a removed entrance keeps its place but is not drawn). The changed entrance gets a dotted border and
  // "changed" under its text.
  function buildMap(L, prefix, phase = null) {
    const svg = S('svg', { class: 'map-svg', role: 'img', 'aria-labelledby': prefix + '-svg-title', 'aria-describedby': prefix + '-svg-desc',
      width: L.width, height: L.height, viewBox: '0 0 ' + L.width + ' ' + L.height });
    svg.append(S('title', { id: prefix + '-svg-title' }), S('desc', { id: prefix + '-svg-desc' }));
    const lines = S('g', { class: 'map-lines' });
    for (const line of phase === 'before' ? L.linesBefore : L.lines) {
      lines.append(S('path', { d: line.d, class: 'map-line ' + line.role, 'data-from': line.from, 'data-to': line.to }));
    }
    const boxes = S('g', { class: 'map-boxes' });
    for (const id of L.columns[0]) {
      const b = L.box[id];
      if (phase === 'before' && b.added) continue;
      const group = S('g', { class: 'map-item', 'data-node': id });
      group.append(S('title', {}, b.title));
      group.append(S('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'map-box' }));
      if (b.band) group.append(S('rect', { x: b.x, y: b.y, width: 4, height: b.h, class: 'map-band fam-' + b.family }));
      for (const line of b.lines) group.append(S('text', { x: line.x, y: line.y, class: 'map-text' }, line.value));
      boxes.append(group);
    }
    const cards = S('g', { class: 'map-cards' });
    for (const ids of L.columns.slice(1)) {
      for (const id of ids) {
        const c = L.box[id];
        const group = S('g', { class: 'map-item', 'data-node': id });
        group.append(S('title', {}, c.title));
        group.append(S('rect', { x: c.x, y: c.y, width: c.w, height: c.h, class: 'map-card' }));
        for (const line of c.lines) group.append(S('text', { x: line.x, y: line.y, class: 'map-text map-head' }, line.value));
        for (const key of c.rows) {
          const r = L.rows[key];
          const text = phase === 'after' ? r.after : r.before;
          if (!text) continue;
          group.append(S('line', { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y, class: 'map-divider' }));
          const row = S('g', { class: 'map-row', 'data-row': key });
          if (text.title) row.append(S('title', {}, text.title));
          for (const line of text.lines) row.append(S('text', { x: line.x, y: line.y, class: 'map-text map-row-text' }, line.value));
          group.append(row);
          if (phase && r.changed) {
            const change = S('g', { class: 'map-change', 'data-row': key });
            change.append(S('rect', { x: r.x + 3, y: r.y + 2, width: r.w - 6, height: r.h - 4, class: 'changed' }),
              S('text', { x: r.tag.x, y: r.tag.y, 'text-anchor': 'end', class: 'map-text map-tag' }, t('changedTag')));
            group.append(change);
          }
        }
        cards.append(group);
      }
    }
    svg.append(lines, boxes, cards, S('g', { class: 'map-marks' }));
    return svg;
  }
  // The state of one step: fallen boxes and cards (thick border and ●step), opened entrances (open) and the lines into them (thick).
  function paintMap(svg, L, result, step, title, desc) {
    const fallen = (id) => result.rank[id] !== undefined && result.rank[id] <= step;
    const opened = new Set(Object.entries(result.via).filter(([id]) => fallen(id)).map(([, via]) => via));
    const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
    setText(svg.querySelector(':scope > title'), title);
    setText(svg.querySelector(':scope > desc'), desc);
    for (const path of svg.querySelectorAll('.map-line')) path.classList.toggle('hot', opened.has(path.dataset.to));
    for (const item of svg.querySelectorAll('.map-item')) {
      item.querySelector('.map-box, .map-card').classList.toggle('fallen', fallen(item.dataset.node));
    }
    const marks = [];
    const mark = (at, className, data, text) => S('text', { x: at.x, y: at.y, 'text-anchor': 'end', class: className, ...data }, text);
    for (const [key, r] of Object.entries(L.rows)) if (opened.has(key)) marks.push(mark(r.mark, 'map-mark map-open', { 'data-row': key }, t('openTag')));
    for (const [id, b] of Object.entries(L.box)) if (fallen(id)) marks.push(mark(b.mark, 'map-mark', { 'data-node': id }, '●' + result.rank[id]));
    svg.querySelector('.map-marks').replaceChildren(...marks);
  }
  function renderChainFigure(p, result) {
    const status = View.stepStatus(p, result, state.card, state.step, Messages, state.language);
    const desc = readable(state.step < View.maxRank(result)
      ? t('stepStatusWithSummary', { status, summary: View.stepSummary(p, result, Messages, state.language) }) : status);
    const L = layoutFor(state.persona, state.language);
    const drawn = state.persona + '|' + state.language;
    let svg = $('chain-figure').querySelector('svg');
    if (!svg || svg.getAttribute('data-drawn') !== drawn) {
      const fresh = buildMap(L, 'chain');
      fresh.setAttribute('data-drawn', drawn);
      if (svg) svg.replaceWith(fresh); else $('chain-figure').prepend(fresh);
      svg = fresh;
    }
    paintMap(svg, L, result, state.step, View.mapCaption(p, state.card, state.step, Messages, state.language), desc);
  }
  // The entrances of one account, one line each. In tab 3 the changed entrance is followed by a "changed" line.
  function entranceList(row, className, changedKey) {
    return E('ul', { class: 'entrance-list ' + className }, row.entrances.map((text, i) => [E('li', {}, phrases(text)),
      changedKey && row.id + '.' + row.methods[i] === changedKey ? E('li', { class: 'changed-tag' }, t('changedTag')) : null]));
  }
  // A map table (tab 1, and the map before or after a change in tab 3). keyPrefix and place tell where the names are.
  function mapTable(rows, caption, keyPrefix, place, changedKey = null) {
    const body = rows.map((row) => {
      const cell = row.cell;
      return E('tr', { class: [cell.thisStep ? 'this-step' : '', row.id === state.account ? 'selected' : ''].join(' ').trim() || null },
        E('th', { scope: 'row' }, nameButton(row, keyPrefix + ':' + row.id, row.id === state.account, () => selectAccount(row.id, place)),
          entranceList(row, 'entrances-inline', changedKey)),
        E('td', { class: 'entrances-cell' }, entranceList(row, '', changedKey)),
        E('td', { class: 'result-cell' + (cell.fallen ? ' fallen' : '') }, symbol(phrases(cell.text), cell.sr),
          cell.backdoor ? E('span', { class: 'backdoor-label' }, symbol(t('cellBackdoor'), t('srBackdoor'))) : null,
          cell.thisStep ? E('span', { class: 'this-step-label' }, t('cellThisStep')) : null));
    });
    return E('table', { class: 'map-table' },
      E('caption', {}, phrases(caption)),
      E('thead', {}, E('tr', {}, E('th', { scope: 'col', class: 'col-account' }, t('colAccount')),
        E('th', { scope: 'col', class: 'col-entrances' }, t('colEntrances')), E('th', { scope: 'col', class: 'col-result' }, t('colWithCard')))),
      E('tbody', {}, body));
  }
  function renderChainTable(p, result) {
    const rows = View.mapRows(p, result, state.step, Messages, state.language);
    $('chain-map').replaceChildren(mapTable(rows, View.mapCaption(p, state.card, state.step, Messages, state.language), 'chain-acct', 'chain'));
  }
  function renderDetail(p, pv) {
    const d = View.detail(p, pv, state.card, state.account, Messages, state.language);
    $('detail').hidden = false;
    $('detail-heading').textContent = d.heading;
    $('detail-body').replaceChildren(...[
      E('ul', { class: 'entrance-list detail-entrances' }, d.entrances.map((text) => E('li', {}, phrases(text)))),
      E('p', { class: 'detail-falls' }, phrases(d.falls)),
      d.backdoor ? E('p', { class: 'detail-backdoor' }, phrases(d.backdoor)) : null,
      E('p', { class: 'detail-need' }, phrases(d.need)),
      ...d.notes.map((note) => E('p', { class: 'note' }, note))].filter(Boolean));
  }
  // A Japanese name in the four-cards table breaks only after "の" (the cell keeps words together in CSS).
  function breakAfterNo(text) {
    const parts = text.split('の');
    return parts.flatMap((part, i) => (i < parts.length - 1 ? [part + 'の', E('wbr')] : part ? [part] : []));
  }
  function renderFourCards(p, pv) {
    const f = View.fourCards(p, pv, Messages, state.language);
    const table = E('table', { class: 'matrix' },
      E('caption', {}, words(f.caption)),
      E('thead', {}, E('tr', {}, E('th', { scope: 'col', class: 'matrix-account' }, t('colAccount')),
        f.columns.map((c) => E('th', { scope: 'col', class: 'matrix-card' }, symbol(c.short, c.full))))),
      E('tbody', {}, f.rows.map((row) => E('tr', {}, E('th', { scope: 'row' }, breakAfterNo(row.name)),
        row.cells.map((cell) => E('td', {}, symbol(cell.text, cell.sr)))))));
    $('four-cards-table').replaceChildren(table);
  }
  function renderChain() {
    const p = persona(state.persona), pv = vectorsFor(state.persona);
    const result = pv.cards[state.card];
    $('start-here').hidden = state.persona !== 'worker';
    $('story').textContent = t(STORY_KEYS[state.persona]);
    renderHighlights(pv);
    for (const card of CARDS) $('card-' + card).setAttribute('aria-pressed', String(card === state.card));
    $('card-line').textContent = View.cardLine(p, state.card, Messages, state.language);
    const last = View.lastStep(pv, state.card);
    renderSteps(last);
    // The sentence of the current step, always shown under the step buttons (the live region below is written separately).
    // At the last step (where another card or person starts) a hint under it tells how to follow the chain from step 0.
    $('step-line').replaceChildren(...phraseStars(View.stepLine(p, result, state.card, state.step, Messages, state.language)));
    $('step-hint').hidden = !(last > 0 && state.step === last);
    $('step-summary').replaceChildren(...phraseStars(View.stepSummary(p, result, Messages, state.language)));
    renderChainFigure(p, result);
    renderChainTable(p, result);
    renderDetail(p, pv);
    renderFourCards(p, pv);
    const note = View.cardNote(state.card, Messages, state.language);
    $('card-note').textContent = note || '';
    $('card-note').hidden = !note;
  }

  // ===== Tab 2: lockout =====
  function renderLockout() {
    const p = persona(state.persona), pv = vectorsFor(state.persona);
    const lt = View.lockTable(p, pv.lossTable, Messages, state.language);
    $('lock-legend-mail').textContent = lt.legendMail;
    const table = E('table', { class: 'lock-table' },
      E('caption', {}, phrases(lt.caption)),
      E('thead', {}, E('tr', {}, E('th', { scope: 'col', class: 'lock-account' }, t('colAccount')),
        lt.columns.map((c) => E('th', { scope: 'col' }, phrases(c.head))))),
      E('tbody', {}, lt.rows.map((row) => E('tr', { class: row.id === state.account ? 'selected' : null },
        E('th', { scope: 'row' }, nameButton(row, 'lock-acct:' + row.id, row.id === state.account, () => selectAccount(row.id, 'lockout'))),
        row.cells.map((cell) => E('td', { class: 'lock-' + cell.mark },
          cell.mark === 'locked' ? [E('span', { class: 'mark-locked', 'aria-hidden': 'true' }, cell.text), E('span', { class: 'visually-hidden' }, cell.sr)]
            : symbol(phrases(cell.text), cell.sr)))))));
    $('lock-map').replaceChildren(table);
    fitLockTable();
    // Under the table: the entrances of the account chosen (a name button chooses another), so that a × can be read here
    $('lock-entrances').replaceChildren(...phrases(View.lockEntrances(p, state.account, Messages, state.language)));
  }
  // Below 720px each column of the lockout table is as wide as its longest word. When the panel is too narrow even for
  // that (a 320px screen with some people), the cells may break inside a word instead of running out of the panel:
  // English at a hyphenation point (.break-words), Japanese anywhere. A browser without the English hyphenation
  // dictionary cannot narrow the table that way, so the cells then break anywhere too (.break-anywhere).
  function fitLockTable() {
    const frame = $('lock-map'), table = frame.querySelector('table');
    if (!table || !frame.getClientRects().length) return;
    const fits = () => table.getBoundingClientRect().width <= frame.getBoundingClientRect().width + 0.5;
    table.classList.remove('break-words', 'break-anywhere');
    if (fits()) return;
    table.classList.add('break-words');
    if (!fits()) table.classList.add('break-anywhere');
  }

  // ===== Tab 3: try one change =====
  const moveOf = (pv, id) => pv.moves.find((mv) => mv.id === id);
  // A stacked table below 720px: each cell carries the heading of its column (data-label, in the current language) and
  // keeps its content in one box, beside that heading. The heading is shown by an element (.cell-label, hidden on wide
  // screens where thead shows it), so that phrases() keeps its Japanese words whole. A blank cell (null) stays empty and
  // is left out when stacked.
  function stackedTable(className, caption, headings, rows) {
    return E('table', { class: 'responsive-table ' + className },
      E('caption', {}, words(caption)),
      E('thead', {}, E('tr', {}, headings.map((heading) => E('th', { scope: 'col' }, words(heading))))),
      E('tbody', {}, rows.map(({ attributes, cells }) => E('tr', attributes || {}, cells.map((content, i) => E(i ? 'td' : 'th',
        { scope: i ? null : 'row', 'data-label': headings[i], class: content === null ? 'empty-cell' : null },
        content === null ? null
          : [E('span', { class: 'cell-label' }, words(headings[i])), E('span', { class: 'cell-value' }, words(content))]))))));
  }
  function renderCandidates(p, pv, found) {
    $('candidates').replaceChildren(...found.ids.map((id) => {
      const button = E('button', { type: 'button', class: 'cand-button', 'data-key': 'cand:' + id, 'aria-pressed': String(id === state.move) },
        E('span', { class: 'cand-title' }, View.moveTitle(p, moveOf(pv, id), Messages, state.language)),
        E('span', { class: 'cand-effect' }, marked(View.effectText(p, pv, id, state.mode, Messages, state.language))));
      button.addEventListener('click', () => selectMove(id));
      return button;
    }));
    $('candidates').hidden = !found.ids.length;
    // The reason without candidates is a status message (#candidates-none sits in the live region #candidates-status). It is
    // written only when it changes, so that a redraw that changes nothing (the theme, for example) does not read it again.
    const reason = found.reason ? t(found.reason, { person: t(PERSON_KEYS[state.persona]) }) : '';
    const none = $('candidates-none');
    if (none.textContent !== reason) none.textContent = reason;
    if (none.hidden !== !reason) none.hidden = !reason;
  }
  // The options are drawn again only for another person or language (or when the placeholder comes or goes)
  function renderChoice(p, pv, found) {
    const select = $('choose-move');
    const placeholder = !found.ids.length;
    const drawn = [state.persona, state.language, placeholder].join('|');
    if (select.getAttribute('data-drawn') !== drawn) {
      const groups = View.moveOptions(p, pv, Messages, state.language)
        .map((g) => E('optgroup', { label: g.label }, g.moves.map((m) => E('option', { value: m.id }, m.text))));
      // The placeholder is shown while no change is chosen but cannot be chosen again (it would leave the comparison of the
      // last change under it)
      select.replaceChildren(...(placeholder ? [E('option', { value: '', disabled: true }, t('choosePlaceholder'))] : []), ...groups);
      select.setAttribute('data-drawn', drawn);
    }
    select.value = state.move || '';
  }
  // Attack (four cards): before and after are counts; saved and newly fallen are the full names on wide screens and
  // counts on narrow ones (the names then go to "See the account names"). Without any change, the summary line only.
  function renderAttack(rows, summaryLine) {
    const changed = rows.filter((r) => r.card !== 'all' && (r.saved || r.newly));
    $('attack-names').hidden = !changed.length;
    if (!changed.length) {
      $('attack-area').replaceChildren(E('p', { class: 'attack-none' }, summaryLine));
      $('attack-names-table').replaceChildren();
      return;
    }
    const names = (list) => (list.length ? words(list.join(t('sepList'))) : symbol(t('cellNone'), '0'));
    const both = (list, count) => [E('span', { class: 'wide-only' }, names(list)), E('span', { class: 'narrow-only' }, String(count))];
    const heads = ['attackColCard', 'attackColBefore', 'attackColAfter', 'attackColSaved', 'attackColNewly'].map((key) => t(key));
    // Narrow screens show the short card names of the four-cards table (with its legend); the full name is read
    const cardName = (r) => (r.card === 'all' ? words(r.label)
      : [E('span', { class: 'wide-only' }, words(r.label)), E('span', { class: 'narrow-only' }, symbol(t(CARD_SHORT_KEYS[r.card]), r.label))]);
    $('attack-area').replaceChildren(E('p', { class: 'map-legend attack-legend' }, t('fourCardsLegend')), E('table', { class: 'attack-table' },
      E('caption', {}, words(t('attackCaption'))),
      E('thead', {}, E('tr', {}, heads.map((heading, i) => E('th', { scope: 'col', class: 'attack-col-' + i }, words(heading))))),
      E('tbody', {}, rows.map((r) => E('tr', { class: [r.card === 'all' ? 'total' : '', r.selected ? 'selected' : ''].join(' ').trim() || null },
        E('th', { scope: 'row' }, cardName(r), r.selected ? E('span', { class: 'visually-hidden' }, ' ' + t('attackMode')) : null),
        E('td', {}, String(r.before)), E('td', {}, String(r.after)),
        E('td', {}, r.card === 'all' ? String(r.saved) : both(r.savedNames, r.saved)),
        E('td', {}, r.card === 'all' ? String(r.newly) : both(r.newlyNames, r.newly)))))));
    const listHeads = [heads[0], heads[3], heads[4]];
    $('attack-names-table').replaceChildren(stackedTable('attack-names-list', t('attackCaption'), listHeads,
      changed.map((r) => ({ cells: [r.label, names(r.savedNames), names(r.newlyNames)] }))));
  }
  // The lockout table before and after the change: only the accounts whose cells change (hidden when none does)
  function renderLockChanges(p, pv) {
    const lc = View.lockChanges(p, pv, state.move, Messages, state.language);
    $('lock-changes').hidden = !lc.rows.length;
    $('lock-changes-mail').textContent = lc.legendMail;
    const mark = (cell) => (cell.mark === 'locked'
      ? [E('span', { class: 'mark-locked', 'aria-hidden': 'true' }, cell.text), E('span', { class: 'visually-hidden' }, cell.sr)]
      : symbol(words(cell.text), cell.sr));
    $('lock-changes-table').replaceChildren(stackedTable('lock-changes-list', lc.caption, [t('colAccount'), ...lc.columns.map((c) => c.head)],
      lc.rows.map((row) => ({ cells: [[row.important ? symbol('★', t('srImportant') + ' ') : null, row.name], ...row.cells.map(mark)] }))));
  }
  // Compare with the other changes to the same entrance: the change column holds buttons that pick the change
  function renderSame(p, pv) {
    const same = View.sameRows(p, pv, state.move, Messages, state.language);
    const heads = ['sameColMove', 'sameColSaved', 'sameColNewly', 'sameColLock', 'sameColPair'].map((key) => t(key));
    $('same-table').replaceChildren(stackedTable('same-table', same.heading, heads, same.rows.map((r) => {
      const button = E('button', { type: 'button', class: 'same-button', 'data-key': 'same:' + r.id, 'aria-pressed': String(r.id === state.move) },
        words(r.move));
      button.addEventListener('click', () => selectMove(r.id));
      return { attributes: { class: r.id === state.move ? 'selected' : null }, cells: [button, String(r.saved), String(r.newly), marked(r.lock), r.pair] };
    })));
    // The note on removals, under the table when it has a removal that is not the change chosen (that one has the note above)
    $('same-note').textContent = same.removeNote || '';
    $('same-note').hidden = !same.removeNote;
  }
  // The map before or after the change, always at the last step (the step buttons belong to tab 1). The steps, the
  // entrances used and the backdoors after the change come from the person after it (cardGives with that person).
  function renderAfterMap(p, pv) {
    const after = afterFor(state.persona, state.move, state.card);
    const before = state.mapPhase === 'before';
    const X = before ? p : after.person, result = before ? pv.cards[state.card] : after;
    const step = View.maxRank(result);
    for (const phase of PHASES) $('phase-' + phase).setAttribute('aria-pressed', String(phase === state.mapPhase));
    $('map-card').textContent = t('mapCard', { card: t(CARD_KEYS[state.card]) });
    const caption = View.mapCaption(X, state.card, step, Messages, state.language);
    const L = afterLayoutFor(state.persona, state.move, state.language, after.person);
    const drawn = [state.persona, state.language, state.move, state.mapPhase].join('|');
    let svg = $('after-figure').querySelector('svg');
    if (!svg || svg.getAttribute('data-drawn') !== drawn) {
      const fresh = buildMap(L, 'after', state.mapPhase);
      fresh.setAttribute('data-drawn', drawn);
      if (svg) svg.replaceWith(fresh); else $('after-figure').prepend(fresh);
      svg = fresh;
    }
    paintMap(svg, L, result, step, caption, readable(View.stepStatus(X, result, state.card, step, Messages, state.language)));
    const rows = View.mapRows(X, result, step, Messages, state.language, before ? null : after.changedMethod);
    $('after-map-table').replaceChildren(mapTable(rows, caption, 'after-acct', 'after', after.changedMethod));
  }
  // The summary is a live region. It is written again for every change chosen, even when its sentences stay the same (the
  // paper codes and the removal of the same entrance can read alike), and for another person or language; a redraw that
  // keeps the change (a mode with the same suggestion, the map before or after, the theme) leaves it as it is.
  let summaryDrawn = null;
  let summaryChosen = false;
  function renderComparison(p, pv) {
    const s = View.sentences(p, pv, state.move, Messages, state.language, state.mode);
    $('compare-heading').textContent = s.title;
    const summary = $('compare-summary');
    const drawn = [state.persona, state.language, state.move].join('|');
    if (summaryChosen || drawn !== summaryDrawn || [...summary.children].map((line) => line.textContent).join('\n') !== s.summary.join('\n')) {
      summary.replaceChildren(...s.summary.map((line) => E('p', {}, line)));
      summaryDrawn = drawn;
    }
    summaryChosen = false;
    renderAttack(s.attack, s.summary[0]);
    $('lock-one').replaceChildren(...s.lossOne.map((line) => E('li', {}, line)));
    $('lock-two').replaceChildren(...s.lossTwo.map((line) => E('li', {}, line)));
    renderLockChanges(p, pv);
    $('move-notes').replaceChildren(...s.notes.map((note) => E('p', { class: 'note' }, note)));
    renderSame(p, pv);
    renderAfterMap(p, pv);
  }
  // Without a change (no suggestion for the mode), the comparison shows the guidance only; its parts are emptied so that
  // nothing of another language or person stays in them.
  function clearComparison() {
    for (const id of ['compare-heading', 'compare-summary', 'attack-area', 'attack-names-table', 'lock-one', 'lock-two', 'lock-changes-mail',
      'lock-changes-table', 'move-notes', 'same-table', 'same-note', 'map-card', 'after-map-table']) $(id).replaceChildren();
    $('same-note').hidden = true;
    const svg = $('after-figure').querySelector('svg');
    if (svg) svg.remove();
    summaryDrawn = null;
    summaryChosen = false;
  }
  function renderCompare() {
    const p = persona(state.persona), pv = vectorsFor(state.persona);
    for (const mode of MODES) $('mode-' + mode).setAttribute('aria-pressed', String(mode === state.mode));
    const found = View.candidates(p, pv, state.mode);
    renderCandidates(p, pv, found);
    $('ranking-text').textContent = View.rankingNote(state.mode, Messages, state.language);
    renderChoice(p, pv, found);
    $('no-move').hidden = state.move !== null;
    $('compare-result').hidden = state.move === null;
    if (state.move === null) clearComparison(); else renderComparison(p, pv);
  }

  // ===== Tab 4: rules, symbols and notes; the printed sheets =====
  // The related tools named in the paper notes open in a new tab (ordinary links that also work without JavaScript)
  const TOOL_LINKS = Object.fromEntries(View.relatedTools.map((tool) => [tool.id, { key: tool.name, href: tool.href }]));
  const newTabLink = (href, text, className = null) => E('a', { href, target: '_blank', rel: 'noopener noreferrer', class: className }, text);
  function withLinks(text) {
    return text.split(/\{(day\d+)\}/).map((part, i) => (i % 2 ? newTabLink(TOOL_LINKS[part].href, t(TOOL_LINKS[part].key)) : part))
      .filter((part) => part !== '');
  }
  // The symbols table and the four notes depend on the language only, so they are drawn again only for another language
  function renderRules() {
    const panel = $('panel-rules');
    if (panel.getAttribute('data-drawn') === state.language) return;
    const symbols = View.symbolTable(Messages, state.language);
    $('symbol-table').replaceChildren(stackedTable('symbol-table', symbols.caption, symbols.columns,
      symbols.rows.map((row) => ({ attributes: { 'data-row': row.id }, cells: row.cells }))));
    $('rules-notes').replaceChildren(E('li', {}, t('noteSms')), E('li', {}, t('notePasskey', { sync: t('lockNoteSync') })),
      E('li', {}, t('noteDesk')), E('li', {}, withLinks(t('notePaperRules', { paper: t('notePaper') }))));
    panel.setAttribute('data-drawn', state.language);
  }
  // The printed sheets (hidden on screen): one page per person with the map table, then the blank sheet. They are built
  // in the current language once the three people are ready, and again when the language changes.
  let printLanguage = null;
  function printLegend() {
    const symbols = View.symbolTable(Messages, state.language);
    return E('table', { class: 'print-legend' }, E('caption', {}, words(symbols.caption)),
      E('thead', {}, E('tr', {}, symbols.columns.slice(0, 2).map((heading) => E('th', { scope: 'col' }, words(heading))))),
      E('tbody', {}, symbols.rows.map((row) => E('tr', {}, E('th', { scope: 'row' }, words(row.cells[0])), E('td', {}, words(row.cells[1]))))));
  }
  // Under the legend: the short column names and the marks of the map table
  const PRINT_ABBR = ['printLegendSim', 'printLegendDesk', 'printLegendBackdoor', 'printLegendNone', 'printLegendOk', 'printLegendPlus'];
  function printPage(id) {
    const sheet = View.printTable(persona(id), vectorsFor(id), Messages, state.language);
    // Columns: account, entrances, the four attack cards (short marks kept on one line), then the three losses; a row of
    // group headings above them tells the attack cards from the losses. Japanese words stay whole (keep-all in print).
    const attacks = sheet.rows[0].attack.length, losses = sheet.rows[0].loss.length;
    const kind = (i) => (i < 2 ? null : i < 2 + attacks ? 'print-attack' : 'print-loss');
    // Every person's page carries the legend, so that one page handed out alone (the parent's, to talk it over with the
    // family) can still be read
    return E('section', { class: 'print-page', 'data-person': id, 'aria-labelledby': 'print-title-' + id },
      printLegend(), E('ul', { class: 'print-abbr' }, PRINT_ABBR.map((key) => E('li', {}, t(key)))),
      E('h2', { id: 'print-title-' + id }, sheet.title),
      E('p', { class: 'print-story' }, sheet.story),
      // The table is named by its own caption with the heading's text, hidden so that the printed page keeps its form
      E('table', { class: 'print-map' }, E('caption', { class: 'visually-hidden' }, sheet.title),
        E('colgroup', { span: 2 }), E('colgroup', { span: attacks }), E('colgroup', { span: losses }),
        E('thead', {},
          E('tr', {}, sheet.columns.slice(0, 2).map((heading) => E('th', { scope: 'col', rowspan: 2 }, phrases(heading))),
            E('th', { scope: 'colgroup', colspan: attacks, class: 'print-group' }, t('printGroupAttack')),
            E('th', { scope: 'colgroup', colspan: losses, class: 'print-group' }, t('printGroupLoss'))),
          E('tr', {}, sheet.columns.slice(2).map((heading, i) => E('th', { scope: 'col', class: kind(i + 2) }, phrases(heading))))),
        E('tbody', {}, sheet.rows.map((row) => E('tr', {}, E('th', { scope: 'row' }, phrases((row.important ? '★' : '') + row.name)),
          E('td', {}, phrases(row.entrances)), row.attack.map((cell) => E('td', { class: 'print-attack' }, cell)),
          // A lone × is printed bold and larger, as on screen (U+00D7 is smaller and thinner than ○)
          row.loss.map((cell) => E('td', { class: 'print-loss' }, cell === t('cellLocked') ? E('span', { class: 'mark-locked' }, cell)
            : phrases(cell, '×'))))))),
      E('p', { class: 'print-disclaimer' }, t('printDisclaimer')));
  }
  const FORM_COLUMNS = ['formColNo', 'formColAccount', 'formColImportant', 'formColRole', 'formColReq', 'formColNotes'];
  const FORM_ROWS = 18;
  function formPage() {
    return E('section', { class: 'print-page print-form', 'aria-labelledby': 'print-title-form' },
      E('h2', { id: 'print-title-form' }, t('formTitle')),
      E('div', { class: 'print-keep' }, E('p', { class: 'print-keep-title' }, t('formKeepTitle')), E('p', {}, t('formKeepText')),
        E('p', { class: 'print-dates' }, t('formDates'))),
      E('ul', { class: 'print-how' }, [1, 2, 3, 4].map((n) => E('li', {}, t('formHow' + n)))),
      // Named like the map tables: a hidden caption with the heading's text
      E('table', { class: 'print-form-table' }, E('caption', { class: 'visually-hidden' }, t('formTitle')),
        E('thead', {}, E('tr', {}, FORM_COLUMNS.map((key) => E('th', { scope: 'col', class: 'form-' + key.slice(7).toLowerCase() }, words(t(key)))))),
        E('tbody', {}, Array.from({ length: FORM_ROWS }, (_, i) => E('tr', {}, E('td', {}, String(i + 1)),
          FORM_COLUMNS.slice(1).map(() => E('td', {})))))),
      printLegend());
  }
  function buildPrint() {
    $('print-sheet').replaceChildren(...PERSONAS.map(printPage), formPage());
    printLanguage = state.language;
    $('print-sheet').setAttribute('data-ready', 'true');
  }

  // ===== Help: the ten lessons =====
  // The <details> boxes are in index.html (so they keep their open state); their titles and bodies are written in the current
  // language once the three people are ready, again when the language changes, or when the help opens before that. (A title
  // such as 証券口座 belongs to the lessons only, so index.html carries no title text.)
  let lessonsLanguage = null;
  const JAPANESE_TEXT = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/;
  // A table of counts or short marks (grid) keeps its columns on narrow screens; a table of sentences or names stacks below
  // 720px, each cell beside its heading.
  function lessonCell(cell) {
    if (typeof cell === 'string') return words(cell);
    if (cell.lines) return cell.lines.map((line) => E('span', { class: 'cell-line' }, words(line)));
    if (cell.href) return newTabLink(cell.href, cell.text, 'lesson-link');
    if (cell.name !== undefined) return [cell.important ? symbol('★', t('srImportant') + ' ') : null, words(cell.name)];
    if (cell.mark === 'locked') {
      return [E('span', { class: 'mark-locked', 'aria-hidden': 'true' }, cell.text), E('span', { class: 'visually-hidden' }, cell.sr)];
    }
    return symbol(words(cell.text), cell.sr);
  }
  function lessonTableElement(kind, table) {
    if (!table.grid) {
      return stackedTable('lesson-table lesson-' + kind, table.caption, table.heads, table.rows.map((row) => ({ cells: row.map(lessonCell) })));
    }
    return E('table', { class: 'lesson-table lesson-grid lesson-' + kind }, E('caption', {}, words(table.caption)),
      E('thead', {}, E('tr', {}, table.heads.map((heading) => E('th', { scope: 'col' }, words(heading))))),
      E('tbody', {}, table.rows.map((row) => E('tr', {}, row.map((cell, i) => E(i ? 'td' : 'th', { scope: i ? null : 'row' },
        lessonCell(cell)))))));
  }
  function lessonBlock([kind, value], people) {
    if (kind === 'table') {
      return E('div', { class: 'table-frame' }, lessonTableElement(value, View.lessonTable(value, people, Messages, state.language)));
    }
    if (kind === 'links') return E('p', {}, withLinks(t(value)));
    return E('p', { class: kind === 'p' ? null : kind === 'note' ? 'note' : 'map-legend' }, t(value));
  }
  function buildLessons() {
    const people = PERSONAS.map((id) => ({ p: persona(id), pv: vectorsFor(id) }));
    for (const lesson of View.lessons) {
      const sources = lesson.refs.map((ref) => {
        const text = t('lessonRef' + ref);
        // An English title on the Japanese page is marked as English for screen readers
        return E('li', { lang: state.language === 'ja' && !JAPANESE_TEXT.test(text) ? 'en' : null },
          newTabLink(View.lessonRefs[ref], text, 'lesson-link'));
      });
      $('lesson-' + lesson.n).querySelector(':scope > summary').textContent = t('lesson' + lesson.n + 'Title');
      $('lesson-' + lesson.n + '-body').replaceChildren(...lesson.blocks.map((block) => lessonBlock(block, people)),
        ...(sources.length ? [E('p', { class: 'lesson-sources-label' }, t('lessonSources')), E('ul', { class: 'lesson-sources' }, sources)] : []));
    }
    lessonsLanguage = state.language;
  }

  // Elements redrawn by render() carry data-key; focus returns to the element with the same key when it is visible.
  function restoreFocus(key) {
    if (!key || document.activeElement?.dataset?.key === key) return;
    const target = [...document.querySelectorAll('[data-key]')].find((el) => el.dataset.key === key);
    if (target && target.getClientRects().length) target.focus({ preventScroll: true });
  }
  function render() {
    const focusKey = document.activeElement?.dataset?.key || null;
    document.documentElement.lang = state.language;
    document.documentElement.dataset.theme = state.theme;
    // Text inside a table (the rules table) gets the <wbr> of phrases(), like the tables drawn by this file
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      if (el.closest('table')) el.replaceChildren(...phrases(t(el.dataset.i18n))); else el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    $('language').textContent = state.language === 'ja' ? 'EN' : '日';
    renderPersons();
    renderTabs();
    renderChain();
    renderLockout();
    renderCompare();
    renderRules();
    // The printed sheets and the lessons follow the language once they are built (before that, startup builds them)
    if (printLanguage !== null && printLanguage !== state.language) buildPrint();
    if (lessonsLanguage !== null && lessonsLanguage !== state.language) buildLessons();
    restoreFocus(focusKey);
  }

  // ===== Step status (a live region; written only when the step buttons are pressed and once at the end of playback) =====
  function writeStepStatus(text) {
    const p = persona(state.persona);
    $('step-status').textContent = text
      || readable(View.stepStatus(p, vectorsFor(state.persona).cards[state.card], state.card, state.step, Messages, state.language));
  }
  const clearStepStatus = () => { $('step-status').textContent = ''; };
  function stopPlaying() {
    if (playTimer !== null) clearTimeout(playTimer);
    playTimer = null;
    state.playing = false;
  }
  function finishPlaying() {
    stopPlaying();
    render();
    writeStepStatus();
  }
  function advance() {
    playTimer = null;
    if (!state.playing) return;
    state.step += 1;
    if (state.step >= lastStep()) {
      finishPlaying();
      return;
    }
    render();
    playTimer = setTimeout(advance, PLAY_INTERVAL);
  }
  function togglePlay() {
    if (state.playing) {
      stopPlaying();
      render();
      return;
    }
    if (reducedMotion()) {
      state.step = lastStep();
      render();
      // The guidance names Start over and Next step. When step 0 is the only step (nothing falls to the card), both do
      // nothing, so the step and the summary are written instead, as at the end of playback.
      if (state.step === 0) writeStepStatus(); else writeStepStatus(t('reducedPlay'));
      return;
    }
    state.step = 0;
    if (lastStep() === 0) {
      finishPlaying();
      return;
    }
    state.playing = true;
    render();
    playTimer = setTimeout(advance, PLAY_INTERVAL);
  }
  function stepTo(kind) {
    const wasPlaying = state.playing;
    stopPlaying();
    const last = lastStep();
    const atEdge = kind === 'first' ? state.step === 0 : state.step >= last;
    if (atEdge) {
      if (wasPlaying) render();
      return;
    }
    state.step = kind === 'first' ? 0 : kind === 'next' ? state.step + 1 : last;
    render();
    writeStepStatus();
  }

  // ===== Operations =====
  function selectTab(name) {
    stopPlaying();
    state.tab = name;
    render();
  }
  function setCard(card) {
    state.card = card;
    state.step = lastStep();
  }
  function selectCard(card) {
    stopPlaying();
    if (card !== state.card) {
      setCard(card);
      clearStepStatus();
    }
    render();
  }
  function selectPersona(id) {
    if (!PERSONAS.includes(id)) return;
    // Pressing the person already shown changes nothing but still stops playback.
    if (id === state.persona) {
      if (state.playing) {
        stopPlaying();
        render();
      }
      return;
    }
    stopPlaying();
    const pv = vectorsFor(id);
    state.persona = id;
    state.step = View.lastStep(pv, state.card);
    state.account = DEFAULT_ACCOUNT[id];
    state.move = pv.best[state.mode];
    announcement = { key: 'statusPerson', person: id };
    clearStepStatus();
    render();
  }
  // A name in tab 1 shows its detail (narrow screens move the focus there); a name in the map of tab 3 only selects the
  // account and the focus stays on it (the detail is in tab 1 only).
  function selectAccount(id, place) {
    state.account = id;
    render();
    if (place === 'chain' && narrowScreen()) {
      $('detail-heading').focus();
      $('detail-heading').scrollIntoView();
    }
  }
  // Tab 3: a mode chooses the suggestion of that mode (pressing the mode already chosen keeps the change). A card mode also
  // sets the card of the map, also when that mode was already chosen and the card was changed in tab 1 since (at its last
  // step when the card changes, as in tab 1)
  function selectMode(mode) {
    stopPlaying();
    if (mode !== state.mode) {
      state.mode = mode;
      state.move = vectorsFor(state.persona).best[mode];
    }
    if (CARDS.includes(mode) && mode !== state.card) {
      setCard(mode);
      clearStepStatus();
    }
    render();
  }
  // A change chosen with a candidate, the select or the same-entrance table: the summary is written (read) again
  function selectMove(id) {
    state.move = id;
    summaryChosen = true;
    render();
  }
  function selectPhase(phase) {
    state.mapPhase = phase;
    render();
  }
  function focusTarget(name) {
    if (name === 'detail-heading') return $('detail-heading');
    if (name === 'compare-heading') return $('compare-heading') || $('panel-compare');
    return document.querySelector('[data-key="' + name + '"]');
  }
  // The target of a highlight comes into view (not smoothly). A name in the lockout table (P2, S3) comes with the caption
  // and the column headings above it, so that the column of each mark can be read; when they do not fit on the screen
  // together, the name stays in view at the bottom.
  function reveal(target) {
    const table = target.closest('table');
    if (!table) {
      target.scrollIntoView();
      return;
    }
    (table.caption || table).scrollIntoView();
    if (target.getBoundingClientRect().bottom > innerHeight) target.scrollIntoView({ block: 'end' });
  }
  function pressHighlight(h) {
    stopPlaying();
    const s = h.state;
    if (s.mode) state.mode = s.mode;
    const card = s.card || (CARDS.includes(s.mode) ? s.mode : null);
    if (card && card !== state.card) setCard(card);
    if (s.step !== undefined) state.step = s.step === 'last' ? lastStep() : s.step;
    if (s.move !== undefined) state.move = s.move;
    if (s.account) state.account = s.account;
    if (s.tab) state.tab = s.tab;
    announcement = { key: 'statusHighlight', highlight: h.id };
    clearStepStatus();
    render();
    const target = focusTarget(h.target);
    target.focus();
    reveal(target);
  }

  TABS.forEach((name, index) => {
    $('tab-' + name).addEventListener('click', () => selectTab(name));
    $('tab-' + name).addEventListener('keydown', (event) => {
      const move = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!move && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + move + TABS.length) % TABS.length;
      selectTab(TABS[next]);
      $('tab-' + state.tab).focus();
    });
  });
  for (const id of PERSONAS) $('person-' + id).addEventListener('click', () => selectPersona(id));
  for (const card of CARDS) $('card-' + card).addEventListener('click', () => selectCard(card));
  for (const mode of MODES) $('mode-' + mode).addEventListener('click', () => selectMode(mode));
  for (const phase of PHASES) $('phase-' + phase).addEventListener('click', () => selectPhase(phase));
  $('choose-move').addEventListener('change', (event) => {
    if (event.target.value) selectMove(event.target.value); else event.target.value = state.move || '';
  });
  $('step-first').addEventListener('click', () => stepTo('first'));
  $('step-next').addEventListener('click', () => stepTo('next'));
  $('step-last').addEventListener('click', () => stepTo('last'));
  $('step-play').addEventListener('click', togglePlay);
  $('back-to-map').addEventListener('click', () => {
    const button = document.querySelector('[data-key="chain-acct:' + state.account + '"]');
    button.focus();
    button.scrollIntoView();
  });
  // Under the same-entrance table: a change pressed there keeps the focus, while its results change above
  $('back-to-compare').addEventListener('click', () => {
    $('compare-heading').focus();
    $('compare-heading').scrollIntoView();
  });
  // The guide in tab 1 goes to the paper section of the rules tab (its heading takes the focus)
  $('print-guide').addEventListener('click', () => {
    selectTab('rules');
    $('paper-heading').focus();
    $('paper-heading').scrollIntoView();
  });
  // Printing changes no state; the sheets are built before the print preview even when the browser menu is used early
  $('print-button').addEventListener('click', () => window.print());
  addEventListener('beforeprint', () => {
    if (printLanguage !== state.language) buildPrint();
  });
  $('theme').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    saveTheme();
    render();
  });
  $('language').addEventListener('click', () => {
    state.language = state.language === 'ja' ? 'en' : 'ja';
    saveLanguage();
    announcement = null;
    clearStepStatus();
    render();
  });
  $('help').addEventListener('click', () => {
    if (lessonsLanguage !== state.language) buildLessons();
    $('help-dialog').showModal();
    $('help-dialog').querySelector('.help-body').scrollTop = 0;
  });
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  function visibleFocusTarget(element) {
    if (element.matches(':disabled') || !element.getClientRects().length) return false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS' && !parent.open && !parent.querySelector(':scope > summary')?.contains(element)) return false;
    }
    return true;
  }
  $('help-dialog').addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...$('help-dialog').querySelectorAll('button, a[href], input, select, summary, [tabindex="0"]')]
      .filter(visibleFocusTarget);
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  // Crossing 720px hides the back button under the detail (narrow screens) or the diagram (wide screens). When the focus
  // was on an element that is no longer shown, it moves to the name of the selected account in the map table. The browser
  // may take the focus away from the hidden element before or after the media query reports the change, so an element
  // that lost the focus while it was no longer shown is remembered.
  let vanished = null;
  document.addEventListener('focusout', (event) => {
    vanished = !event.relatedTarget && !event.target.getClientRects().length ? event.target : null;
  });
  const narrowQuery = matchMedia('(max-width: 719px)');
  narrowQuery.addEventListener('change', () => {
    const active = document.activeElement;
    const lost = active && active !== document.body ? !active.getClientRects().length : !!vanished;
    vanished = null;
    if (!lost) return;
    // The name of the selected account in a map table that is shown: tab 1, or the map after a change in tab 3
    const name = ['chain-acct:', 'after-acct:'].map((prefix) => document.querySelector('[data-key="' + prefix + state.account + '"]'))
      .find((button) => button && button.getClientRects().length);
    (name || $('panel-' + state.tab)).focus();
  });
  addEventListener('resize', fitLockTable);

  // Startup: build the first person, draw, then release the two guarded groups, show the four-cards box (it has nothing
  // to open before the first drawing) and remove the startup notice.
  state.move = vectorsFor(state.persona).best[state.mode];
  render();
  $('startup-tools').disabled = false;
  $('startup-controls').disabled = false;
  $('four-cards').hidden = false;
  $('startup-note').remove();
  document.documentElement.dataset.appReady = 'true';
  // The other two people are built right after the first view, so that switching people does not wait; then the printed
  // sheets are built (data-ready="true"), unless a print before that already built them, and the lessons of the help.
  setTimeout(() => {
    for (const id of PERSONAS) vectorsFor(id);
    if (printLanguage !== state.language) buildPrint();
    if (lessonsLanguage !== state.language) buildLessons();
  }, 0);
}());
