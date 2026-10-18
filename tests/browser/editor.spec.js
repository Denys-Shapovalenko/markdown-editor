import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import MarkdownIt from 'markdown-it';
const independentMarkdown = new MarkdownIt({ html: false });
const supported = await readFile(new URL('../fixtures/supported.md', import.meta.url), 'utf8');
const protectedSource = await readFile(new URL('../fixtures/protected.md', import.meta.url), 'utf8');

async function load(page, markdown) { await page.evaluate(source => window.markdownEditor.load(source, 'Тест.md'), markdown); }
async function output(page) { return page.evaluate(() => window.markdownEditor.export()); }
async function select(page, selector, start = 0, end = null) {
  await page.locator(selector).first().evaluate((element, offsets) => {
    const text = element.firstChild;
    const range = document.createRange(); range.setStart(text, offsets.start); range.setEnd(text, offsets.end ?? text.length);
    element.focus(); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { start, end });
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => window.markdownEditor); });

test('imports all supported structures and returns an unedited file exactly', async ({ page }) => {
  await load(page, supported);
  await expect(page.locator('#editor h1')).toHaveText('Робочі нотатки');
  await expect(page.locator('#editor .opaque')).toHaveCount(0);
  await expect(page.locator('#editor table')).toHaveCount(1);
  expect(await output(page)).toBe(supported);
  expect(await page.evaluate(() => window.markdownEditor.dirty)).toBe(false);
});
test('mouse toolbar preserves selection, formats and removes formatting', async ({ page }) => {
  await load(page, 'Простий текст\n');
  await select(page, '#editor p', 0, 7);
  await page.getByRole('button', { name: 'Жирний', exact: true }).click();
  await expect(page.locator('#editor b, #editor strong')).toHaveText('Простий');
  expect(await output(page)).toContain('**Простий** текст');
  await page.getByRole('button', { name: 'Жирний', exact: true }).click();
  expect(await output(page)).not.toContain('**');
});
test('collapsed formatting persists while typing and switches off', async ({ page }) => {
  await load(page, 'Початок\n');
  await select(page, '#editor p', 7, 7);
  await page.keyboard.press('Control+b'); await page.keyboard.type(' жирний'); await page.keyboard.press('Control+b'); await page.keyboard.type(' звичайний');
  const markdown = await output(page);
  expect(markdown).toContain('**жирний**'); expect(markdown).not.toContain('**звичайний**');
});
test('italic, strike, H1–H6 and ordinary paragraphs round trip', async ({ page }) => {
  await load(page, 'Текст\n'); await select(page, '#editor p');
  await page.keyboard.press('Control+i'); await page.keyboard.press('Control+Shift+x');
  const styled = await output(page); expect(styled).toContain('~~'); expect(styled).toContain('*');
  for (let n = 1; n <= 6; n++) {
    await load(page, 'Текст\n'); await select(page, '#editor p');
    await page.getByLabel('Стиль абзацу').selectOption(`h${n}`);
    await expect(page.locator(`#editor h${n}`)).toHaveText('Текст');
    expect(await output(page)).toBe('#'.repeat(n) + ' Текст\n');
    await page.getByLabel('Стиль абзацу').selectOption('p');
    await expect(page.locator('#editor p')).toHaveText('Текст');
  }
});
test('lists create points, exit empty item and can be toggled back', async ({ page }) => {
  await load(page, 'Перший\n'); await select(page, '#editor p', 6, 6);
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await page.keyboard.press('End'); await page.keyboard.press('Enter'); await page.keyboard.type('Другий');
  await expect(page.locator('#editor ul li')).toHaveCount(2);
  const markdown = await output(page); expect(markdown).toContain('- Перший'); expect(markdown).toContain('- Другий');
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.type('Після списку');
  await expect(page.locator('#editor > p')).toContainText('Після списку');
  await load(page, 'Один\n'); await select(page, '#editor p');
  await page.getByRole('button', { name: 'Нумерований список', exact: true }).click();
  expect(await output(page)).toContain('1. Один');
  await page.getByRole('button', { name: 'Нумерований список', exact: true }).click();
  await expect(page.locator('#editor ol')).toHaveCount(0);
});
test('typed paragraphs become separate list items and stay separate after reload', async ({ page }) => {
  await load(page, ''); await page.locator('#editor').click();
  await page.keyboard.type('First'); await page.keyboard.press('Enter');
  await page.keyboard.type('Second'); await page.keyboard.press('Enter'); await page.keyboard.type('Third');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await expect(page.locator('#editor ul > li')).toHaveText(['First', 'Second', 'Third']);
  const markdown = await output(page);
  await load(page, markdown);
  await expect(page.locator('#editor ul > li')).toHaveText(['First', 'Second', 'Third']);
});
test('turning one typed paragraph into a list leaves surrounding paragraphs outside it', async ({ page }) => {
  await load(page, ''); await page.locator('#editor').click();
  await page.keyboard.type('First'); await page.keyboard.press('Enter');
  await page.keyboard.type('Second'); await page.keyboard.press('Enter'); await page.keyboard.type('Third');
  await page.keyboard.press('Control+Home');
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await expect(page.locator('#editor ul > li')).toHaveText(['First']);
  await expect(page.locator('#editor > p')).toHaveText(['Second', 'Third']);
  const markdown = await output(page); await load(page, markdown);
  await expect(page.locator('#editor ul > li')).toHaveText(['First']);
  await expect(page.locator('#editor > p')).toHaveText(['Second', 'Third']);
});
test('Enter paragraphs remain separate when extending an imported paragraph', async ({ page }) => {
  await load(page, 'First\n');
  await select(page, '#editor p', 5, 5);
  await page.keyboard.press('Enter'); await page.keyboard.type('Second');
  await page.keyboard.press('Enter'); await page.keyboard.type('Third');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await expect(page.locator('#editor ul > li')).toHaveText(['First', 'Second', 'Third']);
});
test('Enter paragraphs after removing list stay independent', async ({ page }) => {
  await load(page, '- First\n');
  await select(page, '#editor li', 5, 5);
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await page.keyboard.press('Enter'); await page.keyboard.type('Second');
  await page.keyboard.press('Enter'); await page.keyboard.type('Third');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await expect(page.locator('#editor ul > li')).toHaveText(['First', 'Second', 'Third']);
});
test('Enter after creating heading and converting back to text keeps paragraphs independent', async ({ page }) => {
  await load(page, 'First\n'); await select(page, '#editor p', 5, 5);
  await page.getByLabel('Стиль абзацу').selectOption('h1');
  await page.getByLabel('Стиль абзацу').selectOption('p');
  await page.keyboard.press('Enter'); await page.keyboard.type('Second');
  await page.keyboard.press('Enter'); await page.keyboard.type('Third');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await expect(page.locator('#editor ul > li')).toHaveText(['First', 'Second', 'Third']);
});
test('Enter after busy host transition keeps paragraphs independent', async ({ page }) => {
  await page.evaluate(() => window.markdownEditor.receive({ type: 'busy', value: true }));
  await load(page, 'First\n');
  await page.evaluate(() => window.markdownEditor.receive({ type: 'busy', value: false }));
  await select(page, '#editor p', 5, 5);
  await page.keyboard.press('Enter'); await page.keyboard.type('Second');
  await page.keyboard.press('Enter'); await page.keyboard.type('Third');
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await expect(page.locator('#editor ul > li')).toHaveText(['First', 'Second', 'Third']);
});
test('list conversion preserves cursor at the start of the chosen paragraph', async ({ page }) => {
  await load(page, 'Before\n\nChosen\n\nAfter\n');
  await select(page, '#editor p:nth-child(2)', 0, 0);
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await page.keyboard.type('New ');
  await expect(page.locator('#editor li')).toHaveText('New Chosen');
  await expect(page.locator('#editor > p')).toHaveText(['Before', 'After']);
});
test('nested paragraph containers become individual list items', async ({ page }) => {
  await page.locator('#editor').evaluate(editor => {
    editor.innerHTML = '<div>First<div><strong>Second</strong></div><div>Third</div></div>';
    editor.focus(); const range = document.createRange(); range.selectNodeContents(editor);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await expect(page.locator('#editor ul > li')).toHaveText(['First', 'Second', 'Third']);
  const markdown = await output(page); await load(page, markdown);
  await expect(page.locator('#editor ul > li')).toHaveText(['First', 'Second', 'Third']);
  await expect(page.locator('#editor li strong')).toHaveText('Second');
});
test('list enabled in an empty document keeps each Enter as a separate item', async ({ page }) => {
  await load(page, 'Old\n'); await load(page, '');
  await page.locator('#editor').evaluate(editor => {
    editor.focus(); const range = document.createRange(); range.setStart(editor, 0); range.collapse(true);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await page.keyboard.type('First'); await page.keyboard.press('Enter'); await page.keyboard.type('Second');
  await page.keyboard.press('Enter'); await page.keyboard.type('Third');
  await expect(page.locator('#editor ul > li')).toHaveText(['First', 'Second', 'Third']);
  const markdown = await output(page); await load(page, markdown);
  await expect(page.locator('#editor ul > li')).toHaveText(['First', 'Second', 'Third']);
});
test('selection ending at the next paragraph start does not include that paragraph', async ({ page }) => {
  await load(page, 'First\n\nSecond\n\nThird\n');
  await page.locator('#editor').evaluate(editor => {
    editor.focus(); const range = document.createRange(); range.setStart(editor.children[0].firstChild, 0); range.setEnd(editor.children[2].firstChild, 0);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await expect(page.locator('#editor li')).toHaveText(['First', 'Second']);
  await expect(page.locator('#editor > p')).toHaveText(['Third']);
});
test('Enter splits a formatted list item without losing text or formatting', async ({ page }) => {
  await load(page, '- **FirstSecond**\n'); await select(page, '#editor strong', 5, 5);
  await page.keyboard.press('Enter');
  await expect(page.locator('#editor li')).toHaveText(['First', 'Second']);
  const markdown = await output(page); await load(page, markdown);
  await expect(page.locator('#editor li strong')).toHaveText(['First', 'Second']);
});
test('Enter exits an empty item in the middle and keeps the following items', async ({ page }) => {
  await load(page, '- Before\n- After\n'); await select(page, '#editor li:nth-child(2)', 0, 0);
  await page.keyboard.press('Enter');
  await page.locator('#editor li:nth-child(2)').evaluate(item => {
    const range = document.createRange(); range.selectNodeContents(item); range.collapse(true);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.press('Enter'); await page.keyboard.type('Outside');
  await expect(page.locator('#editor > p')).toHaveText(['Outside']);
  await expect(page.locator('#editor ul')).toHaveCount(2);
  await expect(page.locator('#editor li')).toHaveText(['Before', 'After']);
  const rendered = independentMarkdown.render(await output(page));
  expect(rendered).toContain('<p>Outside</p>');
});
test('table creation, text, Tab, Enter, rows and columns', async ({ page }) => {
  await page.locator('#editor').click(); await page.getByRole('button', { name: '▦ Таблиця', exact: true }).click();
  await page.locator('#table-rows').fill('2'); await page.locator('#table-columns').fill('2'); await page.getByRole('button', { name: 'Створити', exact: true }).click();
  await page.keyboard.type('Назва'); await page.keyboard.press('Tab'); await page.keyboard.type('Стан');
  await page.keyboard.press('Tab'); await page.keyboard.type('a|b'); await page.keyboard.press('Tab'); await page.keyboard.type('Готово');
  await page.keyboard.press('Tab'); await expect(page.locator('#editor tr')).toHaveCount(3);
  await page.getByRole('button', { name: '+ Стовпець', exact: true }).click();
  await expect(page.locator('#editor th')).toHaveCount(3);
  await page.getByRole('button', { name: '− Стовпець', exact: true }).click();
  await expect(page.locator('#editor th')).toHaveCount(2);
  await page.getByRole('button', { name: '− Рядок', exact: true }).click();
  await expect(page.locator('#editor tr')).toHaveCount(2);
  const markdown = await output(page); expect(markdown).toContain('a\\|b');
  await load(page, markdown); await expect(page.locator('#editor td').first()).toHaveText('a|b');
  await expect(page.locator('#editor .opaque')).toHaveCount(0);
});
test('alignment, escapes, empty cells and formatting survive edited table', async ({ page }) => {
  await load(page, '| A | B | C |\n| :--- | :---: | ---: |\n| **x** | | a\\|b |\n');
  await select(page, '#editor th', 1, 1); await page.keyboard.type('!');
  const markdown = await output(page); expect(markdown).toContain('| :--- | :---: | ---: |');
  await load(page, markdown); await expect(page.locator('#editor td').nth(2)).toHaveText('a|b');
  await expect(page.locator('#editor td strong')).toHaveText('x');
});
test('protected source survives adjacent edits exactly and never executes HTML', async ({ page }) => {
  const source = protectedSource.replace(/\n/g, '\r\n'); await load(page, source);
  expect(await page.evaluate(() => window.untrustedExecuted)).toBeUndefined();
  expect(await output(page)).toBe(source);
  await select(page, '#editor > p', 0, 0); await page.keyboard.type('Новий ');
  const markdown = await output(page);
  for (const snippet of ["```javascript\r\nconst source = '**не форматувати**';\r\n```", '- Батьківський пункт\r\n  - Вкладений пункт', '<script>window.untrustedExecuted = true;</script>']) expect(markdown).toContain(snippet);
});
test('deleting a protected block fails closed instead of silently dropping data', async ({ page }) => {
  await load(page, protectedSource);
  const error = await page.evaluate(() => { document.querySelector('.opaque').remove(); try { window.markdownEditor.export(); } catch (e) { return e.message; } });
  expect(error).toContain('Збереження зупинено');
});
test('selection across protected block cannot replace content', async ({ page }) => {
  await load(page, 'Before\n\n```\nKeep me\n```\n\nAfter\n');
  await page.locator('#editor').evaluate(editor => {
    editor.focus(); const range = document.createRange(); range.selectNodeContents(editor); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
  await page.keyboard.type('Replacement');
  expect(await output(page)).toContain('Keep me'); await expect(page.locator('.opaque')).toHaveCount(1);
});
test('literal Markdown, entities, soft and hard breaks remain text after reload', async ({ page }) => {
  await load(page, ''); await page.locator('#editor').click(); await page.keyboard.type('# literal **text** &copy;');
  await page.keyboard.press('Shift+Enter'); await page.keyboard.type('next');
  const markdown = await output(page); await load(page, markdown);
  await expect(page.locator('#editor h1')).toHaveCount(0); await expect(page.locator('#editor strong')).toHaveCount(0);
  await expect(page.locator('#editor p')).toContainText('# literal **text** &copy;'); await expect(page.locator('#editor br')).toHaveCount(1);
});
test('save acknowledgment resets dirty; new changes remain visible', async ({ page }) => {
  await load(page, 'Текст\n'); await select(page, '#editor p', 5, 5); await page.keyboard.type('!');
  expect(await page.evaluate(() => window.markdownEditor.dirty)).toBe(true);
  await page.evaluate(() => window.markdownEditor.receive({ type: 'saved', payload: { name: 'Saved.md' } }));
  expect(await page.evaluate(() => window.markdownEditor.dirty)).toBe(false);
  const saved = await output(page); await page.keyboard.type('?'); expect(await output(page)).not.toBe(saved);
});
test('multiple paragraphs can be formatted and preserved after reload', async ({ page }) => {
  await load(page, 'First\n\nSecond\n');
  await page.locator('#editor').evaluate(editor => {
    editor.focus(); const r = document.createRange(); r.setStart(editor.children[0].firstChild, 0); r.setEnd(editor.children[1].firstChild, 6);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: 'Жирний', exact: true }).click();
  const markdown = await output(page); await load(page, markdown);
  await expect(page.locator('#editor strong')).toHaveCount(2);
});
test('UI screenshot and no script errors', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await load(page, supported);
  await page.screenshot({ path: 'artifacts/editor.png', fullPage: true }); expect(errors).toEqual([]);
});
test('empty paragraph accepts list input and formatting', async ({ page }) => {
  await load(page, ''); await page.locator('#editor').click();
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click(); await page.keyboard.type('First');
  await expect(page.locator('#editor li')).toHaveText('First');
  expect(independentMarkdown.render(await output(page))).toContain('<li>First</li>');
  await load(page, ''); await page.locator('#editor').click(); await page.keyboard.press('Control+b'); await page.keyboard.type('Bold');
  expect(independentMarkdown.render(await output(page))).toContain('<strong>Bold</strong>');
});
test('ordered list hard breaks use correct continuation indentation', async ({ page }) => {
  await load(page, '10. First\n'); await select(page, '#editor li', 5, 5);
  await page.keyboard.press('Shift+Enter'); await page.keyboard.type('Second line');
  const markdown = await output(page);
  const rendered = independentMarkdown.render(markdown);
  expect(rendered).toContain('<ol start="10">'); expect(rendered).toContain('First<br>\nSecond line');
  await load(page, markdown); await expect(page.locator('#editor ol li')).toHaveCount(1);
});
test('typed HTML remains literal text after Markdown export', async ({ page }) => {
  await load(page, ''); await page.locator('#editor').click(); await page.keyboard.type('<script>alert(1)</script>');
  const markdown = await output(page); expect(markdown).toContain('\\<script\\>');
  await load(page, markdown); await expect(page.locator('#editor .opaque')).toHaveCount(0);
  await expect(page.locator('#editor p')).toHaveText('<script>alert(1)</script>');
});
test('Backspace next to protected block keeps it intact', async ({ page }) => {
  await load(page, 'Before\n\n```\nKeep\n```\n\nAfter\n');
  await select(page, '#editor > p:last-child', 0, 0); await page.keyboard.press('Backspace');
  expect(await output(page)).toContain('```\nKeep\n```'); await expect(page.locator('.opaque')).toHaveCount(1);
});
test('edited full document renders supported structures in an independent Markdown engine', async ({ page }) => {
  await load(page, supported); await select(page, '#editor h1', 0, 0); await page.keyboard.type('Нові ');
  const markdown = await output(page); const rendered = independentMarkdown.render(markdown);
  expect(rendered).toContain('<h1>Нові Робочі нотатки</h1>'); expect(rendered).toContain('<table>');
  expect(rendered).toContain('<strong>жирним</strong>'); expect(rendered).toContain('<em>курсивом</em>'); expect(rendered).toContain('<s>закресленням</s>');
  expect(rendered).toContain('<ol start="3">'); expect(rendered).toContain('<ul>'); expect(rendered).toContain('Символ | у клітинці');
});
test('busy host prevents editing and rejects huge imports without replacing document', async ({ page }) => {
  await load(page, 'Keep\n');
  await page.evaluate(() => window.markdownEditor.receive({ type: 'busy', value: true }));
  await expect(page.locator('#editor')).toHaveAttribute('contenteditable', 'false');
  await page.evaluate(() => window.markdownEditor.receive({ type: 'busy', value: false }));
  const error = await page.evaluate(() => { try { window.markdownEditor.load('x'.repeat(5 * 1024 * 1024 + 1)); } catch (e) { return e.message; } });
  expect(error).toContain('5 MiB'); expect(await output(page)).toBe('Keep\n');
});
