import { MarkdownDocument, blockMarkdown, inlineMarkdown, safeUrl } from './markdown.js';

function textBlocks(text, document) {
  const fragment = document.createDocumentFragment();
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const p = document.createElement('p'); p.textContent = line; if (!line) p.append(document.createElement('br')); fragment.append(p);
  }
  return fragment;
}
// Parse in a template: scripts/resources are inert. Only explicitly constructed nodes reach the editor.
export function convertHtml(html, document) {
  const template = document.createElement('template'); template.innerHTML = html;
  const report = [];
  const merged = template.content.querySelectorAll('[rowspan]:not([rowspan="1"]),[colspan]:not([colspan="1"])').length;
  if (merged) report.push(`Об’єднані клітинки (${merged}) буде розділено; текст залишиться в першій клітинці.`);
  if (template.content.querySelector('[style],[class],[width],[height]')) report.push('Кольори, шрифти та розміри оформлення не переносяться в Markdown.');
  if (template.content.querySelector('script,style,iframe,object,svg,math,video,audio')) report.push('Активний вміст і непідтримуване медіа буде пропущено.');
  const allowed = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'S', 'DEL', 'BR', 'UL', 'OL', 'LI', 'PRE', 'CODE', 'BLOCKQUOTE', 'HR']);
  function children(source, target) { for (const child of source.childNodes) append(child, target); }
  function append(node, target) {
    if (node.nodeType === 3) { target.append(document.createTextNode(node.data)); return; }
    if (node.nodeType !== 1) return;
    const tag = node.tagName;
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'META', 'LINK'].includes(tag)) return;
    if (tag === 'TABLE') { target.append(convertTable(node)); return; }
    if (tag === 'A') {
      const a = document.createElement('a'); const url = safeUrl(node.getAttribute('href'));
      if (url) { a.setAttribute('href', url); if (node.title) a.title = node.title; children(node, a); target.append(a); } else children(node, target);
      return;
    }
    if (tag === 'IMG') {
      const url = safeUrl(node.getAttribute('src'), true);
      if (url) { const img = document.createElement('img'); img.dataset.src = url; img.alt = node.alt ?? ''; if (node.title) img.title = node.title; if (!/^https?:/i.test(url)) img.src = url; target.append(img); }
      else { if (node.alt) target.append(document.createTextNode(node.alt)); report.push('Зображення без переносимого шляху пропущено; альтернативний текст збережено.'); }
      return;
    }
    if (tag === 'INPUT' && node.getAttribute('type') === 'checkbox') {
      const check = document.createElement('input'); check.type = 'checkbox'; check.contentEditable = 'false'; check.setAttribute('aria-label', 'Пункт виконано');
      if (node.hasAttribute('checked')) check.setAttribute('checked', ''); target.append(check); return;
    }
    if (!allowed.has(tag)) { children(node, target); return; }
    const el = document.createElement(tag === 'DIV' ? 'p' : tag.toLowerCase());
    if (tag === 'OL' && Number(node.getAttribute('start')) > 0) el.start = Number(node.getAttribute('start'));
    children(node, el); target.append(el);
  }
  function convertTable(source) {
    const grid = []; const rows = [...source.rows];
    if (rows.length > 1000) throw new Error('Вставлення обмежено 1000 рядками.');
    rows.forEach((row, r) => {
      grid[r] ??= []; let c = 0;
      for (const cell of row.cells) {
        while (grid[r][c] !== undefined) c++;
        const width = Math.min(100, Math.max(1, Number(cell.getAttribute('colspan')) || 1));
        const height = Math.min(1000 - r, Math.max(1, Number(cell.getAttribute('rowspan')) || 1));
        if (c + width > 100) throw new Error('Вставлення обмежено 100 стовпцями.');
        const clean = document.createElement('span'); children(cell, clean);
        // Pipe table cells cannot contain blocks. Preserve their text/inline content and report flattening.
        if (clean.querySelector('p,ul,ol,pre,blockquote,table,br')) {
          report.push('Багаторядковий або блоковий вміст клітинок буде об’єднано в один рядок.');
          clean.textContent = cell.textContent.replace(/\s+/g, ' ').trim();
        }
        for (let rr = r; rr < r + height; rr++) {
          grid[rr] ??= [];
          for (let cc = c; cc < c + width; cc++) grid[rr][cc] = rr === r && cc === c ? clean : document.createElement('span');
        }
        c += width;
      }
    });
    const width = Math.max(1, ...grid.map(row => row.length));
    if (grid.length * width > 20000) throw new Error('Таблиця перевищує ліміт 20 000 клітинок.');
    const table = document.createElement('table'); const head = table.createTHead(); const body = table.createTBody();
    grid.forEach((row, r) => {
      const tr = (r ? body : head).insertRow();
      for (let c = 0; c < width; c++) { const cell = document.createElement(r ? 'td' : 'th'); cell.append(...(row[c]?.childNodes ?? [])); if (!cell.hasChildNodes()) cell.append(document.createElement('br')); tr.append(cell); }
    });
    return table;
  }
  const result = document.createElement('div'); children(template.content, result);
  // Whitespace between source HTML blocks must not create phantom paragraphs.
  for (const node of [...result.childNodes]) if (node.nodeType === 3 && !node.data.trim()) node.remove();
  return { fragment: result, report: [...new Set(report)] };
}

export function installClipboard(ctx) {
  const { editor, model, history, changed, showNotice, selectionRange, protectedSelection, restoreSelection, focusAt } = ctx;
  let pending = null;
  const dialog = document.createElement('dialog'); dialog.id = 'paste-dialog'; dialog.setAttribute('aria-labelledby', 'paste-title');
  dialog.innerHTML = '<h2 id="paste-title">Перевірка вставлення</h2><p id="paste-report"></p><div id="paste-preview" aria-label="Попередній перегляд"></div><div class="dialog-actions"><button data-cancel>Скасувати</button><button class="primary" data-confirm>Вставити спрощений Markdown</button></div>';
  document.body.append(dialog);
  dialog.querySelector('[data-cancel]').onclick = () => { pending = null; dialog.close(); restoreSelection(); };
  dialog.querySelector('[data-confirm]').onclick = () => { const value = pending; pending = null; dialog.close(); restoreSelection(); insert(value); };
  function selectionData() {
    const range = selectionRange(); if (!range || range.collapsed) return { text: '', markdown: '' };
    const fragment = document.createElement('div'); fragment.append(range.cloneContents());
    const parts = []; let inline = document.createElement('span');
    function flush() { if (inline.hasChildNodes()) { parts.push(inlineMarkdown(inline)); inline = document.createElement('span'); } }
    for (const node of fragment.childNodes) {
      const record = model.records.get(node.dataset?.sourceId);
      if (record?.opaque) { flush(); parts.push(record.raw); }
      else if (node.nodeType === 3 || ['STRONG', 'B', 'I', 'EM', 'S', 'CODE', 'A', 'IMG', 'SPAN', 'BR'].includes(node.tagName)) inline.append(node.cloneNode(true));
      else { flush(); parts.push(blockMarkdown(node)); }
    }
    flush();
    function plain(node) {
      if (node.nodeType === 3) return node.data;
      const raw = model.records.get(node.dataset?.sourceId); if (raw?.opaque) return raw.raw;
      if (node.tagName === 'BR') return '\n'; if (node.tagName === 'IMG') return node.alt;
      if (node.tagName === 'INPUT') return node.hasAttribute('checked') ? '[x] ' : '[ ] ';
      if (node.tagName === 'TABLE') return [...node.rows].map(r => [...r.cells].map(plain).join('\t')).join('\n') + '\n';
      const text = [...node.childNodes].map(plain).join('');
      return text + (['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE'].includes(node.tagName) ? '\n' : '');
    }
    return { text: [...fragment.childNodes].map(plain).join('').replace(/\n$/, ''), markdown: parts.join('\n\n') };
  }
  function cut() {
    if (ctx.busy || protectedSelection()) { showNotice('Вирізання захищених блоків недоступне. Їх можна скопіювати або змінити в режимі джерела.'); return; }
    history.before(); const range = selectionRange(); range?.deleteContents(); changed();
  }
  function insert(container) {
    if (!container || ctx.busy || protectedSelection()) return;
    history.before(); const range = selectionRange(); if (!range) return;
    // Validate before insertion, then merge unique raw-record IDs for pasted Markdown.
    const fragments = [...container.childNodes];
    if (ctx.currentCell()) {
      if (container.querySelector('table')) { showNotice('Щоб вставити цілу таблицю, оберіть абзац поза таблицею.'); return; }
      const text = container.textContent.replace(/\s*\n\s*/g, ' '); range.deleteContents(); const node = document.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true);
      window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    } else if (fragments.every(n => n.nodeType === 3 || ['STRONG', 'B', 'I', 'EM', 'S', 'CODE', 'A', 'IMG', 'SPAN', 'BR'].includes(n.tagName))) {
      range.deleteContents(); const fragment = document.createDocumentFragment(); fragment.append(...fragments); const last = fragment.lastChild; range.insertNode(fragment);
      if (last) { range.setStartAfter(last); range.collapse(true); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); }
    } else {
      // Split the containing paragraph/list item so pasting never nests block elements inside a P.
      range.deleteContents(); let block = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
      while (block && block !== editor && block.parentElement !== editor) block = block.parentElement;
      if (block && block !== editor) {
        const originalListItem = ctx.elementAtCursor()?.closest('li'); const originalIndex = originalListItem ? [...block.children].indexOf(originalListItem) : -1;
        const tailRange = document.createRange(); tailRange.selectNodeContents(block); tailRange.setStart(range.startContainer, range.startOffset);
        const tail = block.cloneNode(false); tail.removeAttribute('data-source-id'); tail.append(tailRange.extractContents());
        if (tail.tagName === 'OL' && originalIndex >= 0) tail.start = (Number(block.getAttribute('start')) || 1) + originalIndex;
        const fragment = document.createDocumentFragment(); fragment.append(...fragments); if (tail.textContent || tail.querySelector('img')) fragment.append(tail);
        block.after(fragment); if (!block.textContent && !block.querySelector('img,input')) block.remove();
      } else editor.append(...fragments);
      const last = fragments.at(-1); if (last?.isConnected) {
        if (last.tagName === 'TABLE') { const p = document.createElement('p'); p.append(document.createElement('br')); last.after(p); focusAt(p); }
        else focusAt(last, true);
      }
    }
    if (container.pasteRecords) for (const [id, record] of container.pasteRecords) model.records.set(id, record);
    ctx.rememberSelection(); changed();
  }
  function paste(data, mode = 'auto') {
    if (ctx.busy || protectedSelection()) return;
    if (new TextEncoder().encode((data.text ?? '') + (data.html ?? '')).length > 5 * 1024 * 1024) throw new Error('Буфер перевищує ліміт 5 MiB.');
    let container;
    if (mode === 'markdown' || (mode === 'auto' && data.markdown)) {
      container = document.createElement('div'); const temp = new MarkdownDocument(container); temp.load(data.markdown || data.text || '');
      const records = [];
      for (const block of container.querySelectorAll('[data-source-id]')) {
        const old = block.dataset.sourceId; const record = temp.records.get(old); const id = 'paste-' + crypto.randomUUID(); block.dataset.sourceId = id;
        records.push([id, { ...record, html: block.outerHTML }]);
      }
      container.pasteRecords = records;
    } else if (mode === 'auto' && data.html) {
      const converted = convertHtml(data.html, document); container = converted.fragment;
      if (converted.report.length) {
        pending = container; dialog.querySelector('#paste-report').textContent = converted.report.join(' ');
        const preview = container.cloneNode(true); preview.querySelectorAll('img').forEach(img => img.removeAttribute('src'));
        dialog.querySelector('#paste-preview').replaceChildren(...preview.childNodes); dialog.showModal(); return;
      }
    } else {
      container = document.createElement('div'); const text = data.text ?? '';
      if (text.includes('\t') && text.includes('\n') && mode !== 'plain') {
        const htmlTable = document.createElement('table');
        const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
        if (lines.length > 1000 || lines.some(line => line.split('\t').length > 100)) throw new Error('Завелика таблиця в буфері.');
        for (const line of lines) { const row = htmlTable.insertRow(); for (const value of line.split('\t')) row.insertCell().textContent = value; }
        container = convertHtml(htmlTable.outerHTML, document).fragment;
      } else if (!text.includes('\n') && !text.includes('\r')) container.append(document.createTextNode(text));
      else container.append(textBlocks(text, document));
    }
    insert(container);
  }
  for (const type of ['copy', 'cut']) editor.addEventListener(type, event => {
    event.preventDefault();
    try {
      if (type === 'cut' && (ctx.busy || protectedSelection())) { showNotice('Захищений блок можна скопіювати, але не вирізати.'); return; }
      const data = selectionData(); event.clipboardData.setData('text/plain', data.text); event.clipboardData.setData('text/markdown', data.markdown);
      if (type === 'cut') cut();
    } catch (error) { showNotice(error.message, true); }
  });
  editor.addEventListener('paste', event => {
    event.preventDefault();
    try { paste({ text: event.clipboardData.getData('text/plain'), html: event.clipboardData.getData('text/html'), markdown: event.clipboardData.getData('text/markdown') }); }
    catch (error) { showNotice(error.message, true); }
  });
  return { paste, selectionData, cut };
}
