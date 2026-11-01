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
  const CARD_SHORT_KEYS = { leak: 'fourCardsColLeak', simswap: 'fourCardsColSimswap', mail: 'fourCardsColMail', desk: 'fourCardsColDesk' };
  const MODES = [...CARDS, 'all', 'lockout'];
  const PHASES = ['before', 'after'];
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // One step every 1.6 seconds while playing, long enough to read the step line
  const PLAY_INTERVAL = 1600;
  // The given names (ハルト): the setting of the person, and the sentences of tab 3 that name the person without the role (ハルトには、…)
  const NAME_KEYS = { worker: 'nameWorker', parent: 'nameParent', student: 'nameStudent' };
  const TAB_KEYS = { chain: 'tabChain', lockout: 'tabLockout', compare: 'tabCompare', rules: 'tabRules' };

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
  // Tab 3: the steps and backdoors after a change are computed with the person after it (no personaVectors here), per
  // person, change and card; the diagram before and after a change per person, change and language. Both keep the eight
  // entries used last only (View.recentCache: the change shown, and the few just before it when the map before and after
  // or the language is switched): going through every change of the three people would otherwise keep one entry per
  // change, card and language for as long as the page is open.
  const AFTER_CACHE_SIZE = 8;
  const afterCache = View.recentCache(AFTER_CACHE_SIZE);
  function afterFor(id, moveId, card) {
    return afterCache(id + '|' + moveId + '|' + card, () => View.afterMap(persona(id), moveId, card));
  }
  const afterLayoutCache = View.recentCache(AFTER_CACHE_SIZE);
  function afterLayoutFor(id, moveId, language, q) {
    return afterLayoutCache(id + '|' + moveId + '|' + language, () => View.layout(persona(id), q, Messages, language));
  }

  const state = {
    language: queryLanguage || validLanguage(stored('language')) || (navigator.language.startsWith('ja') ? 'ja' : 'en'),
    theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
    tab: 'chain',
    persona: 'worker',
    card: 'leak',
    step: 0,
    account: DEFAULT_ACCOUNT.worker,
    // false while the account is the default one of the person (the detail then says it is shown as an example)
    accountPicked: false,
    mode: 'all',
    move: null,
    mapPhase: 'after',
    // The map before and after the change (tab 3) keeps its own attack card and its own chosen account, apart from those of tab 1:
    // pressing them never changes "Follow the chain". Both are set again whenever another change is shown (setMove)
    mapCard: 'leak',
    mapAccount: null,
    playing: false
  };
  // The short message under the person band; kept as a key so that it can follow the language.
  let announcement = null;
  let playTimer = null;

  const t = (key, values = {}) => (Messages[state.language][key] ?? key)
    .replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => String(values[name] ?? '{' + name + '}'));
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
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
  // in one nowrap span: in "パスワードA＋SMS" the ＋ is never left alone on a line of a narrow cell. The printed
  // lockout cells keep "と×）" together that way; the 390px screen has no room for that.
  // Two labels never break inside (WHOLE), not even where the rules above allow it: （4枚の合計）, the counts summed over the
  // four cards in tab 3 (the effects of the candidates and the headings of the same-entrance table), and SMS（電話番号）, the
  // SMS requirement on the line under the lockout table. A 320px screen would otherwise break them as （4枚の｜合計） and
  // SMS｜（電話番号）.
  // The piece that holds one goes out in one nowrap span like a piece with ＋ (keep-all does not hold SMS and （ together).
  // So do two words of kanji and katakana that the rule between katakana and kanji would split (回復｜コード, 認証｜アプリ in the
  // change sentences of tab 3 on a 320px screen), and the tag 回復コード（紙） of the map after a change, which
  // would otherwise leave （紙） alone at the head of a line in a narrow cell.
  // A long katakana word made of two words (SPLITS) may break only between them: ソーシャル｜エンジニアリング, so that the card
  // name fits a narrow button or column without breaking inside a word. て before a kanji is a break as well (変えて｜比べる).
  // Text without Japanese comes back as it is (English breaks at its spaces).
  const PARTICLES = 'のでをにがはとかもへやて';
  const NO_LINE_START = '、。，．・：；？！ー）」』】〕ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ';
  const JOINED = '＋＝／→';
  const WHOLE = ['（' + Messages.ja.termSum + '）', Messages.ja.lockTagPhone, Messages.ja.tagPaper, '回復コード', '認証アプリ',
    // Short noun phrases used inside lesson table cells and labels (「次の段で開く」 など): keep them whole so a column tight
    // for width does not break them at a particle (次の／段で開く)
    '次の段', 'いまの段'];
  // A short quote in a sentence (the name of a button, such as 「次の段 ▶」) never breaks inside either, not even at its space
  const SHORT_QUOTE = /「[^「」]{1,10}」/g;
  const SPLITS = ['ソーシャル|エンジニアリング'];
  const scriptOf = (ch) => (/[\u30a0-\u30ff]/.test(ch) ? 'katakana' : /[\u3400-\u4dbf\u4e00-\u9fff]/.test(ch) ? 'kanji'
    : /[\u3040-\u309f]/.test(ch) ? 'hiragana' : 'other');
  function phrases(text, keep = '') {
    const joined = JOINED + keep;
    const chars = [...text], out = [];
    // inside: the places between two characters of a whole label (i: between chars[i] and chars[i + 1])
    const inside = new Set();
    const wholes = [...WHOLE, ...(text.match(SHORT_QUOTE) || [])];
    for (const label of wholes) {
      const size = [...label].length;
      for (let at = text.indexOf(label); at >= 0; at = text.indexOf(label, at + label.length)) {
        const start = [...text.slice(0, at)].length;
        for (let i = start; i < start + size - 1; i++) inside.add(i);
      }
    }
    // split: the places inside a long katakana word where a line may break (i: between chars[i] and chars[i + 1])
    const split = new Set();
    for (const word of SPLITS) {
      const whole = word.replace('|', ''), head = [...word.split('|')[0]].length;
      for (let at = text.indexOf(whole); at >= 0; at = text.indexOf(whole, at + whole.length)) {
        split.add([...text.slice(0, at)].length + head - 1);
      }
    }
    let piece = '';
    const flush = () => {
      const marked = ([...piece].slice(1).some((ch) => joined.includes(ch)) && !/\s/.test(piece))
        || wholes.some((label) => piece.includes(label));
      out.push(marked ? E('span', { class: 'joined' }, piece) : piece);
      piece = '';
    };
    chars.forEach((ch, i) => {
      piece += ch;
      const next = chars[i + 1];
      if (next === undefined || NO_LINE_START.includes(next) || joined.includes(next) || inside.has(i)) return;
      const pair = scriptOf(ch) + '>' + scriptOf(next);
      if ((PARTICLES.includes(ch) && scriptOf(next) !== 'hiragana') || pair === 'katakana>kanji' || pair === 'kanji>katakana'
        || (next === '（' && ch !== ' ') || ch === '）' || '：＋＝／→・、'.includes(ch) || split.has(i)) {
        flush();
        out.push(E('wbr'));
      }
    });
    if (piece) flush();
    return out;
  }
  // The text of an element, its Japanese words kept whole (phrases() and word-break: keep-all in style.css)
  const setWords = (element, text) => element.replaceChildren(...phrases(text));
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
    setWords($('person-counts'), t('personCounts', { n: counts.accounts, f: counts.families, symbols: counts.symbols.join(t('sepList')) }));
    // The setting of the person shown, under the three buttons in every tab ("Haruto's setup: …")
    $('story').replaceChildren(E('strong', { class: 'story-head' }, t('storyHead', { name: t(NAME_KEYS[state.persona]) })),
      state.language === 'en' ? ' ' : '', ...phrases(t(STORY_KEYS[state.persona])));
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
      // A tab name wraps only between its words (for example 1つ変えて／比べる on a 320px screen)
      tab.replaceChildren(...phrases(t(tab.dataset.i18n)));
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $('panel-' + name).hidden = !selected;
    }
  }
  // The three buttons at the top right carry words: the theme button names the theme it switches to, the language button the
  // language (EN, or 日本語 on the English page), and the help button says that the lessons are there. Each has a tooltip.
  function renderHeader() {
    setWords($('theme-label'), t(state.theme === 'dark' ? 'themeToLight' : 'themeToDark'));
    $('theme').title = t(state.theme === 'dark' ? 'themeTitleLight' : 'themeTitleDark');
    $('language').textContent = state.language === 'ja' ? 'EN' : '日本語';
    $('language').title = t('languageTitle');
    $('help').title = t('helpTitle');
  }

  // ===== Tab 1: follow the chain =====
  // The email-takeover card (tab 1) and mode (tab 3) name the email of the person taken over: the old email, the ISP email or
  // the university email (cardMailButton). The other card names are the same for the three people (index.html).
  function renderMailButtons(p) {
    const mailId = Core.cardGives(p, p.cards.find((c) => c.id === 'mail'))[0];
    const label = t('cardMailButton', { mail: View.names(p, Messages, state.language).mid[mailId].replace(/^the /, '') });
    for (const id of ['card-mail', 'mode-mail', 'after-card-mail']) $(id).replaceChildren(...phrases(label));
  }
  // The three highlights of the person: a number (1 is where to start), the title, and for a highlight that opens another tab,
  // the tab it moves to. The highlight whose scene is shown carries "shown" (aria-current) while the guide stays.
  function renderHighlights(pv) {
    const items = View.highlights.filter((h) => h.person === state.persona).map((h, i) => {
      const shown = guide !== null && guide.id === h.id;
      const button = E('button', { type: 'button', class: 'highlight-button', 'data-key': 'hl:' + h.id, 'aria-current': shown ? 'true' : null },
        E('span', { class: 'hl-num', 'aria-hidden': 'true' }, String(i + 1)),
        E('span', { class: 'hl-text' }, E('span', { class: 'hl-title' }, phrases(View.highlightTitle(h, pv, Messages, state.language))),
          h.state.tab !== 'chain' ? E('span', { class: 'hl-dest' }, phrases(t('hlDest', { tab: t(TAB_KEYS[h.state.tab]) }))) : null,
          shown ? E('span', { class: 'hl-shown' }, t('hlShown')) : null));
      button.addEventListener('click', () => pressHighlight(h));
      return button;
    });
    $('highlights').replaceChildren(...items);
  }
  function renderSteps(last) {
    const edge = (id, atEdge) => {
      if (atEdge) $(id).setAttribute('aria-disabled', 'true'); else $(id).removeAttribute('aria-disabled');
    };
    setLabel($('step-first'), t('stepFirst'));
    setLabel($('step-prev'), t('stepPrev'));
    setLabel($('step-next'), t('stepNext'));
    setLabel($('step-last'), t('stepLast'));
    setLabel($('step-play'), t(state.playing ? 'stop' : 'play'));
    edge('step-first', state.step === 0);
    edge('step-prev', state.step === 0);
    edge('step-next', state.step >= last);
    edge('step-last', state.step >= last);
    $('step-play').setAttribute('aria-pressed', String(state.playing));
  }
  // The line under the step line keeps its place at every step (the diagram and the table never move when a step is pressed):
  // how to read the steps, then at the last step how to go back to step 0, or once the notice after "▶ Play" with reduced motion
  let hintNotice = null;
  function renderStepHint(last) {
    const key = hintNotice || (last === 0 ? null : state.step >= last ? 'stepHint' : 'stepGuide');
    setWords($('step-hint'), key ? t(key) : '');
    $('step-hint').classList.toggle('notice', hintNotice !== null);
  }
  // The legend above the diagram: a drawing of each mark (the same classes as the diagram), then how to read it
  function keySample(kind) {
    const svg = S('svg', { class: 'key-sample', width: 30, height: 14, viewBox: '0 0 30 14', 'aria-hidden': 'true', focusable: 'false' });
    if (['login', 'recovery', 'hot'].includes(kind)) {
      const link = S('g', { class: 'map-link ' + (kind === 'recovery' ? 'recovery' : 'login') + (kind === 'hot' ? ' hot' : '') });
      link.append(S('path', { d: 'M 2 7 L 25 7', class: 'map-line ' + (kind === 'recovery' ? 'recovery' : 'login') }),
        S('circle', { cx: 25, cy: 7, r: 2.6, class: 'map-end' }));
      svg.append(link);
    } else if (kind === 'select') svg.append(S('rect', { x: 2, y: 1, width: 26, height: 12, rx: 2, class: 'map-select' }));
    else svg.append(S('rect', { x: 3, y: 2, width: 24, height: 10, class: 'map-card fallen' + (kind === 'now' || kind === 'fallen' ? ' now' : '') }));
    return svg;
  }
  const KEY_ITEMS = [['login', 'symbolLog'], ['recovery', 'symbolRec'], ['hot', 'keyHot'], ['now', 'keyNow'], ['earlier', 'keyEarlier'],
    [null, 'keyRank'], [null, 'keyOpen']];
  // The legend (one line above the diagram) and how to read the diagram (one line under it). The dotted frame of the account chosen
  // in the table is told with the table's own guidance
  // A mark written in the legend ("●1", "used") looks as it does in the diagram (the part before ＝ or " = ")
  function keyText(text) {
    const at = text.search(/＝| = /);
    if (!/^(?:●|[^＝=]{1,6}(?:＝| = ))/.test(text) || at < 0) return phrases(text);
    return [E('span', { class: 'key-mark' }, text.slice(0, at)), ...phrases(text.slice(at))];
  }
  function renderMapKey() {
    if ($('chain-key').getAttribute('data-drawn') === state.language) return;
    $('chain-key').replaceChildren(E('ul', { class: 'key-items' }, KEY_ITEMS.map(([kind, key]) => E('li', {}, kind ? keySample(kind) : null,
      E('span', {}, kind ? phrases(t(key)) : keyText(t(key)))))));
    $('chain-howto').replaceChildren(...phrases(t('mapHowto')));
    $('chain-key').setAttribute('data-drawn', state.language);
  }
  // The legend above the diagram of the map after a change (tab 3 has no steps: a fallen box is filled, whatever its step). The marks
  // of the change are drawn as they are on the map: the tags 守れた and 新たに倒れる (then what they mean), and the dotted frame of
  // what the change changes (an entrance, and a box the change adds)
  const AFTER_KEY_ITEMS = [['login', 'symbolLog'], ['recovery', 'symbolRec'], ['hot', 'keyHot'], ['fallen', 'keyFallen'], [null, 'keyRank'],
    [null, 'keyOpen'], ['saved', 'attackLegendSaved'], ['newly', 'attackLegendNewly'], ['changed', 'keyChanged']];
  // A mark written as a tag (守れた, 新たに倒れる, ここを変える …): the same look in the legends, the table and the detail
  const markTag = (kind, text) => E('span', { class: 'tag tag-' + kind }, text);
  const MARK_KEYS = { saved: 'mapBadgeSaved', newly: 'mapBadgeNewly' };
  // A legend item whose mark (the part before ＝) is drawn as a tag: 守れた and 新たに倒れる with the words of the tags on the map
  // and in the table (in English, "saved" and "newly fallen")
  function taggedText(kind, text) {
    const at = text.search(/＝| = /);
    return [markTag(kind, MARK_KEYS[kind] ? t(MARK_KEYS[kind]) : text.slice(0, at)), ...phrases(text.slice(at))];
  }
  function renderAfterKey() {
    if ($('after-key').getAttribute('data-drawn') === state.language) return;
    $('after-key').replaceChildren(E('ul', { class: 'key-items' }, AFTER_KEY_ITEMS.map(([kind, key]) => {
      if (kind === 'saved' || kind === 'newly') return E('li', {}, E('span', {}, taggedText(kind, t(key))));
      if (kind === 'changed') return E('li', {}, E('span', { class: 'key-changed', 'aria-hidden': 'true' }), E('span', {}, phrases(t(key))));
      return E('li', {}, kind ? keySample(kind) : null, E('span', {}, kind ? phrases(t(key)) : keyText(t(key))));
    })));
    $('after-key').setAttribute('data-drawn', state.language);
  }
  // The diagram (wide screens only; CSS hides it below 720px). Drawn in order: column headings, lines (the lines the attacker
  // followed are moved to a group drawn over the others), credential boxes, account cards, marks.
  // It is built once per person and language; a step or a card only changes the classes, the marks and the two texts.
  // phase (tab 3 only): 'before' draws the person before the change (without the credentials the change adds), 'after' the
  // person after it. The changed entrance gets a dotted border and a tag under its text (before: ここを変える or ここを外す,
  // after: 変えた or 外した); after the change, a removed entrance keeps its place with its old text struck through (no line goes
  // to it), and a box the change adds (a password of its own, the paper codes) gets the dotted border too, with its account under
  // its name.
  function buildMap(L, prefix, phase = null) {
    const svg = S('svg', { class: 'map-svg', role: 'img', 'aria-labelledby': prefix + '-svg-title', 'aria-describedby': prefix + '-svg-desc',
      width: L.width, height: L.height, viewBox: '0 0 ' + L.width + ' ' + L.height });
    svg.append(S('title', { id: prefix + '-svg-title' }), S('desc', { id: prefix + '-svg-desc' }));
    const heads = S('g', { class: 'map-heads' });
    for (const head of L.heads) for (const line of head.lines) heads.append(S('text', { x: line.x, y: line.y, class: 'map-col-head' }, line.value));
    const lines = S('g', { class: 'map-lines' });
    for (const line of phase === 'before' ? L.linesBefore : L.lines) {
      const link = S('g', { class: 'map-link ' + line.role, 'data-from': line.from, 'data-to': line.to });
      link.append(S('path', { d: line.d, class: 'map-line ' + line.role }), S('circle', { cx: line.end[0], cy: line.end[1], r: 2.6, class: 'map-end' }));
      lines.append(link);
    }
    const boxes = S('g', { class: 'map-boxes' });
    for (const id of L.columns[0]) {
      const b = L.box[id];
      if (phase === 'before' && b.added) continue;
      const group = S('g', { class: 'map-item', 'data-node': id });
      group.append(S('title', {}, b.title));
      group.append(S('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'map-box' }));
      for (const line of b.lines) group.append(S('text', { x: line.x, y: line.y, class: 'map-text' }, line.value));
      for (const line of b.sub) group.append(S('text', { x: line.x, y: line.y, class: 'map-text map-sub' }, line.value));
      if (phase === 'after' && b.added) group.append(S('rect', { x: b.x + 3, y: b.y + 3, width: b.w - 6, height: b.h - 6, class: 'changed' }));
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
          const removed = phase === 'after' && !r.after;
          const text = phase === 'after' && !removed ? r.after : r.before;
          group.append(S('line', { x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y, class: 'map-divider' }));
          if (!text) continue;
          const row = S('g', { class: 'map-row' + (removed ? ' removed' : ''), 'data-row': key });
          if (text.title) row.append(S('title', {}, text.title));
          row.append(S('text', { x: text.role.x, y: text.role.y, class: 'map-text map-role' }, text.role.value));
          for (const line of text.lines) row.append(S('text', { x: line.x, y: line.y, class: 'map-text map-row-text' }, line.value));
          group.append(row);
          if (phase && r.changed) {
            const tag = t((r.after ? 'changedTag' : 'removedTag') + (phase === 'after' ? 'After' : 'Before'));
            const change = S('g', { class: 'map-change', 'data-row': key });
            change.append(S('rect', { x: r.x + 3, y: r.y + 2, width: r.w - 6, height: r.h - 4, class: 'changed' }),
              S('text', { x: r.tag.x, y: r.tag.y, 'text-anchor': 'end', class: 'map-text map-tag' }, tag));
            group.append(change);
          }
        }
        cards.append(group);
      }
    }
    svg.append(heads, lines, S('g', { class: 'map-hot' }), boxes, cards, S('g', { class: 'map-marks' }));
    return svg;
  }
  // The state of one step. A box or card that fell at this step is filled and has a thick border; one that fell at an earlier
  // step keeps the thick border only (the two differ by the fill, not by color alone). The lines into the entrances the attacker
  // used are thick and drawn over the others, with "used" at the end of the entrance and ●step on the box.
  // options.selected: the account chosen in the table (a dotted frame around its card).
  // options.badges: marks drawn on the top edge of a box ([{ node, kind, text }], kind = 'saved' or 'newly'; the map after a change).
  // options.fillAll: every fallen box is filled (the map after a change has no steps: it is always at the last step)
  function paintMap(svg, L, result, step, title, desc, options = {}) {
    const fallen = (id) => result.rank[id] !== undefined && result.rank[id] <= step;
    const opened = new Set(Object.entries(result.via).filter(([id]) => fallen(id)).map(([, via]) => via));
    const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
    setText(svg.querySelector(':scope > title'), title);
    setText(svg.querySelector(':scope > desc'), desc);
    const usual = svg.querySelector('.map-lines'), hot = svg.querySelector('.map-hot');
    for (const link of svg.querySelectorAll('.map-link')) {
      const isHot = opened.has(link.dataset.to);
      link.classList.toggle('hot', isHot);
      if (link.parentNode !== (isHot ? hot : usual)) (isHot ? hot : usual).append(link);
    }
    for (const item of svg.querySelectorAll('.map-item')) {
      const rect = item.querySelector('.map-box, .map-card');
      rect.classList.toggle('fallen', fallen(item.dataset.node));
      rect.classList.toggle('now', fallen(item.dataset.node) && (options.fillAll === true || result.rank[item.dataset.node] === step));
    }
    const marks = [];
    const mark = (at, className, data, text) => S('text', { x: at.x, y: at.y, 'text-anchor': 'end', class: className, ...data }, text);
    for (const [key, r] of Object.entries(L.rows)) if (opened.has(key)) marks.push(mark(r.mark, 'map-mark map-open', { 'data-row': key }, t('openTag')));
    for (const [id, b] of Object.entries(L.box)) if (fallen(id)) marks.push(mark(b.mark, 'map-mark', { 'data-node': id }, '●' + result.rank[id]));
    const chosen = options.selected && L.box[options.selected];
    if (chosen) {
      marks.push(S('rect', { x: chosen.x - 4, y: chosen.y - 4, width: chosen.w + 8, height: chosen.h + 8, rx: 3, class: 'map-select',
        'data-node': options.selected }));
    }
    for (const badge of options.badges || []) {
      const b = L.box[badge.node];
      if (!b || !b.badge) continue;
      // The tag sits on the top edge, a little above its middle, so that it never touches the ●step under it
      const w = Math.ceil(View.textWidth(badge.text) * 11 / 14) + 10;
      const tag = S('g', { class: 'map-badge map-badge-' + badge.kind, 'data-node': badge.node });
      tag.append(S('rect', { x: b.badge.x - w, y: b.badge.y - 11, width: w, height: 15, rx: 3 }),
        S('text', { x: b.badge.x - 5, y: b.badge.y + 0.5, 'text-anchor': 'end' }, badge.text));
      marks.push(tag);
    }
    svg.querySelector('.map-marks').replaceChildren(...marks);
  }
  function renderChainFigure(p, result) {
    const status = View.stepStatus(p, result, state.card, state.step, Messages, state.language);
    const desc = readable(state.step < View.maxRank(result)
      ? t('stepStatusWithSummary', { status, summary: View.stepSummary(p, result, Messages, state.language, state.card) }) : status);
    const L = layoutFor(state.persona, state.language);
    const drawn = state.persona + '|' + state.language;
    let svg = $('chain-figure').querySelector(':scope > svg.map-svg');
    if (!svg || svg.getAttribute('data-drawn') !== drawn) {
      const fresh = buildMap(L, 'chain');
      fresh.setAttribute('data-drawn', drawn);
      if (svg) svg.replaceWith(fresh); else $('chain-key').after(fresh);
      svg = fresh;
    }
    paintMap(svg, L, result, state.step, View.mapCaption(p, state.card, state.step, Messages, state.language), desc,
      { selected: state.accountPicked ? state.account : null });
  }
  // The entrances of one account, one line each (tab 1). The map after a change writes its own lines (afterItems)
  const entranceItems = (row) => row.entrances.map((text) => E('li', {}, phrases(text)));
  // A map table (tab 1, and the map before or after a change in tab 3). keyPrefix tells where the names are.
  // The chosen account's row has a dark frame and its name a "selected" tag (not a color that could read as safe). A row that
  // fell at the step shown has a bar on its left (its words are read). options.detail: an element put in a row of its own right
  // under the chosen account (tab 1: its entrances and how it falls; tab 3: how it falls before and after the change), so that
  // pressing a name never moves the page. options.chosen and options.onSelect: the account chosen and what a name does (tab 1:
  // state.account; the map after a change keeps its own, state.mapAccount). options.items: the lines of the entrances column;
  // options.mark: an element put after the result (tab 3: the tag 守れた or 新たに倒れる)
  function mapTable(rows, caption, keyPrefix, options = {}) {
    const chosenId = options.chosen === undefined ? state.account : options.chosen;
    const items = options.items || entranceItems;
    const body = rows.flatMap((row) => {
      const cell = row.cell;
      const chosen = row.id === chosenId;
      const name = nameButton(row, keyPrefix + ':' + row.id, chosen, () => (options.onSelect ? options.onSelect(row.id) : selectAccount(row.id)));
      if (chosen) name.append(E('span', { class: 'tag tag-chosen', 'aria-hidden': 'true' }, t('chosenTag')));
      const tr = E('tr', { class: [cell.thisStep ? 'this-step' : '', chosen ? 'selected' : ''].join(' ').trim() || null },
        E('th', { scope: 'row' }, name, E('ul', { class: 'entrance-list entrances-inline' }, items(row))),
        E('td', { class: 'entrances-cell' }, E('ul', { class: 'entrance-list' }, items(row))),
        E('td', { class: 'result-cell' + (cell.fallen ? ' fallen' : '') }, symbol(phrases(cell.text), cell.sr),
          cell.backdoor ? E('span', { class: 'tag tag-backdoor' }, symbol(t('cellBackdoor'), t('srBackdoor'))) : null,
          options.mark ? options.mark(row) : null,
          cell.thisStep ? E('span', { class: 'visually-hidden' }, ' ' + t('cellThisStep')) : null));
      return chosen && options.detail ? [tr, E('tr', { class: 'detail-row' }, E('td', { colspan: narrowQuery.matches ? 2 : 3 }, options.detail))] : [tr];
    });
    return E('table', { class: 'map-table' },
      E('caption', {}, phrases(caption)),
      E('thead', {}, E('tr', {}, E('th', { scope: 'col', class: 'col-account' }, t('colAccount')),
        E('th', { scope: 'col', class: 'col-entrances' }, t('colEntrances')), E('th', { scope: 'col', class: 'col-result' }, words(t('colWithCard'))))),
      E('tbody', {}, body));
  }
  // The two groups of the legend above the map table: the marks of the entrances column and those of the result column
  const LEGEND_GROUPS = [['legendEntrancesHead', ['legendPw', 'legendPhone', 'legendSms', 'legendInfo', 'legendDoc', 'legendMail', 'legendPlus']],
    ['legendCellHead', ['legendRank', 'legendVia', 'legendNone', 'legendBackdoor', 'legendThisStep', 'legendStar']]];
  function mapTableLegend() {
    return LEGEND_GROUPS.map(([head, items]) => E('div', { class: 'legend-group' }, E('p', { class: 'legend-head' }, phrases(t(head))),
      E('ul', { class: 'legend-items' }, items.map((key) => E('li', {}, phrases(t(key)))))));
  }
  function renderChainTable(p, result) {
    const rows = View.mapRows(p, result, state.step, Messages, state.language);
    if ($('chain-legend').getAttribute('data-drawn') !== state.language) {
      $('chain-legend').replaceChildren(...mapTableLegend());
      $('chain-legend').setAttribute('data-drawn', state.language);
    }
    $('chain-map').replaceChildren(mapTable(rows, View.mapTableCaption(p, state.card, state.step, Messages, state.language), 'chain-acct',
      { detail: detailBox }));
  }
  // The entrances of the chosen account and how it falls at the step shown (in its own row of the map table)
  function renderDetail(p, pv) {
    const d = View.detail(p, pv, state.card, state.account, Messages, state.language, state.step);
    detailBox.hidden = false;
    setWords($('detail-heading'), d.heading + (state.accountPicked ? '' : t('detailExample')));
    $('detail-body').replaceChildren(...[
      E('ul', { class: 'entrance-list detail-entrances' }, d.entrances.map((text) => E('li', {}, phrases(text)))),
      E('p', { class: 'detail-falls' }, phrases(d.falls)),
      d.backdoor ? E('p', { class: 'detail-backdoor' }, phrases(d.backdoor)) : null,
      E('p', { class: 'detail-need' }, phrases(d.need)),
      ...d.notes.map((note) => E('p', { class: 'note' }, phrases(note)))].filter(Boolean));
  }
  // A Japanese name in the four-cards table breaks only after "の" (the cell keeps words together in CSS).
  function breakAfterNo(text) {
    const parts = text.split('の');
    return parts.flatMap((part, i) => (i < parts.length - 1 ? [part + 'の', E('wbr')] : part ? [part] : []));
  }
  // The four-cards table (table.matrix): on wide screens, a grid of accounts × attack cards. Below 720px it stacks (one card
   // row of its own), so that no column shrinks to a word's length and the table never scrolls sideways. Each td carries its
   // card name as a label (shown only when stacked, via style.css .responsive-table .cell-label); the th scope="row" still
   // carries the account name as the row header. The stacked view looks like "card: result", one per row
  function renderFourCards(p, pv) {
    const f = View.fourCards(p, pv, Messages, state.language);
    const accountHead = t('colAccount');
    const table = E('table', { class: 'matrix responsive-table' },
      E('caption', {}, words(f.caption)),
      E('thead', {}, E('tr', {}, E('th', { scope: 'col', class: 'matrix-account' }, accountHead),
        f.columns.map((c) => E('th', { scope: 'col', class: 'matrix-card', 'data-label': c.full }, symbol(phrases(c.short), c.full))))),
      E('tbody', {}, f.rows.map((row) => E('tr', {},
        E('th', { scope: 'row', 'data-label': accountHead },
          E('span', { class: 'cell-label' }, words(accountHead)),
          E('span', { class: 'cell-value' }, row.important ? symbol('★', t('srImportant') + ' ') : null, breakAfterNo(row.name))),
        row.cells.map((cell, i) => E('td', { class: cell.text === t('cellNone') ? null : 'fallen', 'data-label': f.columns[i].full },
          E('span', { class: 'cell-label' }, phrases(f.columns[i].full)),
          E('span', { class: 'cell-value' }, symbol(cell.text, cell.sr))))))));
    $('four-cards-table').replaceChildren(table);
  }
  function renderChain() {
    const p = persona(state.persona), pv = vectorsFor(state.persona);
    const result = pv.cards[state.card];
    setWords($('start-here'), t(state.persona === 'parent' ? 'startHereParent' : 'startHere'));
    renderMailButtons(p);
    renderHighlights(pv);
    for (const card of CARDS) $('card-' + card).setAttribute('aria-pressed', String(card === state.card));
    setWords($('card-line'), View.cardLine(p, state.card, Messages, state.language));
    const note = View.cardNote(state.card, Messages, state.language);
    setWords($('card-note'), note || '');
    $('card-note').hidden = !note;
    const last = View.lastStep(pv, state.card);
    renderSteps(last);
    // The sentence of the current step, right under the step buttons (the live region below is written separately)
    $('step-line').replaceChildren(...phraseStars(View.stepLine(p, result, state.card, state.step, Messages, state.language)));
    renderStepHint(last);
    $('step-summary').replaceChildren(...phraseStars(View.stepSummary(p, result, Messages, state.language, state.card)));
    renderMapKey();
    renderChainFigure(p, result);
    renderChainTable(p, result);
    renderDetail(p, pv);
    renderFourCards(p, pv);
  }

  // ===== Tab 2: lockout =====
  // The entrances shown under the row chosen name the SMS requirement with the phone number (lockTagPhone), the column
  // they explain; DominoView.lockDetail gets the dictionary with that tag. Every other place keeps the tag SMS.
  const LOCK_LINE_MESSAGES = Object.fromEntries(Object.entries(Messages).map(([language, dictionary]) =>
    [language, { ...dictionary, tagPhone: dictionary.lockTagPhone }]));
  // The legend of the marks (each mark drawn as in the table, then its meaning) and the person's line above the table
  const LOCK_MARKS = [['lockMarkOk', 'ok'], ['lockMarkLocked', 'locked'], ['lockMarkPlus', 'plus'], ['lockMarkGone', 'gone']];
  const LOCK_STORY_KEYS = { worker: 'lockStoryWorker', parent: 'lockStoryParent', student: 'lockStoryStudent' };
  const lockMark = (mark, text) => E('span', { class: 'lock-mark lock-mark-' + mark, 'aria-hidden': 'true' }, text);
  // The loss that would turn △ into × ("番号も失うと×"): its × in the color of the lockout, kept on one line with the word
  // before it (so that × never starts a line)
  function lockCondition(text) {
    const at = text.lastIndexOf('×');
    const before = phrases(text.slice(0, at)), x = E('span', { class: 'lock-x' }, '×');
    const last = before.length && typeof before[before.length - 1] === 'string' && !/\s$/.test(before[before.length - 1]) ? before.pop() : null;
    return [...before, last ? E('span', { class: 'joined' }, last, x) : x, ...phrases(text.slice(at + 1))];
  }
  // A cell of the lockout table, its mark large and in the middle: × with the word 入れない under it, △ with the loss that
  // would make it ×, ○ and 消えた alone (the words read by screen readers are those of the cell)
  function lockCellContent(cell) {
    if (cell.mark === 'locked') return [lockMark('locked', cell.text), E('span', { class: 'lock-cell-word' }, t('lockLockedWord'))];
    const shown = cell.mark === 'plus'
      ? [lockMark('plus', t('cellPlusMark')), E('span', { class: 'lock-cell-cond', 'aria-hidden': 'true' }, lockCondition(cell.cond))]
      : [lockMark(cell.mark, cell.text)];
    return [...shown, E('span', { class: 'visually-hidden' }, cell.sr)];
  }
  function renderLockout() {
    const p = persona(state.persona), pv = vectorsFor(state.persona);
    const lt = View.lockTable(p, pv.lossTable, Messages, state.language);
    setWords($('lock-legend-mail'), lt.legendMail);
    const equals = state.language === 'ja' ? '＝' : ' = ';
    $('lock-legend-marks').replaceChildren(...LOCK_MARKS.map(([key, mark]) => {
      const text = t(key), at = text.indexOf(equals);
      return E('li', {}, E('span', { class: 'lock-mark lock-mark-' + mark }, text.slice(0, at)), phrases(text.slice(at)));
    }));
    setWords($('lock-story'), t(LOCK_STORY_KEYS[state.persona]));
    // The entrances of the account chosen, in a row right under its row (a name button chooses another), so that a × can
    // be read beside it
    const detail = View.lockDetail(p, state.account, LOCK_LINE_MESSAGES, state.language);
    const detailRow = E('tr', { id: 'lock-detail', class: 'lock-detail-row' }, E('td', { colspan: lt.columns.length + 1 },
      E('p', { class: 'lock-detail-head' }, phrases(detail.heading + (state.accountPicked ? '' : t('detailExample')))),
      E('ul', { class: 'entrance-list lock-detail-list' }, detail.entrances.map((text) => E('li', {}, phrases(text))))));
    const table = E('table', { class: 'lock-table' },
      E('caption', {}, phrases(lt.caption)),
      E('thead', {}, E('tr', {}, E('th', { scope: 'col', class: 'lock-account' }, t('colAccount')),
        lt.columns.map((c) => E('th', { scope: 'col', class: 'lock-col' }, phrases(c.head))))),
      E('tbody', {}, lt.rows.map((row) => {
        const chosen = row.id === state.account;
        const button = nameButton(row, 'lock-acct:' + row.id, chosen, () => selectLockAccount(row.id));
        if (chosen) {
          button.setAttribute('aria-describedby', 'lock-detail');
          button.append(E('span', { class: 'tag tag-chosen', 'aria-hidden': 'true' }, t('chosenTag')));
        }
        return [E('tr', { class: chosen ? 'selected' : null }, E('th', { scope: 'row' }, button),
          row.cells.map((cell) => E('td', { class: 'lock-' + cell.mark }, lockCellContent(cell)))), chosen ? detailRow : null];
      })));
    $('lock-map').replaceChildren(table);
    fitLockTable();
  }
  // A name of the lockout table opens its entrances right under its row. The entrances of the account chosen before close
  // above or below it, so the page scrolls by as much as the name moved and the name pressed stays where it was; then the
  // entrances come into view when they end below the screen (the name stays in view)
  function selectLockAccount(id) {
    const key = '[data-key="lock-acct:' + id + '"]';
    const before = document.querySelector(key).getBoundingClientRect().top;
    selectAccount(id, 'lockout');
    const button = document.querySelector(key);
    const moved = button.getBoundingClientRect().top - before;
    if (Math.abs(moved) > 0.5) scrollBy(0, moved);
    const bottom = $('lock-detail').getBoundingClientRect().bottom;
    if (bottom > innerHeight) scrollBy(0, Math.min(bottom - innerHeight + 8, button.getBoundingClientRect().top - 8));
  }
  // Below 720px each column of the lockout table is as wide as its longest word. When the panel is too narrow even for
  // that (a 320px screen), each name goes on a line of its own above its three marks (.names-above), so that no word is
  // split: the three columns of marks then take the full width
  function fitLockTable() {
    const frame = $('lock-map'), table = frame.querySelector('table');
    if (!table || !frame.getClientRects().length) return;
    table.classList.remove('names-above');
    if (table.getBoundingClientRect().width > frame.getBoundingClientRect().width + 0.5) table.classList.add('names-above');
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
  // A candidate: its rank on the left (1, 2, 3; read as 1位), the change and what else it does (newly fallen accounts, a
  // two-at-once lockout) in the middle, and its count large on the right with the important accounts among them (うち★2).
  // Every text keeps its Japanese words whole like the comparison heading (<wbr> and keep-all).
  // In the card modes, the list is drawn in two groups ("Changes that protect a ★ account" and "Other changes"), each
  // with a short heading above its candidates; the ranks (1, 2, 3) stay as the overall order in the list
  function renderCandidates(p, pv, found) {
    const candButton = (id, i) => {
      const face = View.effectFace(p, pv, id, state.mode, Messages, state.language);
      const button = E('button', { type: 'button', class: 'cand-button', 'data-key': 'cand:' + id, 'aria-pressed': String(id === state.move) },
        E('span', { class: 'cand-rank' }, symbol(String(i + 1), t('candRank', { n: i + 1 }))),
        E('span', { class: 'cand-main' }, E('span', { class: 'cand-title' }, words(View.moveTitle(p, moveOf(pv, id), Messages, state.language))),
          face.extras.length ? E('span', { class: 'cand-extra' }, words(face.extras.join(t('effectSep')))) : null),
        E('span', { class: 'cand-score' }, E('span', { class: 'cand-score-label' }, words(face.label)), ' ',
          E('span', { class: 'cand-score-n' }, String(face.n)), face.imp ? [' ', E('span', { class: 'cand-score-imp' }, phraseStars(face.imp))] : null));
      button.addEventListener('click', () => selectMove(id, 'reveal', button));
      return button;
    };
    const children = [];
    if (found.groups && (found.groups.impIds.length || found.groups.otherIds.length)) {
      const indexOf = (id) => found.ids.indexOf(id);
      if (found.groups.impIds.length) {
        children.push(E('h4', { class: 'cand-group-heading' }, phraseStars(t('candGroupImp'))));
        for (const id of found.groups.impIds) children.push(candButton(id, indexOf(id)));
      }
      if (found.groups.otherIds.length) {
        children.push(E('h4', { class: 'cand-group-heading' }, phrases(t('candGroupOther'))));
        for (const id of found.groups.otherIds) children.push(candButton(id, indexOf(id)));
      }
    } else {
      found.ids.forEach((id, i) => children.push(candButton(id, i)));
    }
    $('candidates').replaceChildren(...children);
    $('candidates').hidden = !found.ids.length;
    // The reason without candidates is a status message (#candidates-none sits in the live region #candidates-status). It is
    // written only when it changes, so that a redraw that changes nothing (the theme, for example) does not read it again.
    const reason = found.reason ? t(found.reason, { person: t(PERSON_KEYS[state.persona]), name: t(NAME_KEYS[state.persona]) }) : '';
    const none = $('candidates-none');
    if (none.textContent !== reason) setWords(none, reason);
    if (none.hidden !== !reason) none.hidden = !reason;
  }
  // Above the candidates: what the list holds (by mode), the legend of the words on the buttons (one item per line, only the
  // items the buttons use), and for the parent the rank of the bank change of her story. Hidden when there is no candidate.
  function renderCandidatesHead(p, pv, found) {
    const shown = found.ids.length > 0;
    setWords($('candidates-help'), shown ? t(state.mode === 'lockout' ? 'candidatesHelpLockout' : 'candidatesHelpCards') : '');
    $('candidates-help').hidden = !shown;
    const effects = found.ids.map((id) => View.effect(p, pv, id, state.mode));
    const keys = state.mode === 'lockout' ? ['legendUnlocked'] : [...(effects.some((e) => e.imp) ? ['legendImportant'] : []), 'legendSaved'];
    if (effects.some((e) => e.exposedAll)) keys.push('legendExposed');
    if (state.mode === 'all' || effects.some((e) => e.exposedAll)) keys.push('legendSum');
    if (effects.some((e) => e.pairNew)) keys.push('legendPairNew');
    if (found.ids.length > 1) keys.push(state.mode === 'lockout' ? 'legendOrderLockout' : 'legendOrderCards');
    $('candidates-legend').replaceChildren(...(shown ? keys.map((key) => E('li', {}, phrases(t(key)))) : []));
    $('candidates-legend').hidden = !shown;
    const story = shown ? View.storyMoveNote(p, found.ids, Messages, state.language) : null;
    setWords($('candidates-story'), story || '');
    $('candidates-story').hidden = !story;
  }
  // How changes are ranked: the small button beside the heading opens it under the list of changes (the button does not move)
  let rankingOpen = false;
  function renderRanking(found) {
    const toggle = $('ranking-toggle'), shown = found.ids.length > 0;
    toggle.hidden = !shown;
    toggle.setAttribute('aria-expanded', String(rankingOpen));
    toggle.replaceChildren(...phrases(t('rankingSummary')), ' ', E('span', { 'aria-hidden': 'true' }, rankingOpen ? '▲' : '▼'));
    const note = View.rankingNote(state.mode, Messages, state.language);
    const item = (text) => E('li', {}, phrases(text));
    $('ranking').replaceChildren(E('p', {}, phrases(note.excludeLead)), E('ul', {}, note.exclude.map(item)), E('p', {}, phrases(note.orderLead)),
      E('ol', {}, note.order.map(item)), E('p', { class: 'note' }, phrases(note.note)));
    $('ranking').hidden = !(rankingOpen && shown);
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
  // Attack (four cards), the same at every width: the counts before and after in one column (7→1, read "before 7, after 1"),
  // the saved and newly fallen counts, a light background on the rows that change, and a frame on the row of the mode's card.
  // The names of the accounts go to "See the account names" (closed; only the cards that change). The legend sits above the table.
  function renderAttack(rows) {
    const changed = rows.filter((r) => r.card !== 'all' && (r.saved || r.newly));
    $('attack-names').hidden = !changed.length;
    const legend = ['attackLegendSaved', 'attackLegendNewly', ...(rows.some((r) => r.selected) ? ['attackLegendFrame'] : []), 'attackLegendTotal'];
    $('attack-legend').replaceChildren(...legend.map((key) => E('li', {}, phrases(t(key)))));
    const heads = ['attackColCard', 'attackColBeforeAfter', 'attackColSaved', 'attackColNewly'].map((key) => t(key));
    const changedRow = (r) => r.card !== 'all' && (r.saved || r.newly);
    const rowClass = (r) => [r.card === 'all' ? 'total' : '', r.selected ? 'selected' : '', changedRow(r) ? 'changed' : ''].join(' ').trim() || null;
    // The title is shown above the legend; the caption with the same words names the table for screen readers.
    // The attack table stacks below 720px (responsive-table), so that no column shrinks and the table never scrolls sideways;
    // each cell carries the column heading as a label, shown only when stacked (style.css .responsive-table .cell-label)
    setWords($('attack-title'), t('attackCaption'));
    const cell = (content, head) => E('td', { 'data-label': head },
      E('span', { class: 'cell-label' }, words(head)), E('span', { class: 'cell-value' }, content));
    $('attack-area').replaceChildren(E('table', { class: 'attack-table responsive-table' },
      E('caption', { class: 'visually-hidden' }, t('attackCaption')),
      E('thead', {}, E('tr', {}, heads.map((heading, i) => E('th', { scope: 'col', class: 'attack-col-' + i, 'data-label': heading }, words(heading))))),
      E('tbody', {}, rows.map((r) => E('tr', { class: rowClass(r) },
        E('th', { scope: 'row', 'data-label': heads[0] },
          E('span', { class: 'cell-label' }, words(heads[0])),
          E('span', { class: 'cell-value' }, words(r.label), r.selected ? E('span', { class: 'visually-hidden' }, ' ' + t('attackMode')) : null)),
        cell(symbol(r.before + '→' + r.after, t('attackBeforeAfterSr', { before: r.before, after: r.after })), heads[1]),
        cell(String(r.saved), heads[2]), cell(String(r.newly), heads[3]))))));
    const names = (list) => (list.length ? words(list.join(t('sepList'))) : '0');
    $('attack-names-table').replaceChildren(...(changed.length ? [stackedTable('attack-names-list', t('attackNamesCaption'), [heads[0], heads[2], heads[3]],
      changed.map((r) => ({ cells: [r.label, names(r.savedNames), names(r.newlyNames)] })))] : []));
  }
  // The lockout table before and after the change: only the accounts whose cells change (hidden when none does). Each cell
  // shows its mark as the table of the Lockout tab does (lockCellContent: × with 入れない under it, △ with the loss that would
  // make it × under it, that × kept with the word before it), since the line above the table says the marks read the same
  function renderLockChanges(p, pv) {
    const lc = View.lockChanges(p, pv, state.move, Messages, state.language);
    $('lock-changes').hidden = !lc.rows.length;
    setWords($('lock-changes-mail'), lc.legendMail);
    $('lock-changes-table').replaceChildren(stackedTable('lock-changes-list', lc.caption, [t('colAccount'), ...lc.columns.map((c) => c.head)],
      lc.rows.map((row) => ({ cells: [[row.important ? symbol('★', t('srImportant') + ' ') : null, row.name], ...row.cells.map(lockCellContent)] }))));
  }
  // The rows of a summary (the comparison, and the result under the same-entrance table): a label, then its sentences one per line
  function summaryRows(rows) {
    return E('dl', { class: 'summary-rows' }, rows.map((row) => [E('dt', {}, words(row.label)),
      E('dd', {}, row.lines.map((line) => E('span', { class: 'summary-line' }, words(line))))]));
  }
  // Compare with the other changes to the same entrance: the change column holds buttons that pick the change; each lockout
  // change is a line of its own. The result of the change chosen is shown right under the pressed row (its title and summary),
  // so that pressing a row shows what it does where the finger is; the comparison above changes too (selectMove keeps the row
  // in place). Below 720px the stacked rows take up the width, and the result sits inside the chosen row's block, so a short
  // screen does not have to scroll past the other rows to see it. On wide screens the result sits right below the table.
  const sameNarrowQuery = matchMedia('(max-width: 719px)');
  function renderSame(p, pv, s) {
    const same = View.sameRows(p, pv, state.move, Messages, state.language);
    const heads = ['sameColMove', 'sameColSaved', 'sameColNewly', 'sameColLock', 'sameColPair'].map((key) => t(key));
    const lines = (list) => list.map((line) => E('span', { class: 'cell-line' }, words(line)));
    // Park #same-result back under #compare-result first; the next replaceChildren on #same-table would otherwise take it
    // out with the old rows (it may be inside the previous .selected row under 720px)
    const parkResult = $('compare-result');
    if ($('same-result').parentElement !== parkResult) parkResult.insertBefore($('same-result'), $('same-note'));
    $('same-table').replaceChildren(stackedTable('same-table', same.heading, heads, same.rows.map((r) => {
      const button = E('button', { type: 'button', class: 'same-button', 'data-key': 'same:' + r.id, 'aria-pressed': String(r.id === state.move) },
        words(r.move));
      button.addEventListener('click', () => selectMove(r.id, 'keep', button));
      return { attributes: { class: r.id === state.move ? 'selected' : null },
        cells: [button, String(r.saved), String(r.newly), lines(r.lock), lines(r.pair)] };
    })));
    $('same-result').replaceChildren(E('p', { class: 'same-result-label' }, words(t('sameResultLabel'))),
      E('p', { class: 'same-result-title' }, words(s.title)), summaryRows(s.rows));
    placeSameResult();
    // The note on removals, under the table when it has a removal that is not the change chosen (that one has the note above)
    setWords($('same-note'), same.removeNote || '');
    $('same-note').hidden = !same.removeNote;
  }
  // The result box sits inside the chosen row below 720px (right under where the finger pressed), and under the whole table
  // on wide screens. The chosen row carries .selected; its block has display: block below 720px, so the result div flows
  // as the next block inside it. Called from renderSame and from the resize listener for a redraw across 720px.
  function placeSameResult() {
    const result = $('same-result'), park = $('compare-result'), parkBefore = $('same-note');
    const selected = sameNarrowQuery.matches && state.move
      ? document.querySelector('#same-table tbody > tr.selected') : null;
    if (selected) {
      if (result.parentElement !== selected) selected.appendChild(result);
    } else if (result.parentElement !== park) {
      park.insertBefore(result, parkBefore);
    }
  }
  // The map before or after the change, always at the last step (the step buttons belong to tab 1). The steps, the
  // entrances used and the backdoors after the change come from the person after it (cardGives with that person).
  // Its attack card is its own (state.mapCard, apart from the card of tab 1): the four buttons above the map choose it.
  // The accounts that the change saves or newly lets fall with that card carry a tag on the map before and after alike, so
  // that pressing "Before" and "After" in turn shows them fall and stand. The table names its chosen account (state.mapAccount,
  // apart from tab 1's as well) and shows how it falls before and after the change right under its row.
  function renderAfterMap(p, pv) {
    const card = state.mapCard, phase = state.mapPhase;
    const after = afterFor(state.persona, state.move, state.mapCard);
    const before = phase === 'before';
    const X = before ? p : after.person, result = before ? pv.cards[card] : after;
    const step = View.maxRank(result);
    for (const id of CARDS) $('after-card-' + id).setAttribute('aria-pressed', String(id === card));
    for (const id of PHASES) $('phase-' + id).setAttribute('aria-pressed', String(id === phase));
    renderAfterNotice(p, View.afterCardNotice(p, pv, state.move, card, Messages, state.language));
    renderAfterKey();
    const L = afterLayoutFor(state.persona, state.move, state.language, after.person);
    const drawn = [state.persona, state.language, state.move, phase].join('|');
    let svg = $('after-figure').querySelector(':scope > svg.map-svg');
    if (!svg || svg.getAttribute('data-drawn') !== drawn) {
      const fresh = buildMap(L, 'after', phase);
      fresh.setAttribute('data-drawn', drawn);
      if (svg) svg.replaceWith(fresh); else $('after-key').after(fresh);
      svg = fresh;
    }
    paintMap(svg, L, result, step, View.afterCaption(p, card, phase, false, Messages, state.language),
      readable(View.stepStatus(X, result, card, step, Messages, state.language)),
      { fillAll: true, badges: View.afterBadges(p, pv, state.move, card, Messages, state.language) });
    // The legend of the table (the marks of the change follow the phase), then the table with the chosen account's detail under its row
    $('after-legend').replaceChildren(...View.afterLegend(p, pv, after, phase, Messages, state.language).map((group) => E('div', { class: 'legend-group' },
      E('p', { class: 'legend-head' }, phrases(group.head)),
      E('ul', { class: 'legend-items' }, group.items.map((item) => E('li', {}, item.mark ? taggedText(item.mark, item.text) : phrases(item.text)))))));
    const table = View.afterRows(p, pv, after, card, phase, Messages, state.language);
    const chosen = table.rows.some((row) => row.id === state.mapAccount) ? state.mapAccount : null;
    $('after-map-table').replaceChildren(mapTable(table.rows, View.afterCaption(p, card, phase, true, Messages, state.language), 'after-acct', {
      chosen, onSelect: selectMapAccount, items: (row) => afterItems(row, table.tag),
      mark: (row) => (row.mark ? markTag(row.mark, t(MARK_KEYS[row.mark])) : null),
      detail: chosen ? afterDetailBox(View.afterDetail(p, pv, after, card, chosen, Messages, state.language)) : null }));
  }
  // The line on the card of the map: with a card that the change affects, the cards it affects, and under the buttons Before and
  // After how the count of fallen accounts changes with this card and how to compare. With a card it does not affect, the cards it
  // does, each a button that shows the map with that card; when no card is affected, that alone.
  function renderAfterNotice(p, notice) {
    const nm = View.names(p, Messages, state.language);
    const parts = [E('p', {}, phrases(notice.kind === 'diff' ? notice.line : notice.text))];
    if (notice.kind === 'other') {
      parts.push(E('div', { class: 'after-show-buttons' }, notice.cards.map((card) => {
        const button = E('button', { type: 'button', class: 'after-show', 'data-key': 'after-show:' + card },
          phrases(t('afterShowCard', { card: nm.card[card] })));
        button.addEventListener('click', () => selectMapCard(card, null, true));
        return button;
      })));
    }
    $('after-card-note').replaceChildren(...parts);
    $('after-card-note').classList.toggle('notice', notice.kind !== 'diff');
    const status = $('after-status');
    // Two sentences: a space between them in English only
    status.replaceChildren(...(notice.kind === 'diff' ? [E('span', { class: 'after-count' }, phrases(notice.text)),
      state.language === 'en' ? ' ' : '', ...phrases(t('afterCompareHowto'))] : []));
    status.hidden = notice.kind !== 'diff';
  }
  // The lines of the entrances column of the map after a change: the changed entrance has a bar on its left and its tag at its end;
  // after the change, a removed entrance stays with its old text struck through
  function afterItems(row, tag) {
    return row.items.map((item) => E('li', { class: item.changed ? 'entrance-changed' : null },
      item.removed ? E('del', {}, phrases(item.text)) : phrases(item.text), item.changed ? markTag('changed', tag) : null));
  }
  // How the chosen account falls before and after the change (right under its row): its name and the card, its tag (守れた or
  // 新たに倒れる), the entrance changed when it is that account's, then the two phases
  function afterDetailBox(d) {
    return E('div', { class: 'detail after-detail' },
      E('p', { class: 'after-detail-head' }, E('strong', {}, phrases(d.heading)), d.mark ? markTag(d.mark, t(MARK_KEYS[d.mark])) : null),
      E('dl', { class: 'after-detail-rows' }, d.rows.map((row) => [E('dt', {}, phrases(row.label)), E('dd', {}, phrases(row.text))])));
  }
  // The summary is a live region. It is written again for every change chosen, even when its sentences stay the same (the
  // paper codes and the removal of the same entrance can read alike), and for another person or language; a redraw that
  // keeps the change (a mode with the same suggestion, the map before or after, the theme) leaves it as it is.
  let summaryDrawn = null;
  let summaryText = null;
  let summaryChosen = false;
  function renderComparison(p, pv, found) {
    const s = View.sentences(p, pv, state.move, Messages, state.language, state.mode);
    // The heading: the rank of the change among the top changes when it is one of them (1位の変更を表示中), then the change.
    // Its texts and the summary keep each Japanese word whole like the step line (a <wbr> of phrases() and keep-all in
    // style.css; a word longer than the line still breaks anywhere)
    const rank = found.ids.indexOf(state.move) + 1;
    $('compare-heading').replaceChildren(...(rank ? [E('span', { class: 'compare-rank-tag' }, words(t('compareRankTag', { rank })))] : []),
      E('span', { class: 'compare-title' }, words(s.title)));
    // The summary: what the change does (before → after), one row each for the attack, the lockout after one loss and
    // the lockout after two losses at once ("no change" when it does not change)
    const summary = $('compare-summary');
    const drawn = [state.persona, state.language, state.move].join('|');
    const text = s.rows.map((row) => row.label + '\n' + row.lines.join('\n')).join('\n');
    if (summaryChosen || drawn !== summaryDrawn || text !== summaryText) {
      summary.replaceChildren(E('p', { class: 'summary-lead' }, words(t('summaryLead'))), summaryRows(s.rows));
      summaryDrawn = drawn;
      summaryText = text;
    }
    summaryChosen = false;
    // Why the accounts are saved (before: which entrance they fell through; after: what no longer falls), when any is saved
    setWords($('compare-why'), s.why || '');
    $('compare-why').hidden = !s.why;
    renderAttack(s.attack);
    renderLockChanges(p, pv);
    $('move-notes').replaceChildren(...s.notes.map((note) => E('p', { class: 'note' }, phrases(note))));
    renderSame(p, pv, s);
    renderAfterMap(p, pv);
  }
  // Without a change (no suggestion for the mode), the comparison shows the guidance only; its parts are emptied so that
  // nothing of another language or person stays in them.
  function clearComparison() {
    // Park #same-result under #compare-result first, so that clearing #same-table does not take it out of the DOM
    const parkResult = $('compare-result');
    if ($('same-result').parentElement !== parkResult) parkResult.insertBefore($('same-result'), $('same-note'));
    for (const id of ['compare-heading', 'compare-summary', 'compare-why', 'attack-title', 'attack-legend', 'attack-area', 'attack-names-table',
      'lock-changes-mail', 'lock-changes-table', 'move-notes', 'same-table', 'same-result', 'same-note', 'after-card-note', 'after-status',
      'after-legend', 'after-map-table']) {
      $(id).replaceChildren();
    }
    $('same-note').hidden = true;
    $('compare-why').hidden = true;
    $('after-status').hidden = true;
    const svg = $('after-figure').querySelector(':scope > svg.map-svg');
    if (svg) svg.remove();
    summaryDrawn = null;
    summaryText = null;
    summaryChosen = false;
  }
  // The line at the top of tab 3 after the person was switched while the tab was open (the candidates and the comparison
  // below change, out of view on a phone); it goes away with the next thing pressed in the tab or another tab
  let comparePerson = null;
  let personNote = false;
  function renderCompare() {
    const p = persona(state.persona), pv = vectorsFor(state.persona);
    if (!keepingRoom && roomHeight) keepRoom(0);
    if (comparePerson !== null && comparePerson !== state.persona && state.tab === 'compare') personNote = true;
    if (state.tab !== 'compare') personNote = false;
    comparePerson = state.persona;
    setWords($('compare-person-note'), personNote ? t('comparePersonNote', { person: t(PERSON_KEYS[state.persona]), name: t(NAME_KEYS[state.persona]) }) : '');
    $('compare-person-note').hidden = !personNote;
    for (const mode of MODES) $('mode-' + mode).setAttribute('aria-pressed', String(mode === state.mode));
    const found = View.candidates(p, pv, state.mode);
    renderCandidatesHead(p, pv, found);
    renderCandidates(p, pv, found);
    renderRanking(found);
    renderChoice(p, pv, found);
    $('no-move').hidden = state.move !== null;
    $('compare-result').hidden = state.move === null;
    // The two buttons back up to the comparison name where they go; the ▲ is hidden from screen readers
    for (const id of ['back-to-compare-top', 'back-to-compare']) {
      $(id).replaceChildren(E('span', { 'aria-hidden': 'true' }, '▲'), ' ', ...phrases(t('backToCompare')));
    }
    if (state.move === null) clearComparison(); else renderComparison(p, pv, found);
  }

  // ===== Tab 4: rules, symbols and notes; the printed sheets =====
  // The related tools named in the paper notes open in a new tab (ordinary links that also work without JavaScript)
  const TOOL_LINKS = Object.fromEntries(View.relatedTools.map((tool) => [tool.id, { key: tool.name, href: tool.href }]));
  const newTabLink = (href, text, className = null) => E('a', { href, target: '_blank', rel: 'noopener noreferrer', class: className }, text);
  function withLinks(text) {
    return text.split(/\{(day\d+)\}/).map((part, i) => (i % 2 ? newTabLink(TOOL_LINKS[part].href, t(TOOL_LINKS[part].key), 'inline-link')
      : phrases(part)))
      .filter((part) => part !== '');
  }
  // The two symbols tables and the four notes depend on the language only, so they are drawn again only for another language.
  // Each note starts with its number and topic (注記1（SMS）…), the name the lessons use to point to it
  function renderRules() {
    const panel = $('panel-rules');
    if (panel.getAttribute('data-drawn') === state.language) return;
    const symbols = View.symbolTable(Messages, state.language), marks = View.markTable(Messages, state.language);
    $('symbol-table').replaceChildren(E('p', { class: 'table-intro' }, phrases(t('symbolsIntro'))), stackedTable('symbol-table',
      symbols.caption, symbols.columns, symbols.rows.map((row) => ({ attributes: { 'data-row': row.id }, cells: row.cells }))));
    $('mark-table').replaceChildren(E('p', { class: 'table-intro' }, phrases(t('markIntro'))),
      E('table', { class: 'mark-table' }, E('caption', {}, words(marks.caption)),
        E('thead', {}, E('tr', {}, marks.columns.map((heading, i) => E('th', { scope: 'col', class: i ? null : 'mark-symbol' }, words(heading))))),
        E('tbody', {}, marks.rows.map((row) => E('tr', { 'data-row': row.id }, E('th', { scope: 'row', class: 'mark-symbol' }, words(row.cells[0])),
          E('td', {}, words(row.cells[1])))))));
    const notes = [phrases(t('ruleNoteSms')), phrases(t('notePasskey', { sync: t('lockNoteSync') })), phrases(t('noteDesk')),
      withLinks(t('notePaperRules', { paper: t('notePaper') }))];
    $('rules-notes').replaceChildren(...notes.map((note, i) => E('li', {},
      E('span', { class: 'note-label' }, phrases(t('ruleNote' + (i + 1)))), ' ', note)));
    panel.setAttribute('data-drawn', state.language);
  }
  // The buttons at the top of the rules tab and of the help move to a section of it (its heading or table takes the focus)
  function goToSection(id) {
    const target = $(id);
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
  }
  // The printed sheets (hidden on screen): one page per person with the map table, then the blank sheet. They are built
  // in the current language once the three people are ready, and again when the language changes.
  let printLanguage = null;
  // The legend of the printed pages: the symbols of what an entrance needs, and + (the printed entrances join requirements
  // with it). The marks of the cells are told in the lines under it (PRINT_ABBR); the paper has no diagram, so no lines
  function printLegend() {
    const symbols = View.symbolTable(Messages, state.language), plus = View.markTable(Messages, state.language).rows.find((row) => row.id === 'Role');
    return E('table', { class: 'print-legend' }, E('caption', {}, words(symbols.caption)),
      E('thead', {}, E('tr', {}, symbols.columns.slice(0, 2).map((heading) => E('th', { scope: 'col' }, words(heading))))),
      E('tbody', {}, [...symbols.rows, plus].map((row) => E('tr', {}, E('th', { scope: 'row' }, words(row.cells[0])),
        E('td', {}, words(row.cells[1]))))));
  }
  // Under the legend: how to read the columns of the attack cards and of the losses, and ★ (the card names are written out
  // in the columns, so they need no legend)
  const PRINT_ABBR = ['printLegendAttack', 'printLegendLoss', 'printLegendStar'];
  function printPage(id) {
    const sheet = View.printTable(persona(id), vectorsFor(id), Messages, state.language);
    // Columns: account, entrances, the four attack cards (short marks kept on one line), then the three losses; a row of
    // group headings above them tells the attack cards from the losses. Japanese words stay whole (keep-all in print).
    const attacks = sheet.rows[0].attack.length, losses = sheet.rows[0].loss.length;
    const kind = (i) => (i < 2 ? null : i < 2 + attacks ? 'print-attack' : 'print-loss');
    // Every person's page carries the legend, so that one page handed out alone (the parent's, to talk it over with the
    // family) can still be read
    return E('section', { class: 'print-page', 'data-person': id, 'aria-labelledby': 'print-title-' + id },
      printLegend(), E('ul', { class: 'print-abbr' }, PRINT_ABBR.map((key) => E('li', {}, phrases(t(key))))),
      E('h2', { id: 'print-title-' + id }, sheet.title),
      E('p', { class: 'print-story' }, phrases(sheet.story)),
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
      E('p', { class: 'print-disclaimer' }, phrases(t('printDisclaimer'))));
  }
  const FORM_COLUMNS = ['formColNo', 'formColAccount', 'formColImportant', 'formColRole', 'formColReq', 'formColNotes'];
  const FORM_ROWS = 18;
  function formPage() {
    return E('section', { class: 'print-page print-form', 'aria-labelledby': 'print-title-form' },
      E('h2', { id: 'print-title-form' }, t('formTitle')),
      E('div', { class: 'print-keep' }, E('p', { class: 'print-keep-title' }, t('formKeepTitle')), E('p', {}, phrases(t('formKeepText'))),
        E('p', { class: 'print-dates' }, t('formDates'))),
      E('ul', { class: 'print-how' }, [1, 2, 3, 4, 5].map((n) => E('li', {}, phrases(t('formHow' + n))))),
      // Named like the map tables: a hidden caption with the heading's text
      E('table', { class: 'print-form-table' }, E('caption', { class: 'visually-hidden' }, t('formTitle')),
        E('thead', {}, E('tr', {}, FORM_COLUMNS.map((key) => E('th', { scope: 'col', class: 'form-' + key.slice(7).toLowerCase() }, words(t(key)))))),
        // The column of the kind of entrance is printed with both words, and the writer circles one (the other columns are blank)
        E('tbody', {}, Array.from({ length: FORM_ROWS }, (_, i) => E('tr', {}, E('td', {}, String(i + 1)),
          FORM_COLUMNS.slice(1).map((key) => E('td', { class: key === 'formColRole' ? 'form-role' : null },
            key === 'formColRole' ? t('formRoleCell') : null)))))),
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
  // The number of a lesson table (表1-1, 表2 …) heads its caption, and the paragraphs point to the table by that number:
  // the number is drawn the same way in both places (.table-ref), so the table a paragraph speaks of is seen at a glance
  const LESSON_TABLE_NO = View.lessonTableNumbers();
  const TABLE_REF = /(表\d+(?:-\d+)?|Table \d+(?:-\d+)?)/;
  const tableNo = (kind) => E('span', { class: 'table-ref' }, t('lessonTableNo', { no: LESSON_TABLE_NO[kind] }));
  // Only the numbers of the lesson's own tables are drawn as references (a table of a source, such as Table 5 of NIST, is not)
  const withTableRefs = (parts, own) => parts.flatMap((part) => (typeof part !== 'string' ? [part]
    : part.split(TABLE_REF).filter(Boolean).map((piece) => (TABLE_REF.test(piece) && own.includes(piece.replace(/^\D+/, ''))
      ? E('span', { class: 'table-ref' }, piece) : piece))));
  // A grid cell may head several rows (span: the card of lesson 3); the rows under it leave that place out (null). The first
  // rowHeads cells of a row are row headings
  function lessonTableElement(kind, table) {
    const caption = [tableNo(kind), ' ', words(table.caption)];
    if (!table.grid) {
      return stackedTable('lesson-table lesson-' + kind, caption, table.heads, table.rows.map((row) => ({ cells: row.map(lessonCell) })));
    }
    const heads = table.rowHeads || 1;
    return E('table', { class: 'lesson-table lesson-grid lesson-' + kind }, E('caption', {}, caption),
      E('thead', {}, E('tr', {}, table.heads.map((heading) => E('th', { scope: 'col' }, words(heading))))),
      E('tbody', {}, table.rows.map((row) => E('tr', { class: row[0] && row[0].span ? 'group-start' : null }, row.map((cell, i) => (cell === null ? null
        : E(i < heads ? 'th' : 'td', { scope: i < heads ? 'row' : null, rowspan: cell.span || null }, lessonCell(cell))))))));
  }
  function lessonBlock([kind, value], people, own) {
    if (kind === 'table') {
      return E('div', { class: 'table-frame' }, lessonTableElement(value, View.lessonTable(value, people, Messages, state.language)));
    }
    if (kind === 'links') return E('p', {}, withTableRefs(withLinks(t(value)), own));
    return E('p', { class: kind === 'p' ? null : kind === 'note' ? 'note' : 'map-legend' }, withTableRefs(phrases(t(value)), own));
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
      setWords($('lesson-' + lesson.n).querySelector(':scope > summary'), t('lesson' + lesson.n + 'Title'));
      const own = lesson.blocks.filter(([kind]) => kind === 'table').map(([, kind]) => LESSON_TABLE_NO[kind]);
      $('lesson-' + lesson.n + '-body').replaceChildren(...lesson.blocks.map((block) => lessonBlock(block, people, own)),
        ...(sources.length ? [E('p', { class: 'lesson-sources-label' }, t('lessonSources')), E('ul', { class: 'lesson-sources' }, sources)] : []));
    }
    lessonsLanguage = state.language;
  }

  // ===== Where a highlight takes you: the guide there, and the way back =====
  // The entrances and how the chosen account falls (index.html): drawn in a row of its own under that account in the map table
  const detailBox = $('detail');
  // While the guide is shown, guide = { id, scene }: the highlight and the state it set (scene). Any other operation changes the
  // scene (the person, tab, card, mode, change or account) and the guide goes; the steps, the theme and the language keep it.
  let guide = null;
  const SCENE = ['persona', 'tab', 'card', 'mode', 'move', 'account'];
  const scene = () => SCENE.map((key) => state[key]).join('|');
  const guideBox = E('div', { id: 'hl-guide', class: 'hl-guide', role: 'note', tabindex: '-1' });
  // The guide goes right above the part to look at: the comparison heading (tab 3), the lockout table (tab 2), the attack cards
  // (a scene at step 0, to be followed with "Next step ▶"), or for a scene at the end the summary above the diagram (wide screens)
  // or the map table, where the account's entrances and how it falls are shown under its row (narrow screens: no diagram)
  function guideAnchor(h) {
    if (h.state.tab === 'compare') return $('compare-heading');
    if (h.state.tab === 'lockout') return $('lock-map');
    if (h.target === 'step:next') return document.querySelector('#chain-stage > .stage-band');
    return narrowQuery.matches ? $('chain-map') : $('step-summary');
  }
  function renderGuide() {
    if (guide && guide.scene !== scene()) guide = null;
    const h = guide && View.highlights.find((x) => x.id === guide.id);
    if (!h) {
      guide = null;
      guideBox.remove();
      $('step-next').removeAttribute('aria-describedby');
      return;
    }
    const title = View.highlightTitle(h, vectorsFor(h.person), Messages, state.language);
    const from = h.state.tab === 'chain' ? t('hlGuideHere', { title }) : t('hlGuideMoved', { title, tab: t(TAB_KEYS[h.state.tab]) });
    const back = E('button', { type: 'button', class: 'hl-back', 'data-key': 'hl-back' }, t('hlBack'));
    back.addEventListener('click', backToHighlights);
    guideBox.replaceChildren(E('p', { class: 'hl-guide-from' }, phrases(from)),
      E('p', { class: 'hl-guide-look' }, phrases(t('hlGuideLook', { look: View.highlightLook(h, Messages, state.language) }))), back);
    const anchor = guideAnchor(h);
    if (guideBox.nextElementSibling !== anchor) anchor.before(guideBox);
  }
  // Does the state still show the scene of a highlight? (when the browser goes forward to it again)
  function showsHighlight(h) {
    const s = h.state, card = s.card || null;
    return h.person === state.persona && s.tab === state.tab && (!s.mode || s.mode === state.mode) && (!card || card === state.card)
      && (s.move === undefined || s.move === state.move) && (!s.account || s.account === state.account);
  }

  // ===== History: the tabs and the highlights are kept in the address (#chain, #lockout, #compare or #rules), so that the
  // browser's back button returns to the tab and the place on the page before. Only the tab goes into the address; the place
  // (scroll position), the focus and the highlight are kept with the history entry, never stored. =====
  const hashTab = () => (TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : null);
  function writeHistory(entry, push) {
    try {
      if (push) history.pushState(entry, '', '#' + entry.tab);
      else history.replaceState(entry, '');
    } catch (_) { /* A browser may refuse to write the history of a local file; the page works without it. */ }
  }
  // Before leaving the current place, keep it in the current entry as it is now (the tab, the guide if one is shown, where the page
  // was and what had the focus); then add the new place
  const currentPlace = () => ({ tab: state.tab, hl: guide ? guide.id : null, y: Math.round(scrollY),
    focus: document.activeElement?.dataset?.key || null });
  function go(entry) {
    writeHistory(currentPlace(), false);
    writeHistory(entry, true);
  }
  // The browser's back and forward buttons: the tab of the entry, its guide when the page still shows that scene, the place on the
  // page and the focus (the guide, or the tab chosen, when the entry kept no focus)
  addEventListener('popstate', (event) => {
    const entry = event.state && TABS.includes(event.state.tab) ? event.state : { tab: hashTab() || 'chain' };
    stopPlaying();
    state.tab = entry.tab;
    const h = entry.hl && View.highlights.find((x) => x.id === entry.hl);
    guide = h && showsHighlight(h) ? { id: h.id, scene: scene() } : null;
    clearStepStatus();
    render();
    if (typeof entry.y === 'number') scrollTo(0, entry.y);
    else if (guide) guideBox.scrollIntoView({ block: 'start' });
    else document.querySelector('.tabs').scrollIntoView({ block: 'start' });
    const target = (entry.focus && document.querySelector('[data-key="' + entry.focus + '"]')) || (guide ? guideBox : $('tab-' + state.tab));
    if (target.getClientRects().length) target.focus({ preventScroll: true });
  });

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
    // Every translated text gets the <wbr> of phrases(), so that a Japanese word stays whole wherever the line wraps
    // (word-break: keep-all in style.css): the tables, the buttons, the headings and the sentences alike
    document.querySelectorAll('[data-i18n]').forEach((el) => { setWords(el, t(el.dataset.i18n)); });
    document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    if (guide && guide.scene !== scene()) guide = null;
    renderHeader();
    renderPersons();
    renderTabs();
    renderChain();
    renderLockout();
    renderCompare();
    renderRules();
    renderGuide();
    renderPanelEnds();
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
    hintNotice = null;
    if (state.playing) {
      stopPlaying();
      render();
      return;
    }
    if (reducedMotion()) {
      state.step = lastStep();
      // The reason is shown under the step line as well as read: with reduced motion the last step is shown at once.
      // When step 0 is the only step (nothing falls to the card), the step and the summary are written instead.
      if (state.step > 0) hintNotice = 'reducedPlay';
      render();
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
  // The step buttons change the step only: the page does not move (on narrow screens the buttons and the step line stay at the
  // bottom of the screen while the map table is in view)
  function stepTo(kind) {
    const wasPlaying = state.playing;
    stopPlaying();
    hintNotice = null;
    const last = lastStep();
    const atEdge = kind === 'first' || kind === 'prev' ? state.step === 0 : state.step >= last;
    if (atEdge) {
      if (wasPlaying) render();
      return;
    }
    state.step = kind === 'first' ? 0 : kind === 'prev' ? state.step - 1 : kind === 'next' ? state.step + 1 : last;
    render();
    writeStepStatus();
  }

  // ===== Operations =====
  // A tab chosen with its button or the arrow keys: the tab before it stays in the history (the browser's back button)
  function selectTab(name) {
    stopPlaying();
    if (name !== state.tab) go({ tab: name });
    state.tab = name;
    render();
  }
  // Another card (or person) starts at step 0, as the page does when it opens
  function setCard(card) {
    state.card = card;
    state.step = 0;
    hintNotice = null;
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
    state.step = 0;
    hintNotice = null;
    state.account = DEFAULT_ACCOUNT[id];
    state.accountPicked = false;
    setMove(pv.best[state.mode], true);
    announcement = { key: 'statusPerson', person: id };
    clearStepStatus();
    render();
  }
  // A name chooses its account: in tab 1 its entrances and how it falls appear right under its row. The page is scrolled by
  // as much as the pressed button moved (the detail box moving from the previous row to this one changes the heights above),
  // so that the button under the finger stays where it was. On narrow screens the detail falls below the row and may go off
  // the bottom of the screen, in which case the page scrolls just enough to bring the detail's bottom back into view (never
  // so far that the button leaves the top).
  function selectAccount(id) {
    const key = '[data-key="chain-acct:' + id + '"]';
    const pressed = document.querySelector(key);
    const before = pressed ? pressed.getBoundingClientRect().top : null;
    state.account = id;
    state.accountPicked = true;
    render();
    if (before === null) return;
    const button = document.querySelector(key);
    if (!button || !button.getClientRects().length) return;
    const moved = button.getBoundingClientRect().top - before;
    if (Math.abs(moved) > 0.5) scrollBy(0, moved);
    if (!narrowQuery.matches) return;
    const detail = detailBox.getBoundingClientRect();
    if (detail.height && detail.bottom > innerHeight) {
      scrollBy(0, Math.max(0, Math.min(detail.bottom - innerHeight + 8, button.getBoundingClientRect().top - 8)));
    }
  }
  // The change shown in tab 3. Another change (or force: another person, a highlight, the start) sets the map after the change
  // afresh: its card is the one this change saves the most accounts from (the mode's card on a tie), and its chosen account
  // is the account whose entrance the change changes. Neither touches the card or the account of tab 1.
  function setMove(id, force = false) {
    const changed = force || id !== state.move;
    state.move = id;
    if (!changed || id === null) return;
    const p = persona(state.persona), pv = vectorsFor(state.persona);
    state.mapCard = View.afterCardFor(p, pv, id, state.mode);
    state.mapAccount = pv.moves.find((mv) => mv.id === id).service;
  }
  // Tab 3: a mode chooses the suggestion of that mode, the first of its top changes (pressing the mode already chosen keeps
  // the change). It leaves the card of tab 1 as it is: what the person chose there stays when they go back
  function selectMode(mode) {
    stopPlaying();
    personNote = false;
    if (mode !== state.mode) {
      state.mode = mode;
      setMove(vectorsFor(state.persona).best[mode]);
    }
    render();
  }
  // A change chosen with a candidate, the select or the same-entrance table: the summary is written (read) again.
  // anchor is the element pressed. how = 'reveal' (a candidate or the select): when the summary of the comparison is below the
  // screen, the page scrolls just enough to show it, but never so far that the element pressed leaves the top of the screen.
  // how = 'keep' (a row of the same-entrance table): the comparison above the table changes its height, and the page scrolls by
  // as much, so that the button pressed stays under the finger (and the next press does not hit another row)
  function selectMove(id, how = null, anchor = null) {
    const key = anchor && anchor.dataset.key;
    const before = anchor ? anchor.getBoundingClientRect().top : 0;
    setMove(id);
    summaryChosen = true;
    personNote = false;
    keepingRoom = how === 'keep';
    render();
    keepingRoom = false;
    const now = key ? document.querySelector('[data-key="' + key + '"]') : anchor;
    if (!now || !now.getClientRects().length) return;
    const top = now.getBoundingClientRect().top;
    if (how === 'keep') {
      // When the page was scrolled to its end and got shorter, it cannot scroll down by as much: the room at the end of the
      // tab grows by what is missing first
      const missing = top - before - (document.documentElement.scrollHeight - innerHeight - scrollY);
      if (missing > 0) keepRoom(roomHeight + missing);
      if (top !== before) scrollBy(0, top - before);
      return;
    }
    const bottom = $('compare-summary').getBoundingClientRect().bottom;
    if (how === 'reveal' && bottom > innerHeight) scrollBy(0, Math.max(0, Math.min(bottom - innerHeight + 16, top - 8)));
  }
  // The room at the end of tab 3: an empty SVG of the height needed (its height is an attribute; the page has no inline style).
  // It is kept while the same-entrance table is pressed again and again, and taken away by any other redraw of tab 3
  let roomHeight = 0;
  let keepingRoom = false;
  function keepRoom(height) {
    roomHeight = Math.max(0, Math.ceil(height));
    $('compare-room').replaceChildren(...(roomHeight ? [S('svg', { width: 1, height: roomHeight, focusable: 'false' })] : []));
  }
  function toggleRanking() {
    rankingOpen = !rankingOpen;
    personNote = false;
    render();
  }
  // The controls of the map after a change (its card, Before and After, a name in its table) redraw the map only, and the page
  // stays where it is: the element kept in place is the one pressed, or (below 720px, where Before and After stay at the bottom of
  // the screen) the first name of the table on the screen, so that the rows in view do not move when the rows above them change
  // their height. The room at the end of tab 3 is kept (taking it away could pull the page up under the finger).
  function keepPlace(anchor, change) {
    const key = anchor && anchor.dataset.key;
    const top = anchor ? anchor.getBoundingClientRect().top : 0;
    change();
    keepingRoom = true;
    render();
    keepingRoom = false;
    const now = key && document.querySelector('[data-key="' + key + '"]');
    if (!now || !now.getClientRects().length) return null;
    const moved = now.getBoundingClientRect().top - top;
    if (Math.abs(moved) > 0.5) scrollBy(0, moved);
    return now;
  }
  const nameInView = () => [...$('after-map-table').querySelectorAll('[data-key^="after-acct:"]')].find((button) => {
    const { top, bottom } = button.getBoundingClientRect();
    return button.getClientRects().length && top >= 0 && bottom <= innerHeight;
  });
  // The first row that changes between before and after (守れた or 新たに倒れる), so the press of a phase on a narrow screen
  // can bring the first difference into view when no row is on the screen yet
  function firstChangedRow() {
    const tag = $('after-map-table').querySelector('.tag-saved, .tag-newly');
    return tag ? tag.closest('tr') : null;
  }
  function selectPhase(phase, pressed) {
    const needsAfter = narrowQuery.matches && !nameInView();
    keepPlace((narrowQuery.matches && nameInView()) || pressed, () => { state.mapPhase = phase; });
    if (!needsAfter) return;
    const row = firstChangedRow();
    const bar = $('after-phase-bar').getBoundingClientRect();
    if (!row) return;
    const target = row.getBoundingClientRect();
    const floor = Math.min(innerHeight, bar.top);
    // The row is above the top: pull it just below the top; below the floor (above the sticky bar): bring its top just under the viewport top
    if (target.top < 0) scrollBy(0, target.top - 8);
    else if (target.bottom > floor) scrollBy(0, Math.min(target.bottom - floor + 8, target.top - 8));
  }
  // A card of the map after a change: from its four buttons, or from a button of the line that names the cards the change affects
  // (that line goes away, so the focus moves to the card's own button)
  function selectMapCard(card, pressed, fromNotice = false) {
    keepPlace(fromNotice ? $('after-card-' + state.mapCard) : pressed, () => { state.mapCard = card; });
    if (fromNotice) $('after-card-' + card).focus({ preventScroll: true });
  }
  // A name of the map after a change: how that account falls before and after the change opens right under its row. The name stays
  // where it was (the detail of the account chosen before closes above or below it); then the detail comes into view when it ends
  // below the screen (or below Before and After, which stay at the bottom of a narrow screen), the name kept on the screen
  function selectMapAccount(id) {
    const button = keepPlace(document.querySelector('[data-key="after-acct:' + id + '"]'), () => { state.mapAccount = id; });
    const detail = $('after-map-table').querySelector('.detail-row');
    if (!button || !detail) return;
    const floor = narrowQuery.matches ? Math.min(innerHeight, $('after-phase-bar').getBoundingClientRect().top) : innerHeight;
    const bottom = detail.getBoundingClientRect().bottom;
    if (bottom > floor) scrollBy(0, Math.max(0, Math.min(bottom - floor + 8, button.getBoundingClientRect().top - 8)));
  }
  // A highlight sets its scene and moves to it: the guide above the part to look at says where the page came from and what to
  // look at, with a button back to the highlights. The place before stays in the history (the browser's back button).
  // The focus goes to the guide (it is read), or to "Next step ▶" for a scene at step 0 (the guide describes the button).
  function pressHighlight(h) {
    stopPlaying();
    go({ tab: h.state.tab, hl: h.id });
    const s = h.state;
    if (s.mode) state.mode = s.mode;
    // A highlight of tab 3 (W3, P3) sets the mode only: the card of "Follow the chain" stays as the person left it
    const card = s.card || null;
    if (card && card !== state.card) setCard(card);
    if (s.step !== undefined) state.step = s.step === 'last' ? lastStep() : s.step;
    if (s.move !== undefined) setMove(s.move, true);
    if (s.account) {
      state.account = s.account;
      state.accountPicked = true;
    }
    if (s.tab) state.tab = s.tab;
    hintNotice = null;
    announcement = { key: 'statusHighlight', highlight: h.id };
    clearStepStatus();
    guide = { id: h.id, scene: scene() };
    render();
    if (h.target === 'step:next') {
      $('step-next').setAttribute('aria-describedby', 'hl-guide');
      $('step-next').focus({ preventScroll: true });
    } else guideBox.focus({ preventScroll: true });
    guideBox.scrollIntoView({ block: 'start' });
  }
  // Back to the highlights of tab 1, with the focus on the highlight that was pressed
  function backToHighlights() {
    const id = guide && guide.id;
    stopPlaying();
    if (state.tab !== 'chain') go({ tab: 'chain' });
    state.tab = 'chain';
    guide = null;
    render();
    $('highlights-block').scrollIntoView({ block: 'start' });
    const button = document.querySelector('[data-key="hl:' + id + '"]');
    if (button) button.focus({ preventScroll: true });
  }
  // The guide to the printable sheet: the rules tab opens at its paper section, with a button back to "Follow the chain" above
  // it (only after coming from there)
  let fromChain = false;
  const toChainBox = E('div', { class: 'to-chain' });
  function renderToChain() {
    if (state.tab !== 'rules') fromChain = false;
    if (!fromChain) {
      toChainBox.remove();
      return;
    }
    const button = E('button', { type: 'button', class: 'to-chain-button', 'data-key': 'to-chain' }, t('toChain'));
    button.addEventListener('click', () => {
      stopPlaying();
      go({ tab: 'chain' });
      state.tab = 'chain';
      render();
      $('print-guide').scrollIntoView({ block: 'center' });
      $('print-guide').focus({ preventScroll: true });
    });
    toChainBox.replaceChildren(button);
    if (toChainBox.nextElementSibling !== $('paper-heading')) $('paper-heading').before(toChainBox);
  }
  // The end of every panel: a button back up to the tabs (the tab bar is not fixed to the screen). In tab 3 it goes before the
  // room kept at the end of the tab (#compare-room, see keepRoom), so that no empty space comes between the button and the
  // part above it while the same-entrance table is pressed
  const panelEnds = TABS.map((name) => {
    const button = E('button', { type: 'button', class: 'to-tabs', 'data-key': 'to-tabs:' + name });
    button.addEventListener('click', () => {
      document.querySelector('.tabs').scrollIntoView({ block: 'start' });
      $('tab-' + state.tab).focus({ preventScroll: true });
    });
    const room = $('panel-' + name).querySelector(':scope > .compare-room');
    if (room) room.before(button); else $('panel-' + name).append(button);
    return button;
  });
  function renderPanelEnds() {
    renderToChain();
    const [text] = t('toTabs').split('▲');
    for (const button of panelEnds) button.replaceChildren(text, E('span', { 'aria-hidden': 'true' }, '▲'));
  }
  // The introduction: on narrow screens a short sentence, the full one behind "Read the full introduction" (closed when the page
  // opens there); on wide screens the full introduction is always open
  const wideQuery = matchMedia('(min-width: 720px)');
  if (!wideQuery.matches) $('intro-more').open = false;
  wideQuery.addEventListener('change', () => { if (wideQuery.matches) $('intro-more').open = true; });

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
  for (const phase of PHASES) $('phase-' + phase).addEventListener('click', (event) => selectPhase(phase, event.currentTarget));
  for (const card of CARDS) $('after-card-' + card).addEventListener('click', (event) => selectMapCard(card, event.currentTarget));
  $('choose-move').addEventListener('change', (event) => {
    if (event.target.value) selectMove(event.target.value, 'reveal', event.target); else event.target.value = state.move || '';
  });
  $('step-first').addEventListener('click', () => stepTo('first'));
  $('step-prev').addEventListener('click', () => stepTo('prev'));
  $('step-next').addEventListener('click', () => stepTo('next'));
  $('step-last').addEventListener('click', () => stepTo('last'));
  $('step-play').addEventListener('click', togglePlay);
  // Above and under the same-entrance table: back up to the comparison (its heading comes to the top of the screen, with the
  // margin of .compare-heading above it, and takes the focus)
  for (const id of ['back-to-compare-top', 'back-to-compare']) {
    $(id).addEventListener('click', () => {
      $('compare-heading').focus({ preventScroll: true });
      $('compare-heading').scrollIntoView();
    });
  }
  $('ranking-toggle').addEventListener('click', toggleRanking);
  // The guide in tab 1 goes to the paper section of the rules tab (its heading takes the focus)
  $('print-guide').addEventListener('click', () => {
    stopPlaying();
    go({ tab: 'rules' });
    state.tab = 'rules';
    fromChain = true;
    render();
    $('paper-heading').focus({ preventScroll: true });
    toChainBox.scrollIntoView({ block: 'start' });
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
  // The help opens where it was left (the lessons opened stay open); only after the language changed does it open at the top
  let helpLanguage = null;
  $('help').addEventListener('click', () => {
    if (lessonsLanguage !== state.language) buildLessons();
    $('help-dialog').showModal();
    if (helpLanguage !== state.language) $('help-dialog').querySelector('.help-body').scrollTop = 0;
    helpLanguage = state.language;
  });
  $('close-help').addEventListener('click', () => $('help-dialog').close());
  // A press outside the dialog (on the dark backdrop) closes it as well. The backdrop belongs to the dialog element, so the
  // place pressed tells it apart from a press inside
  $('help-dialog').addEventListener('click', (event) => {
    if (event.target !== $('help-dialog')) return;
    const box = $('help-dialog').getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (!inside) $('help-dialog').close();
  });
  for (const button of document.querySelectorAll('.section-nav button[data-target]')) {
    button.addEventListener('click', () => goToSection(button.dataset.target));
  }
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

  // Crossing 720px hides the diagram (wide screens only) and shows or hides the summary of the introduction. When the focus
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
    const name = [['chain-acct:', state.account], ['after-acct:', state.mapAccount]]
      .map(([prefix, id]) => document.querySelector('[data-key="' + prefix + id + '"]'))
      .find((button) => button && button.getClientRects().length);
    (name || $('panel-' + state.tab)).focus();
  });
  addEventListener('resize', fitLockTable);
  // The row of the detail spans the columns shown (the entrances have a column of their own on wide screens only)
  narrowQuery.addEventListener('change', () => render());

  // Startup: build the first person, draw, then release the two guarded groups, show the four-cards box (it has nothing
  // to open before the first drawing) and remove the startup notice. An address ending in a tab (#lockout) opens that tab.
  setMove(vectorsFor(state.persona).best[state.mode], true);
  state.tab = hashTab() || state.tab;
  writeHistory({ tab: state.tab }, false);
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
