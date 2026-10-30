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
  // bracket and after ：＋・、, but never before a mark that may not start a line (、。・：）」ー, small kana and the like).
  // Text without Japanese comes back as it is (English breaks at its spaces).
  const PARTICLES = 'のでをにがはとかもへや';
  const NO_LINE_START = '、。，．・：；？！ー）」』】〕ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ';
  const scriptOf = (ch) => (/[\u30a0-\u30ff]/.test(ch) ? 'katakana' : /[\u3400-\u4dbf\u4e00-\u9fff]/.test(ch) ? 'kanji'
    : /[\u3040-\u309f]/.test(ch) ? 'hiragana' : 'other');
  function phrases(text) {
    const chars = [...text], out = [];
    let piece = '';
    chars.forEach((ch, i) => {
      piece += ch;
      const next = chars[i + 1];
      if (next === undefined || NO_LINE_START.includes(next)) return;
      const pair = scriptOf(ch) + '>' + scriptOf(next);
      if ((PARTICLES.includes(ch) && scriptOf(next) !== 'hiragana') || pair === 'katakana>kanji' || pair === 'kanji>katakana'
        || (next === '（' && ch !== ' ') || ch === '）' || '：＋・、'.includes(ch)) {
        out.push(piece, E('wbr'));
        piece = '';
      }
    });
    if (piece) out.push(piece);
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
  const readable = (text) => text.replace(/★(\d+)/g, (_, n) => t('srImportantCount', { imp: n }));
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
  function buildMap(L, prefix) {
    const svg = S('svg', { class: 'map-svg', role: 'img', 'aria-labelledby': prefix + '-svg-title', 'aria-describedby': prefix + '-svg-desc',
      width: L.width, height: L.height, viewBox: '0 0 ' + L.width + ' ' + L.height });
    svg.append(S('title', { id: prefix + '-svg-title' }), S('desc', { id: prefix + '-svg-desc' }));
    const lines = S('g', { class: 'map-lines' });
    for (const line of L.lines) lines.append(S('path', { d: line.d, class: 'map-line ' + line.role, 'data-from': line.from, 'data-to': line.to }));
    const boxes = S('g', { class: 'map-boxes' });
    for (const id of L.columns[0]) {
      const b = L.box[id];
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
          group.append(S('line', { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y, class: 'map-divider' }));
          const row = S('g', { class: 'map-row', 'data-row': key });
          if (r.before.title) row.append(S('title', {}, r.before.title));
          for (const line of r.before.lines) row.append(S('text', { x: line.x, y: line.y, class: 'map-text map-row-text' }, line.value));
          group.append(row);
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
  function entranceList(entrances, className) {
    return E('ul', { class: 'entrance-list ' + className }, entrances.map((text) => E('li', {}, phrases(text))));
  }
  function renderChainTable(p, result) {
    const rows = View.mapRows(p, result, state.step, Messages, state.language);
    const body = rows.map((row) => {
      const cell = row.cell;
      const tr = E('tr', { class: [cell.thisStep ? 'this-step' : '', row.id === state.account ? 'selected' : ''].join(' ').trim() || null },
        E('th', { scope: 'row' }, nameButton(row, 'chain-acct:' + row.id, row.id === state.account, () => selectAccount(row.id, 'chain')),
          entranceList(row.entrances, 'entrances-inline')),
        E('td', { class: 'entrances-cell' }, entranceList(row.entrances, '')),
        E('td', { class: 'result-cell' + (cell.fallen ? ' fallen' : '') }, symbol(phrases(cell.text), cell.sr),
          cell.backdoor ? E('span', { class: 'backdoor-label' }, symbol(t('cellBackdoor'), t('srBackdoor'))) : null,
          cell.thisStep ? E('span', { class: 'this-step-label' }, t('cellThisStep')) : null));
      return tr;
    });
    const table = E('table', { class: 'map-table' },
      E('caption', {}, phrases(View.mapCaption(p, state.card, state.step, Messages, state.language))),
      E('thead', {}, E('tr', {}, E('th', { scope: 'col', class: 'col-account' }, t('colAccount')),
        E('th', { scope: 'col', class: 'col-entrances' }, t('colEntrances')), E('th', { scope: 'col', class: 'col-result' }, t('colWithCard')))),
      E('tbody', {}, body));
    $('chain-map').replaceChildren(table);
  }
  function renderDetail(p, pv) {
    const d = View.detail(p, pv, state.card, state.account, Messages, state.language);
    $('detail').hidden = false;
    $('detail-heading').textContent = d.heading;
    $('detail-body').replaceChildren(...[
      entranceList(d.entrances, 'detail-entrances'),
      E('p', { class: 'detail-falls' }, d.falls),
      d.backdoor ? E('p', { class: 'detail-backdoor' }, d.backdoor) : null,
      E('p', { class: 'detail-need' }, d.need),
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
      E('caption', {}, f.caption),
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
    renderSteps(View.lastStep(pv, state.card));
    // The sentence of the current step, always shown under the step buttons (the live region below is written separately)
    $('step-line').replaceChildren(...withStars(View.stepLine(p, result, state.card, state.step, Messages, state.language)));
    $('step-summary').replaceChildren(...withStars(View.stepSummary(p, result, Messages, state.language)));
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
  }
  // Below 720px each column of the lockout table is as wide as its longest word. When the panel is too narrow even for
  // that (a 320px screen with some people), the cells may break inside a word instead of running out of the panel.
  function fitLockTable() {
    const frame = $('lock-map'), table = frame.querySelector('table');
    if (!table || !frame.getClientRects().length) return;
    table.classList.remove('break-words');
    if (table.getBoundingClientRect().width > frame.getBoundingClientRect().width + 0.5) table.classList.add('break-words');
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
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    $('language').textContent = state.language === 'ja' ? 'EN' : '日';
    renderPersons();
    renderTabs();
    renderChain();
    renderLockout();
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
  function selectAccount(id, place) {
    state.account = id;
    render();
    if (place === 'chain' && narrowScreen()) {
      $('detail-heading').focus();
      $('detail-heading').scrollIntoView();
    }
  }
  function focusTarget(name) {
    if (name === 'detail-heading') return $('detail-heading');
    if (name === 'compare-heading') return $('compare-heading') || $('panel-compare');
    return document.querySelector('[data-key="' + name + '"]');
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
    target.scrollIntoView();
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
  $('step-first').addEventListener('click', () => stepTo('first'));
  $('step-next').addEventListener('click', () => stepTo('next'));
  $('step-last').addEventListener('click', () => stepTo('last'));
  $('step-play').addEventListener('click', togglePlay);
  $('back-to-map').addEventListener('click', () => {
    const button = document.querySelector('[data-key="chain-acct:' + state.account + '"]');
    button.focus();
    button.scrollIntoView();
  });
  $('print-guide').addEventListener('click', () => {
    selectTab('rules');
    $('panel-rules').focus();
    $('panel-rules').scrollIntoView();
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
    const name = document.querySelector('[data-key="chain-acct:' + state.account + '"]');
    (name && name.getClientRects().length ? name : $('panel-' + state.tab)).focus();
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
  // The other two people are built right after the first view, so that switching people does not wait.
  setTimeout(() => { for (const id of PERSONAS) vectorsFor(id); }, 0);
}());
