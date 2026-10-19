import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tokenize, escapeText } from '../src/MarkdownEditor/Editor/markdown.js';

test('MVP fixture uses editable supported blocks', async () => {
  const source = await readFile(new URL('./fixtures/supported.md', import.meta.url), 'utf8');
  const tokens = tokenize(source).filter(t => t.type !== 'space');
  assert(tokens.length > 10);
  assert(tokens.every(t => t.supported));
});
test('expanded syntax is editable while unknown HTML/definitions remain protected', async () => {
  const source = await readFile(new URL('./fixtures/protected.md', import.meta.url), 'utf8');
  const tokens = tokenize(source);
  assert.equal(tokens.map(t => t.originalRaw ?? t.raw).join(''), source);
  assert(tokens.filter(t => !t.supported && t.type !== 'space').length >= 1);
  assert.equal(tokens.find(t => t.type === 'list').supported, true);
  assert.equal(tokens.find(t => t.type === 'html').supported, false);
});
test('original CRLF and CR source slices are retained', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const source = `# Заголовок${newline}${newline}\`\`\`js${newline}let n = 1;${newline}\`\`\`${newline}`;
    assert.equal(tokenize(source).map(t => t.originalRaw ?? t.raw).join(''), source);
  }
});
test('plain user text cannot turn into Markdown syntax or entities', () => {
  assert.equal(escapeText('# [x] | **a** &copy;'), '\\# \\[x\\] \\| \\*\\*a\\*\\* &amp;copy;');
});
