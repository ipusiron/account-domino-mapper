'use strict';
// H: the colors of style.css (the values of the spec's color table, their contrast ratios in both themes, the lines and borders
// of the diagram, at most three accent colors, no external fonts).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const variables = (body) => Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
const lightBlock = css.match(/:root\s*\{([^}]+)\}/)[1];
const darkBlock = css.match(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/)[1];
// Every rule of style.css (comments removed), with the at-rules around it: { at: ['@media print'], selector, declarations: [[name, value]] }.
// The tests below read all of them, so that a later rule (or a later block of variables) cannot override what an earlier one sets.
const RULES = (() => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [], open = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      open.push(text.slice(start, i).trim().replace(/\s+/g, ' '));
      start = i + 1;
    } else if (text[i] === '}') {
      if (!open.length) throw new Error('style.css: a } without a {');
      const head = open.pop();
      if (!head.startsWith('@')) {
        const declarations = text.slice(start, i).split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
          const colon = d.indexOf(':');
          return [d.slice(0, colon).trim().toLowerCase(), d.slice(colon + 1).trim()];
        });
        rules.push({ at: open.slice(), selector: head, declarations });
      }
      start = i + 1;
    }
  }
  if (open.length) throw new Error('style.css: a { without a }');
  return rules;
})();
const inPrint = (rule) => rule.at.some((a) => /^@media print\b/.test(a));
const screenRules = RULES.filter((rule) => !inPrint(rule));
const light = variables(lightBlock);
const dark = { ...light, ...variables(darkBlock) };
const luminance = (color) => {
  const c = color.slice(1).match(/../g).map((x) => parseInt(x, 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
const contrast = (a, b) => {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const round2 = (n) => Math.round(n * 100) / 100;

// The spec's table ("動きと色"): value, then the ratio against the paper and against the ground, per theme.
// --line, --grid and --shadow are the values of the model implementation (used for table rules only).
// The passwords have no colors any more (パスワードA・B・C): color tells states only (fallen, locked out, chosen), and the dark
// grid is close to the ground.
const SPEC = {
  light: {
    bg: '#f6f4ed', paper: '#fffdf7',
    ink: ['#152b45', 14.11, 13.04], muted: ['#44576b', 7.32, 6.76], accent: ['#1d6b5a', 6.25, 5.78],
    fall: ['#a33c34', 6.35, 5.87], lock: ['#7a4f00', 7.01, 6.48], focus: ['#1d6b5a', 6.25, 5.78], 'on-accent': '#fffdf7', onAccentRatio: 6.25,
    line: '#aabccb', grid: '#d9e4e9', shadow: '#d9d6cc',
  },
  dark: {
    bg: '#0d1b2d', paper: '#172940',
    ink: ['#eaf1f6', 12.90, 15.19], muted: ['#c5d4df', 9.71, 11.44], accent: ['#7fd4bd', 8.44, 9.95],
    fall: ['#ffaaa1', 8.07, 9.50], lock: ['#f2c46d', 9.03, 10.64], focus: ['#7fd4bd', 8.44, 9.95], 'on-accent': '#172940', onAccentRatio: 8.44,
    line: '#668098', grid: '#16263a', shadow: '#091523',
  },
};
const PAIRED = ['ink', 'muted', 'accent', 'fall', 'lock', 'focus'];

test('H: the colors of both themes are the values of the spec, and the variables are only these', () => {
  // One block per theme, and the variables are set nowhere else (a later :root block, a block inside a media query or a variable
  // set on another selector would override the values read here). Printing before the page is ready sets them in @media print.
  const top = (selector) => RULES.filter((rule) => !rule.at.length && rule.selector === selector);
  assert.equal(top(':root').length, 1, ':root blocks');
  assert.equal(top(':root[data-theme="dark"]').length, 1, 'dark blocks');
  for (const rule of screenRules) {
    const themeBlock = !rule.at.length && (rule.selector === ':root' || rule.selector === ':root[data-theme="dark"]');
    for (const [name] of rule.declarations) {
      if (name.startsWith('--')) assert.ok(themeBlock, name + ' set in ' + [...rule.at, rule.selector].join(' '));
    }
  }
  const expectedNames = ['bg', 'paper', 'ink', 'muted', 'line', 'grid', 'accent', 'fall', 'lock', 'focus', 'shadow', 'on-accent'].sort();
  assert.deepEqual(Object.keys(variables(lightBlock)).sort(), expectedNames);
  assert.deepEqual(Object.keys(variables(darkBlock)).sort(), expectedNames);
  for (const [theme, colors] of [['light', light], ['dark', dark]]) {
    const spec = SPEC[theme];
    for (const name of ['bg', 'paper', 'on-accent', 'line', 'grid', 'shadow']) assert.equal(colors[name], spec[name], theme + ' ' + name);
    for (const name of PAIRED) assert.equal(colors[name], spec[name][0], theme + ' ' + name);
    assert.equal(colors.focus, colors.accent, theme + ': the focus ring is the accent color');
  }
});

test('H: text contrast against the paper and the ground is the ratio of the spec and at least 4.5:1 in both themes', (t) => {
  for (const [theme, colors] of [['light', light], ['dark', dark]]) {
    const spec = SPEC[theme];
    for (const name of PAIRED) {
      const onPaper = contrast(colors[name], colors.paper), onGround = contrast(colors[name], colors.bg);
      t.diagnostic(`${theme} ${name} ${colors[name]}: paper ${colors.paper} ${onPaper.toFixed(2)}:1, ground ${colors.bg} ${onGround.toFixed(2)}:1`);
      assert.deepEqual([round2(onPaper), round2(onGround)], spec[name].slice(1), theme + ' ' + name);
      assert.ok(onPaper >= 4.5 && onGround >= 4.5, `${theme} ${name}: ${onPaper} / ${onGround}`);
    }
    const onAccent = contrast(colors['on-accent'], colors.accent);
    t.diagnostic(`${theme} on-accent ${colors['on-accent']} / accent ${colors.accent} ${onAccent.toFixed(2)}:1`);
    assert.equal(round2(onAccent), spec.onAccentRatio, theme + ' on-accent');
    assert.ok(onAccent >= 4.5, theme + ' on-accent');
    // The current-step row has the ground as its background: the ink and the fallen mark keep 4.5:1 there
    for (const name of ['ink', 'fall']) assert.ok(contrast(colors[name], colors.bg) >= 4.5, theme + ' this-step row ' + name);
  }
});

test('H: the focus ring and the lines and borders of the diagram (--muted) keep at least 3:1 against the paper and the ground', (t) => {
  for (const [theme, colors] of [['light', light], ['dark', dark]]) {
    for (const name of ['focus', 'muted', 'fall', 'accent']) {
      for (const ground of ['paper', 'bg']) {
        const ratio = contrast(colors[name], colors[ground]);
        t.diagnostic(`${theme} ${name} / ${ground} ${ratio.toFixed(2)}:1`);
        assert.ok(ratio >= 3, `${theme} ${name}/${ground}: ${ratio}`);
      }
    }
  }
  // Every rule of style.css on the screen (all of them, not only the first one for a selector) draws the lines, the boxes and the
  // cards of the diagram with --muted and the hot or fallen ones with --fall (a line the attacker followed is hot through its group,
  // .map-link.hot). The other strokes are the divider (--line), the dashed frame of a changed entrance (--accent) and the dotted
  // frame of the account chosen in the table (--ink, a shape apart from the fallen borders); no other selector sets a stroke.
  // The printed sheets have no diagram.
  const strokes = [];
  for (const rule of screenRules) {
    for (const [name, value] of rule.declarations) {
      if (name !== 'stroke') continue;
      for (const selector of rule.selector.split(',').map((s) => s.trim())) {
        const expected = /\.map-(?:line|box|card)\b/.test(selector) ? (/\.(?:hot|fallen)\b/.test(selector) ? 'var(--fall)' : 'var(--muted)')
          : /^\.map-divider$/.test(selector) ? 'var(--line)' : /^\.map-svg \.changed$/.test(selector) ? 'var(--accent)'
            : /^\.map-select$/.test(selector) ? 'var(--ink)' : null;
        assert.ok(expected, 'a stroke set on ' + selector);
        assert.equal(value, expected, selector);
        strokes.push(selector);
      }
    }
  }
  for (const selector of ['.map-line', '.map-link.hot > .map-line', '.map-box', '.map-card', '.map-box.fallen', '.map-card.fallen',
    '.map-select']) {
    assert.ok(strokes.includes(selector), selector + ' has a stroke');
  }
  // The focus ring is 3px of --focus; the only other outline on the screen is the 3px frame of a selected table row: --accent, or
  // --ink in the map tables (a color that does not read as safe next to the fallen accounts). No rule takes the ring away or
  // changes its color: outline-offset alone may change
  let rings = 0;
  for (const rule of screenRules) {
    for (const [name, value] of rule.declarations) {
      if (!name.startsWith('outline') || name === 'outline-offset') continue;
      const ring = /:focus-visible$/.test(rule.selector) && value === '3px solid var(--focus)';
      const row = rule.selector.split(',').every((s) => /tr\.selected$/.test(s.trim()))
        && (value === '3px solid var(--accent)' || (/^\.map-table tr\.selected$/.test(rule.selector) && value === '3px solid var(--ink)'));
      assert.ok(name === 'outline' && (ring || row), rule.selector + ' { ' + name + ': ' + value + ' }');
      if (ring && rule.selector === ':focus-visible') rings++;
    }
  }
  assert.equal(rings, 1, 'the focus ring of :focus-visible');
});

test('H: at most three accent colors (--accent, --fall, --lock), set apart by shapes and words; no other colors and no external fonts', () => {
  // The three accents are close in lightness (the spec's 1.02–1.12 light and 1.05–1.12 dark), so the meaning never rests on color alone
  for (const [theme, colors, low, high] of [['light', light, 1.02, 1.12], ['dark', dark, 1.05, 1.12]]) {
    const ratios = [['fall', 'accent'], ['lock', 'accent'], ['fall', 'lock']].map(([a, b]) => round2(contrast(colors[a], colors[b])));
    assert.ok(Math.min(...ratios) >= low && Math.max(...ratios) <= high, theme + ' ' + ratios);
  }
  // Outside the two theme blocks, a color is written directly only for printing (black on white) and the dialog backdrop
  const outside = css.replace(lightBlock, '').replace(darkBlock, '');
  const literal = [...outside.matchAll(/#[\da-f]{3,8}\b/gi)].map((m) => m[0].toLowerCase());
  assert.deepEqual([...new Set(literal)].sort(), ['#000', '#101a2ab0', '#fff']);
  const print = css.slice(css.indexOf('@media print'));
  assert.equal(literal.filter((c) => c === '#000' || c === '#fff').length, (print.match(/#000\b|#fff\b/gi) || []).length,
    'black and white only in the print rules');
  assert.doesNotMatch(css, /@import|@font-face|url\(|fonts\.googleapis|rgb\(|hsl\(/i);
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|<link[^>]+rel="(?:preconnect|preload)"/);
});
