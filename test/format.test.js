'use strict';
// H: readable source files (no minified lines) without a byte order mark.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('H: line length limits and UTF-8 without BOM', () => {
  const files = fs.readdirSync(root).filter((f) => /\.(js|css|html|json)$/.test(f));
  files.push(...fs.readdirSync(__dirname).filter((f) => f.endsWith('.js')).map((f) => 'test/' + f));
  assert.ok(files.includes('index.html') && files.includes('package.json') && files.includes('test/core.test.js'));
  for (const file of files) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.notEqual(text.charCodeAt(0), 0xFEFF, file);
    const limit = file.endsWith('.html') ? 250 : 160;
    for (const [i, line] of text.split(/\r?\n/).entries()) assert.ok([...line].length <= limit, `${file}:${i + 1} exceeds ${limit}`);
  }
});

test('H: main files keep a readable number of lines', () => {
  const minimum = [['app.js', 100], ['style.css', 100], ['index.html', 100], ['domino-core.js', 600], ['domino-data.js', 400],
    ['domino-view.js', 15], ['messages.js', 150], ['theme-init.js', 10]];
  for (const [file, lines] of minimum) {
    assert.ok(fs.readFileSync(path.join(root, file), 'utf8').split('\n').length >= lines, file);
  }
});
