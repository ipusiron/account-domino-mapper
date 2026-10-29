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
  const DEFAULT_ACCOUNT = { worker: 'mailMain', parent: 'bank', student: 'sec' };
  const TABS = ['chain', 'lockout', 'compare', 'rules'];

  // personaVectors is computed once per person and kept (language and theme changes only redraw).
  const vectorsCache = new Map();
  const persona = (id) => Data.personas.find((p) => p.id === id);
  function vectorsFor(id) {
    if (!vectorsCache.has(id)) vectorsCache.set(id, Core.personaVectors(persona(id)));
    return vectorsCache.get(id);
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

  const t = (key, values = {}) => (Messages[state.language][key] ?? key)
    .replace(/\{([a-zA-Z0-9_]+)\}/g, (_, name) => String(values[name] ?? '{' + name + '}'));

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

  function renderPersons() {
    for (const id of PERSONAS) $('person-' + id).setAttribute('aria-pressed', String(id === state.persona));
    const counts = View.counts(persona(state.persona));
    $('person-counts').textContent = t('personCounts', { n: counts.accounts, f: counts.families });
    const text = announcement ? t(announcement.key, { person: t(PERSON_KEYS[announcement.person]) }) : '';
    if ($('person-status').textContent !== text) $('person-status').textContent = text;
  }
  function renderTabs() {
    for (const name of TABS) {
      const selected = name === state.tab;
      const tab = $('tab-' + name);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $('panel-' + name).hidden = !selected;
    }
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
    restoreFocus(focusKey);
  }

  function selectTab(name) {
    state.tab = name;
    state.playing = false;
    render();
  }
  function selectPersona(id) {
    if (!PERSONAS.includes(id) || id === state.persona) return;
    const pv = vectorsFor(id);
    state.persona = id;
    state.step = View.lastStep(pv, state.card);
    state.account = DEFAULT_ACCOUNT[id];
    state.move = pv.best[state.mode];
    state.playing = false;
    announcement = { key: 'statusPerson', person: id };
    render();
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
  $('theme').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    saveTheme();
    render();
  });
  $('language').addEventListener('click', () => {
    state.language = state.language === 'ja' ? 'en' : 'ja';
    saveLanguage();
    announcement = null;
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

  // Startup: build the first person, draw, then release the two guarded groups and remove the startup notice.
  state.move = vectorsFor(state.persona).best[state.mode];
  render();
  $('startup-tools').disabled = false;
  $('startup-controls').disabled = false;
  $('startup-note').remove();
  document.documentElement.dataset.appReady = 'true';
  // The other two people are built right after the first view, so that switching people does not wait.
  setTimeout(() => { for (const id of PERSONAS) vectorsFor(id); }, 0);
}());
