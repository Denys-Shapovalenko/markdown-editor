import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9225');
const page = browser.contexts()[0].pages()[0];
await page.waitForFunction(() => window.markdownEditor);
const results = [];
await mkdir('artifacts/native-lists', { recursive: true });
try {
  for (const initiallyListed of [false, true]) {
    await page.evaluate(() => window.markdownEditor.load(''));
    await page.locator('#editor').click();
    if (initiallyListed) await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
    await page.keyboard.type('First'); await page.keyboard.press('Enter');
    await page.keyboard.type('Second'); await page.keyboard.press('Enter'); await page.keyboard.type('Third');
    const before = await page.locator('#editor').innerHTML();
    if (!initiallyListed) {
      await page.keyboard.press('Control+a');
      await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
    }
    assert.deepEqual(await page.locator('#editor ul > li').allTextContents(), ['First', 'Second', 'Third']);
    const markdown = await page.evaluate(() => window.markdownEditor.export());
    await page.evaluate(markdown => window.markdownEditor.load(markdown), markdown);
    assert.deepEqual(await page.locator('#editor ul > li').allTextContents(), ['First', 'Second', 'Third']);
    results.push({ initiallyListed, before, after: await page.locator('#editor').innerHTML(), markdown });
  }
  await page.evaluate(() => window.markdownEditor.load('- First\n- Chosen\n- Last\n'));
  await page.locator('#editor li').nth(1).click();
  await page.getByRole('button', { name: 'Маркований список', exact: true }).click();
  assert.deepEqual(await page.locator('#editor li').allTextContents(), ['First', 'Last']);
  assert.deepEqual(await page.locator('#editor > p').allTextContents(), ['Chosen']);
  results.push({ check: 'remove-selected-item', success: true });
  await page.evaluate(() => window.markdownEditor.load('First\n\nSecond\n\nThird\n'));
  for (let i = 0; i < 3; i++) {
    await page.locator('#editor > p').first().click();
    await page.getByRole('button', { name: 'Нумерований список', exact: true }).click();
  }
  assert.equal(await page.locator('#editor ol').count(), 1);
  assert.equal(await page.evaluate(() => window.markdownEditor.export()), '1. First\n2. Second\n3. Third\n');
  results.push({ check: 'continuous-numbering', success: true });
  await page.evaluate(() => window.markdownEditor.load('| A | B |\n| --- | --- |\n| One | Two |\n'));
  await page.locator('#editor td').first().click();
  const tools = page.getByRole('group', { name: 'Редагування таблиці' });
  assert.equal(await tools.getByRole('button', { name: '+ Рядок', exact: true }).isEnabled(), true);
  await tools.getByRole('button', { name: '+ Рядок', exact: true }).click();
  assert.equal(await page.locator('#editor tr').count(), 3);
  await page.locator('#editor td').first().click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Команди редактора' });
  assert.equal(await menu.isVisible(), true);
  await page.screenshot({ path: 'artifacts/native-lists/table-context-menu.png' });
  await menu.getByRole('menuitem', { name: 'Додати стовпець праворуч', exact: true }).click();
  assert.equal(await page.locator('#editor th').count(), 3);
  await page.locator('#editor td').first().click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Видалити стовпець', exact: true }).click();
  assert.equal(await page.locator('#editor th').count(), 2);
  results.push({ check: 'table-toolbar-and-context-menu', success: true });
  await page.evaluate(() => window.markdownEditor.load('| Old A | Old B |\n| :--- | ---: |\n| New A | New B |\n'));
  await page.locator('#editor th').first().click({ button: 'right' });
  await page.screenshot({ path: 'artifacts/native-lists/table-context-menu.png' });
  await menu.getByRole('menuitem', { name: 'Видалити рядок', exact: true }).click();
  assert.deepEqual(await page.locator('#editor th').allTextContents(), ['New A', 'New B']);
  await page.locator('#editor th').first().click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Додати стовпець ліворуч', exact: true }).click();
  await page.keyboard.type('Left');
  assert.deepEqual(await page.locator('#editor th').allTextContents(), ['Left', 'New A', 'New B']);
  const updatedTable = await page.evaluate(() => window.markdownEditor.export());
  await page.evaluate(source => window.markdownEditor.load(source), updatedTable);
  assert.deepEqual(await page.locator('#editor th').allTextContents(), ['Left', 'New A', 'New B']);
  results.push({ check: 'delete-header-and-insert-left-column', success: true });
  await writeFile('artifacts/native-lists/result.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await page.evaluate(() => { window.markdownEditor.load(''); window.chrome.webview.postMessage({type:'command',command:'close'}); });
  await browser.close();
}
