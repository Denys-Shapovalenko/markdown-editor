import { test, expect } from '@playwright/test';
import MarkdownIt from 'markdown-it';
const markdown = new MarkdownIt();
const out = page => page.evaluate(() => window.markdownEditor.export());
const load = (page, source) => page.evaluate(source => window.markdownEditor.load(source), source);
async function caret(page, selector, start = 0, end = start) {
  await page.locator(selector).first().evaluate((node, { start, end }) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT); const text = walker.nextNode() ?? node;
    const range = document.createRange(); range.setStart(text, start); range.setEnd(text, end);
    document.querySelector('#editor').focus(); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  }, { start, end });
}
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => window.markdownEditor); });
async function clickMenu(page, selector) {
  const item = page.locator(`#menu-bar ${selector}`).first();
  const group = item.locator('xpath=ancestor::details[1]');
  await group.locator('summary').click();
  await item.click();
}

test('typing groups undo and redo, restores caret, and respects saved baseline', async ({ page }) => {
  await load(page, 'Start\n'); await caret(page, '#editor p', 5); await page.keyboard.type(' abc');
  await page.keyboard.press('Control+z'); expect(await out(page)).toBe('Start\n');
  await page.keyboard.press('Control+y'); expect(await out(page)).toContain('Start abc');
  await page.evaluate(() => window.markdownEditor.receive({ type: 'saved', payload: { name: 'Saved.md' } }));
  await page.keyboard.press('Control+z'); expect(await page.evaluate(() => window.markdownEditor.dirty)).toBe(true);
  await page.keyboard.press('Control+y'); expect(await page.evaluate(() => window.markdownEditor.dirty)).toBe(false);
  await page.keyboard.type('!'); expect(markdown.render(await out(page))).toContain('abc!');
});
test('history restores table deletion and original raw protected records', async ({ page }) => {
  const source = '| A | B |\r\n| --- | --- |\r\n| X | Y |\r\n\r\n<div>Unknown</div>\r\n';
  await load(page, source); await page.locator('#editor td').first().click(); await page.locator('#table-tools [data-table="rowDelete"]').click();
  await page.keyboard.press('Control+z'); expect(await out(page)).toBe(source);
  await page.keyboard.press('Control+y'); expect(await out(page)).not.toContain('| X | Y |'); expect(await out(page)).toContain('<div>Unknown</div>');
});
test('partial copy/cut clipboard payload is valid Markdown and cut is reversible', async ({ page }) => {
  await load(page, 'Hello **world** tail\n'); await caret(page, '#editor strong', 1, 4);
  const payload = await page.evaluate(() => window.markdownEditor.features.clipboard.selectionData());
  expect(payload.text).toBe('orl'); expect(markdown.render(payload.markdown)).toContain('orl');
  await page.evaluate(() => window.markdownEditor.features.clipboard.cut()); expect(await out(page)).not.toContain('world');
  await page.keyboard.press('Control+z'); expect(await out(page)).toBe('Hello **world** tail\n');
});
test('plain Unicode paste is literal and Markdown paste creates structures in one undo step', async ({ page }) => {
  await load(page, ''); await page.locator('#editor').click();
  await page.evaluate(() => window.markdownEditor.features.clipboard.paste({ text: '# Привіт 👋 **текст**' }, 'plain'));
  await expect(page.locator('#editor h1')).toHaveCount(0); expect(await out(page)).toContain('\\#');
  await page.keyboard.press('Control+z');
  await page.evaluate(() => window.markdownEditor.features.clipboard.paste({ text: '# Заголовок\n\n- [ ] Завдання\n\n<div>Keep raw</div>\n' }, 'markdown'));
  await expect(page.locator('#editor h1')).toHaveText('Заголовок'); await expect(page.locator('#editor input[type=checkbox]')).toHaveCount(1);
  expect(await out(page)).toContain('<div>Keep raw</div>'); await page.keyboard.press('Control+z'); expect(await out(page)).toBe('');
});
test('protected blocks cannot be cut while clipboard copy preserves their raw source', async ({ page }) => {
  await load(page, 'Before\n\n<div>Raw</div>\n\nAfter\n');
  await page.locator('#editor').evaluate(editor => { const range = document.createRange(); range.selectNodeContents(editor); editor.focus(); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); });
  const copied = await page.evaluate(() => window.markdownEditor.features.clipboard.selectionData()); expect(copied.markdown).toContain('<div>Raw</div>');
  await page.evaluate(() => window.markdownEditor.features.clipboard.cut()); await expect(page.locator('.opaque')).toHaveCount(1);
});
test('find matches formatted visible text, replaces all with case option and skips raw HTML', async ({ page }) => {
  await load(page, 'One **cat**, CAT and cat.\n\n<div>cat</div>\n');
  await page.keyboard.press('Control+h'); await page.locator('#find-text').fill('cat'); await expect(page.locator('#find-status')).toHaveText('3 збігів');
  await page.locator('#find-case').check(); await expect(page.locator('#find-status')).toHaveText('2 збігів');
  await page.locator('#replace-text').fill('dog'); await page.locator('[data-find="all"]').click();
  expect(await out(page)).toContain('**dog**'); expect(await out(page)).toContain('CAT'); expect(await out(page)).toContain('<div>cat</div>');
  await page.locator('[data-find="close"]').click(); await page.keyboard.press('Control+z'); expect(await out(page)).toContain('**cat**');
});
test('link dialog edits URL and title without navigating', async ({ page }) => {
  await load(page, 'Hello world\n'); await caret(page, '#editor p', 6, 11); await clickMenu(page, '[data-v2="link"]');
  await page.locator('#link-url').fill('https://example.com/a'); await page.locator('#link-title').fill('Title'); await page.locator('#link-dialog button[type=submit]').click();
  await expect(page.locator('#editor a')).toHaveText('world'); expect(await out(page)).toContain('https://example.com/a');
  await page.locator('#editor a').dblclick(); await page.locator('#link-url').fill('https://example.com/b'); await page.locator('#link-dialog button[type=submit]').click();
  const saved = await out(page); expect(saved).toContain('/b'); expect(saved).not.toContain('/a'); await load(page, saved); await expect(page.locator('#editor a')).toHaveAttribute('title', 'Title');
});
test('remote images are blocked until explicit loading and alt/title round trip', async ({ page }) => {
  let requests = 0; await page.route('https://example.com/image.png', route => { requests++; return route.abort(); });
  const source = '![Alt](https://example.com/image.png "Title")\n'; await load(page, source);
  await expect(page.locator('#editor img')).toHaveAttribute('alt', 'Alt'); expect(requests).toBe(0); expect(await out(page)).toBe(source);
  await clickMenu(page, '#load-remote-images'); await expect.poll(() => requests).toBe(1); expect(await page.evaluate(() => window.markdownEditor.dirty)).toBe(false);
});
test('nested mixed lists indent/outdent and single nested toggle round trip', async ({ page }) => {
  await load(page, '- Parent\n  1. Child\n  2. Sibling\n- Last\n'); await caret(page, '#editor ol li', 0);
  await page.keyboard.press('Tab'); await expect(page.locator('#notice')).toContainText('попередній пункт');
  await caret(page, '#editor ol li:nth-child(2)', 0); await page.keyboard.press('Tab');
  const nested = await out(page); expect(markdown.render(nested)).toContain('<ol>'); await load(page, nested);
  await caret(page, '#editor ol ol li', 0); await page.keyboard.press('Shift+Tab'); await expect(page.locator('#editor ol ol')).toHaveCount(0);
  await caret(page, '#editor ol li', 0); await page.locator('.toolbar [data-command="insertOrderedList"]').click();
  const result = await out(page); await load(page, result); await expect(page.locator('#editor .opaque')).toHaveCount(0);
});
test('task Enter continues checklist and toggling checkbox is undoable', async ({ page }) => {
  await load(page, '- [ ] First\n'); await caret(page, '#editor li', 5); await page.keyboard.press('Enter'); await page.keyboard.type('Second');
  await expect(page.locator('#editor input[type=checkbox]')).toHaveCount(2);
  await page.locator('#editor input').first().check(); expect(await out(page)).toContain('- [x] First');
  await page.keyboard.press('Control+z'); expect(await out(page)).toContain('- [ ] First');
  const result = await out(page); await load(page, result); await expect(page.locator('#editor input')).toHaveCount(2);
});
test('code blocks remain literal, accept Enter/Tab and choose safe Markdown fences', async ({ page }) => {
  await load(page, '```js\n**literal** `x`\n```\n'); await caret(page, '#editor pre code', 15); await page.keyboard.press('Enter'); await page.keyboard.press('Tab'); await page.keyboard.type('```');
  const result = await out(page); expect(result).toContain('````js'); expect(markdown.render(result)).toContain('**literal**');
  await load(page, result); await expect(page.locator('#editor pre')).toContainText('```'); await expect(page.locator('#editor pre strong')).toHaveCount(0);
});
test('inline code and quote/rule commands export as Markdown', async ({ page }) => {
  await load(page, 'Hello\n'); await caret(page, '#editor p', 0, 5); await clickMenu(page, '[data-v2="inlineCode"]');
  await page.locator('#code-text').fill('a ` b'); await page.locator('#code-dialog button[type=submit]').click(); expect(await out(page)).toContain('``a ` b``');
  await clickMenu(page, '[data-v2="quote"]'); expect(await out(page)).toContain('> ');
  await clickMenu(page, '[data-v2="rule"]'); await expect(page.locator('#editor hr')).toHaveCount(1);
});
test('table selection alone preserves exact raw Markdown; columns move and align together', async ({ page }) => {
  const source = '|A|B|C|\n|---|---|---|\n|1|2|3|\n'; await load(page, source); await page.locator('#editor td').nth(1).click();
  await clickMenu(page, '[data-table-v2="selectColumn"]'); expect(await out(page)).toBe(source); expect(await page.evaluate(() => window.markdownEditor.dirty)).toBe(false);
  await clickMenu(page, '[data-table-v2="columnLeft"]'); await expect(page.locator('#editor th')).toHaveText(['B', 'A', 'C']);
  await clickMenu(page, '[data-table-v2="alignCenter"]'); expect(await out(page)).toContain(':---:');
  await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); expect(await out(page)).toBe(source);
});
test('bulk row deletion promotes header and can be undone', async ({ page }) => {
  const source = '| A | B |\n| --- | --- |\n| X | Y |\n| M | N |\n'; await load(page, source);
  await page.locator('#editor th').first().click(); await page.locator('#editor tr').nth(1).locator('td').last().click({ modifiers: ['Shift'] });
  await page.locator('#table-tools [data-table="rowDelete"]').click(); await expect(page.locator('#editor th')).toHaveText(['M', 'N']);
  await page.keyboard.press('Control+z'); expect(await out(page)).toBe(source);
});
test('Excel HTML paste shows losses, rejects scripts, and preserves rectangular cell coordinates', async ({ page }) => {
  await load(page, ''); await page.locator('#editor').click();
  await page.evaluate(() => window.markdownEditor.features.clipboard.paste({ html: '<table style="color:red"><tr><td rowspan="2">A</td><td>B</td></tr><tr><td>C</td></tr></table><script>window.bad=true</script>' }));
  await expect(page.locator('#paste-dialog')).toBeVisible(); await expect(page.locator('#paste-report')).toContainText('Об’єднані');
  await page.locator('#paste-dialog [data-confirm]').click(); await expect(page.locator('#editor th')).toHaveText(['A', 'B']); await expect(page.locator('#editor td')).toHaveText(['', 'C']);
  expect(await page.evaluate(() => window.bad)).toBeUndefined(); expect(await out(page)).not.toContain('<script>');
  await page.keyboard.press('Control+z'); await expect(page.locator('#editor table')).toHaveCount(0);
});
test('TSV from spreadsheets becomes a rectangular GFM table', async ({ page }) => {
  await load(page, ''); await page.locator('#editor').click();
  await page.evaluate(() => window.markdownEditor.features.clipboard.paste({ text: 'Name\tValue\nПривіт\t42\n' }));
  await expect(page.locator('#editor th')).toHaveText(['Name', 'Value']); await expect(page.locator('#editor td')).toHaveText(['Привіт', '42']); expect(markdown.render(await out(page))).toContain('<table>');
});
test('source mode leaves untouched source exactly and changes survive save acknowledgement', async ({ page }) => {
  const source = '# Title\r\n\r\n-   a\r\n\r\n<div>Raw</div>\r\n'; await load(page, source); await caret(page, '#editor h1', 2);
  await clickMenu(page, '[data-v2="source"]'); await clickMenu(page, '[data-v2="source"]'); expect(await out(page)).toBe(source);
  await clickMenu(page, '[data-v2="source"]'); await page.locator('#source-editor').fill(source.replace('Title', 'Edited'));
  expect(await page.evaluate(() => window.markdownEditor.dirty)).toBe(true);
  await page.evaluate(() => window.markdownEditor.receive({ type: 'saved', payload: { name: 'Saved.md' } }));
  expect(await page.evaluate(() => window.markdownEditor.dirty)).toBe(false); await clickMenu(page, '[data-v2="source"]'); await expect(page.locator('#editor h1')).toHaveText('Edited');
});
test('editing one protected block source preserves others and undo restores raw bytes', async ({ page }) => {
  const source = 'Text\n\n<div>One</div>\n\n<custom>Two</custom>\n'; await load(page, source);
  await page.locator('.opaque').first().evaluate(node => { const r = document.createRange(); r.selectNodeContents(node); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); document.dispatchEvent(new Event('selectionchange')); });
  await clickMenu(page, '[data-v2="blockSource"]'); await page.locator('#block-source-text').fill('## New\n'); await page.locator('#block-source-dialog button[type=submit]').click();
  expect(await out(page)).toContain('## New'); expect(await out(page)).toContain('<custom>Two</custom>');
  await page.keyboard.press('Control+z'); expect(await out(page)).toBe(source);
});
test('outline follows headings and keyboard can navigate to a selected heading', async ({ page }) => {
  await load(page, '# A\n\nText\n\n## B\n'); await clickMenu(page, '[data-v2="outline"]');
  await expect(page.locator('#outline button')).toHaveText(['A', 'B']); await page.locator('#outline button').last().focus(); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => { const node = window.getSelection().anchorNode; return (node.nodeType === 3 ? node.parentElement : node).closest('h2')?.textContent; })).toBe('B');
});
test('recovery payload includes pending source edits and original saved baseline', async ({ page }) => {
  await load(page, 'Original\n'); await clickMenu(page, '[data-v2="source"]'); await page.locator('#source-editor').fill('Unsaved\n');
  const result = await page.evaluate(() => window.markdownEditor.receive({ type: 'recovery' })); expect(result.markdown).toBe('Unsaved\n'); expect(result.savedMarkdown).toBe('Original\n');
  await load(page, 'Original\n'); await page.evaluate(() => window.markdownEditor.receive({ type: 'restoreDraft', payload: { markdown: 'Unsaved\n', savedMarkdown: 'Original\n' } }));
  expect(await out(page)).toBe('Unsaved\n'); expect(await page.evaluate(() => window.markdownEditor.dirty)).toBe(true);
});
test('HTML export is standalone inert content and print copy includes literal unsupported markup', async ({ page }) => {
  await load(page, '# Title\n\nText **bold**\n\n<div>Raw</div>\n');
  const result = await page.evaluate(() => window.markdownEditor.receive({ type: 'html' }));
  expect(result.html).toContain('<!doctype html>'); expect(result.html).toContain('<style>'); expect(result.html).toContain('&lt;div&gt;Raw&lt;/div&gt;'); expect(result.html).not.toContain('<script');
  await page.evaluate(() => window.markdownEditor.receive({ type: 'preparePrint' })); await page.emulateMedia({ media: 'print' }); await expect(page.locator('#print-document')).toBeVisible(); await expect(page.locator('header')).toBeHidden(); await expect(page.locator('#print-document strong')).toHaveText('bold');
});
