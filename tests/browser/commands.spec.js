import { test, expect } from '@playwright/test';

const tableSource = '| A | B |\n| --- | --- |\n| One | Two |\n| Three | Four |\n';
async function load(page, source) { await page.evaluate(source => window.markdownEditor.load(source), source); }
async function select(page, selector, start = 0, end = start) {
  await page.locator(selector).first().evaluate((element, { start, end }) => {
    const range = document.createRange(); range.setStart(element.firstChild, start); range.setEnd(element.firstChild, end);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.querySelector('#editor').focus(); document.dispatchEvent(new Event('selectionchange'));
  }, { start, end });
}
async function roundTrip(page) { const source = await page.evaluate(() => window.markdownEditor.export()); await load(page, source); return source; }
test.beforeEach(async ({ page }) => { await page.goto('/'); await page.waitForFunction(() => window.markdownEditor); });

test('table toolbar actions are icons with explanatory hover and accessible labels', async ({ page }) => {
  const buttons = page.locator('#table-tools button');
  const details = await buttons.evaluateAll(items => items.map(button => ({
    text: button.textContent.trim(), icon: Boolean(button.querySelector('svg.toolbar-icon')),
    title: button.title, label: button.getAttribute('aria-label')
  })));
  expect(details.length).toBeGreaterThan(6);
  for (const button of details) {
    expect(button.text).toBe(''); expect(button.icon).toBe(true);
    expect(button.title.length).toBeGreaterThan(0); expect(button.label.length).toBeGreaterThan(0);
  }
  await expect(page.locator('#table-tools [data-table="rowAdd"]')).toHaveAttribute('title', 'Додати рядок нижче');
  await expect(page.locator('#table-tools [data-table-v2="columnLeft"]')).toHaveAttribute('title', 'Перемістити вибрані стовпці ліворуч');
});

test('main menu contains no Help item', async ({ page }) => {
  await expect(page.locator('#menu-bar details')).toHaveCount(6);
  await expect(page.locator('#menu-bar [data-menu="help"]')).toHaveCount(0);
  const visualOrder = await page.locator('#menu-bar details').evaluateAll(items => items
    .sort((a, b) => Number(getComputedStyle(a).order) - Number(getComputedStyle(b).order))
    .map(item => item.querySelector('summary').textContent.trim()));
  expect(visualOrder).toEqual(['Файл', 'Правка', 'Вигляд', 'Вставка', 'Формат', 'Таблиця']);
});

for (const ordered of [false, true]) test(`remove only the chosen ${ordered ? 'numbered' : 'bulleted'} item`, async ({ page }) => {
  await load(page, ordered ? '5. First\n6. Chosen\n7. Last\n' : '- First\n- Chosen\n- Last\n');
  await select(page, '#editor li:nth-child(2)', 2);
  await page.getByRole('button', { name: ordered ? 'Нумерований список' : 'Маркований список', exact: true }).click();
  await expect(page.locator('#editor > p')).toHaveText(['Chosen']);
  await expect(page.locator('#editor li')).toHaveText(['First', 'Last']);
  await page.keyboard.type('!'); await expect(page.locator('#editor > p')).toHaveText(['Ch!osen']);
  if (ordered) { await expect(page.locator('#editor > ol').first()).toHaveAttribute('start', '5'); await expect(page.locator('#editor > ol').last()).toHaveAttribute('start', '7'); }
  await roundTrip(page); await expect(page.locator('#editor li')).toHaveText(['First', 'Last']);
});
test('change list type only for the chosen item', async ({ page }) => {
  await load(page, '- First\n- Chosen\n- Last\n'); await select(page, '#editor li:nth-child(2)');
  await page.getByRole('button', { name: 'Нумерований список', exact: true }).click();
  await expect(page.locator('#editor ol li')).toHaveText(['Chosen']); await expect(page.locator('#editor ul li')).toHaveText(['First', 'Last']);
});
test('remove only selected consecutive items with the next item excluded at its start', async ({ page }) => {
  await load(page, '- First\n- Second\n- Third\n- Last\n');
  await page.locator('#editor').evaluate(editor => {
    const items = editor.querySelectorAll('li'); editor.focus(); const range = document.createRange();
    range.setStart(items[1].firstChild, 0); range.setEnd(items[3].firstChild, 0);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  await expect(page.locator('#editor > p')).toHaveText(['Second', 'Third']); await expect(page.locator('#editor li')).toHaveText(['First', 'Last']);
});
test('numbering continues when consecutive paragraphs are converted individually', async ({ page }) => {
  await load(page, 'First\n\nSecond\n\nThird\n');
  for (let i = 0; i < 3; i++) { await select(page, '#editor > p'); await page.getByRole('button', { name: 'Нумерований список', exact: true }).click(); }
  await expect(page.locator('#editor ol')).toHaveCount(1); await expect(page.locator('#editor ol li')).toHaveText(['First', 'Second', 'Third']);
  const source = await roundTrip(page); expect(source).toBe('1. First\n2. Second\n3. Third\n');
});
test('a paragraph bridges adjacent numbered lists and keeps the original start', async ({ page }) => {
  await load(page, '5. First\n\nMiddle\n\n7. Last\n'); await select(page, '#editor > p');
  await page.getByRole('button', { name: 'Нумерований список', exact: true }).click();
  await expect(page.locator('#editor ol')).toHaveCount(1); await expect(page.locator('#editor ol')).toHaveAttribute('start', '5');
  expect(await roundTrip(page)).toBe('5. First\n6. Middle\n7. Last\n');
});
test('table commands are visible and work after a real click into an imported cell', async ({ page }) => {
  await load(page, tableSource);
  const tools = page.getByRole('group', { name: 'Редагування таблиці' }); await expect(tools).toBeVisible();
  await expect(tools.getByRole('button', { name: '+ Рядок', exact: true })).toBeDisabled();
  const cell = page.locator('#editor td').first(); const before = await cell.boundingBox(); await cell.click();
  expect((await cell.boundingBox()).y).toBe(before.y);
  await expect(tools.getByRole('button', { name: '+ Рядок', exact: true })).toBeEnabled();
  await tools.getByRole('button', { name: '+ Рядок', exact: true }).click(); await expect(page.locator('#editor tr')).toHaveCount(4);
  await tools.getByRole('button', { name: '+ Стовпець праворуч', exact: true }).click(); await expect(page.locator('#editor th')).toHaveCount(3);
  await tools.getByRole('button', { name: '− Стовпець', exact: true }).click(); await expect(page.locator('#editor th')).toHaveCount(2);
  await tools.getByRole('button', { name: '− Рядок', exact: true }).click(); await expect(page.locator('#editor tr')).toHaveCount(3);
  await roundTrip(page); await expect(page.locator('#editor td')).toHaveText(['One', 'Two', 'Three', 'Four']);
});
test('right click offers table row and column actions for the clicked cell', async ({ page }) => {
  await load(page, tableSource); await page.locator('#editor td').nth(3).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Команди редактора' }); await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Додати рядок нижче', exact: true }).click(); await expect(page.locator('#editor tr')).toHaveCount(4);
  await page.locator('#editor td').nth(3).click({ button: 'right' }); await menu.getByRole('menuitem', { name: 'Додати стовпець праворуч', exact: true }).click();
  await expect(page.locator('#editor th')).toHaveCount(3);
  await page.locator('#editor td').nth(5).click({ button: 'right' }); await menu.getByRole('menuitem', { name: 'Видалити стовпець', exact: true }).click();
  await expect(page.locator('#editor th')).toHaveCount(2);
  await page.locator('#editor td').nth(2).click({ button: 'right' }); await menu.getByRole('menuitem', { name: 'Видалити рядок', exact: true }).click();
  await expect(page.locator('#editor td')).toHaveText(['One', 'Two', '', '']);
});
test('context menu preserves selected text for formatting and closes on Escape', async ({ page }) => {
  await load(page, 'Text to style\n'); await select(page, '#editor p', 0, 4);
  await page.locator('#editor p').click({ button: 'right', position: { x: 8, y: 10 } });
  const menu = page.getByRole('menu', { name: 'Команди редактора' }); await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Жирний', exact: true }).click(); await expect(page.locator('#editor b, #editor strong')).toHaveText('Text');
  await page.keyboard.press('Shift+F10'); await expect(menu).toBeVisible(); await page.keyboard.press('Escape'); await expect(menu).toBeHidden();
});
test('table toolbar stays accessible after scrolling and clears outside table', async ({ page }) => {
  await load(page, Array.from({length: 25}, (_, i) => `Paragraph ${i}\n\n`).join('') + tableSource + '\nAfter\n');
  await page.locator('#editor td').first().click();
  const tools = page.getByRole('group', { name: 'Редагування таблиці' });
  const box = await tools.boundingBox(); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThan(850);
  await expect(tools.getByRole('button', { name: '+ Рядок', exact: true })).toBeEnabled();
  await page.locator('#editor > p').last().click(); await expect(tools.getByRole('button', { name: '+ Рядок', exact: true })).toBeDisabled();
});
test('restoring a removed numbered item reconnects its surrounding list', async ({ page }) => {
  await load(page, '5. First\n6. Chosen\n7. Last\n'); await select(page, '#editor li:nth-child(2)');
  await page.getByRole('button', { name: 'Нумерований список', exact: true }).click();
  await page.getByRole('button', { name: 'Нумерований список', exact: true }).click();
  await expect(page.locator('#editor ol')).toHaveCount(1);
  expect(await roundTrip(page)).toBe('5. First\n6. Chosen\n7. Last\n');
});
test('context menu keyboard navigation activates table commands', async ({ page }) => {
  await load(page, tableSource); await page.locator('#editor td').first().click(); await page.keyboard.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Команди редактора' });
  await expect(menu).toBeVisible(); await page.keyboard.press('Home');
  // Traverse enabled menu items, including the new clipboard/history entries.
  for (let i = 0; i < 15; i++) {
    if (await menu.getByRole('menuitem', { name: 'Додати рядок нижче', exact: true }).evaluate(node => node === document.activeElement)) break;
    await page.keyboard.press('ArrowDown');
  }
  await expect(menu.getByRole('menuitem', { name: 'Додати рядок нижче', exact: true })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#editor tr')).toHaveCount(4); await expect(menu).toBeHidden();
});
test('table click on empty cell enables commands and menu stays within a small viewport', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 500 });
  await load(page, '| | |\n| --- | --- |\n| | |\n'); await page.locator('#editor td').last().click();
  await expect(page.getByRole('group', { name: 'Редагування таблиці' }).getByRole('button', { name: '+ Рядок', exact: true })).toBeEnabled();
  await page.locator('#editor td').last().click({ button: 'right' });
  const box = await page.getByRole('menu', { name: 'Команди редактора' }).boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(760); expect(box.y + box.height).toBeLessThanOrEqual(500);
});
for (const context of [false, true]) test(`delete header row via ${context ? 'menu' : 'toolbar'} and promote the next row`, async ({ page }) => {
  await load(page, '| Old A | Old B |\n| :--- | ---: |\n| **New A** | *New B* |\n| Last | Row |\n');
  await page.locator('#editor th').first().click({ button: context ? 'right' : 'left' });
  if (context) await page.getByRole('menuitem', { name: 'Видалити рядок', exact: true }).click();
  else await page.getByRole('group', { name: 'Редагування таблиці' }).getByRole('button', { name: '− Рядок', exact: true }).click();
  await expect(page.locator('#editor th')).toHaveText(['New A', 'New B']);
  await expect(page.locator('#editor td')).toHaveText(['Last', 'Row']);
  await expect(page.locator('#editor th strong')).toHaveText('New A'); await expect(page.locator('#editor th em')).toHaveText('New B');
  const source = await roundTrip(page); expect(source).toContain('| :--- | ---: |'); expect(source).not.toContain('Old');
  await expect(page.locator('#editor th')).toHaveText(['New A', 'New B']);
});
test('insert columns left of a middle cell and the first cell, preserving order and alignment', async ({ page }) => {
  await load(page, '| A | B |\n| :--- | ---: |\n| One | Two |\n');
  await page.locator('#editor td').nth(1).click();
  await page.getByRole('group', { name: 'Редагування таблиці' }).getByRole('button', { name: '+ Стовпець ліворуч', exact: true }).click();
  await page.keyboard.type('Middle');
  await expect(page.locator('#editor th')).toHaveText(['A', '', 'B']); await expect(page.locator('#editor td')).toHaveText(['One', 'Middle', 'Two']);
  await page.locator('#editor td').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Додати стовпець ліворуч', exact: true }).click(); await page.keyboard.type('Left');
  await expect(page.locator('#editor td')).toHaveText(['Left', 'One', 'Middle', 'Two']);
  const source = await roundTrip(page); expect(source).toContain('| :--- | :--- | ---: | ---: |');
  await expect(page.locator('#editor td')).toHaveText(['Left', 'One', 'Middle', 'Two']);
});
test('deleting the only table row removes the table and leaves an editable paragraph', async ({ page }) => {
  await load(page, '| A |\n| --- |\n'); await page.locator('#editor th').click();
  await page.getByRole('group', { name: 'Редагування таблиці' }).getByRole('button', { name: '− Рядок', exact: true }).click();
  await expect(page.locator('#editor table')).toHaveCount(0); await page.keyboard.type('After table');
  await expect(page.locator('#editor > p').first()).toHaveText('After table'); await roundTrip(page);
  await expect(page.locator('#editor table')).toHaveCount(0);
});
