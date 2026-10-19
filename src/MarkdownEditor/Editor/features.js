import { MarkdownDocument, blockMarkdown, htmlOf, safeUrl } from './markdown.js';
import { bookmark, selectBookmark } from './history.js';
import { installClipboard } from './clipboard.js';
import { installTableFeatures } from './table-features.js';
import { addMenuIcons } from './icons.js';

const printCss = `body{font:11pt 'Segoe UI',sans-serif;color:#17261f;margin:20mm}article{line-height:1.5;overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6{break-after:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:10pt}td,th{border:1px solid #aaa;padding:5px;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr,img,pre{break-inside:avoid}img{max-width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:8px}blockquote{border-left:3px solid #aaa;margin-left:0;padding-left:15px}input[type=checkbox]{margin-right:6px}a{color:#185c49}code{font-family:Consolas,monospace}p{margin:0 0 10px}@page{margin:15mm}`;

export function installFeatures(ctx) {
  const { editor, model, history, post, showNotice, selectionRange, protectedSelection, focusAt, elementAtCursor, rememberSelection, restoreSelection } = ctx;
  const mutate = action => { if (ctx.busy || sourceMode || protectedSelection()) return; restoreSelection(); history.before(); action(); rememberSelection(); ctx.changed(); };
  let sourceMode = false; let sourceMark = null; let sourceOriginal = ''; let sourceInitialText = ''; let composing = false; let lastSearch = ''; let matches = []; let matchIndex = -1; let lastSearchHtml = '';
  const toolbar = document.querySelector('.toolbar');
  const source = document.createElement('textarea'); source.id = 'source-editor'; source.hidden = true; source.spellcheck = false; source.setAttribute('aria-label', 'Markdown джерело документа'); editor.before(source);
  const searchPanel = document.createElement('section'); searchPanel.id = 'search-panel'; searchPanel.hidden = true; searchPanel.setAttribute('aria-label', 'Пошук і заміна');
  searchPanel.innerHTML = '<label>Знайти <input id="find-text" type="search"></label><label>Замінити на <input id="replace-text"></label><label><input id="find-case" type="checkbox">Враховувати регістр</label><button data-find="previous">Назад</button><button data-find="next">Далі</button><button data-find="replace">Замінити</button><button data-find="all">Замінити всі</button><span id="find-status" role="status" aria-live="polite"></span><small>Захищені блоки пропускаються</small><button data-find="close" aria-label="Закрити пошук">✕</button>';
  toolbar.after(searchPanel);
  const outline = document.createElement('aside'); outline.id = 'outline'; outline.hidden = true; outline.setAttribute('aria-label', 'Зміст документа'); document.querySelector('main').before(outline);
  const clipboard = installClipboard(ctx);
  const tables = installTableFeatures(ctx, mutate);

  function makeDialog(id, title, fields) {
    const dialog = document.createElement('dialog'); dialog.id = id; dialog.setAttribute('aria-labelledby', id + '-title');
    dialog.innerHTML = `<form><h2 id="${id}-title">${title}</h2>${fields}<div class="dialog-actions"><button type="button" data-cancel>Скасувати</button><button class="primary" type="submit">Застосувати</button></div></form>`;
    document.body.append(dialog);
    const cancel = () => { dialog.close(); restoreSelection(); };
    dialog.querySelector('[data-cancel]').onclick = cancel; dialog.addEventListener('cancel', () => setTimeout(restoreSelection));
    return dialog;
  }
  let linkTarget = null; let imageMode = false;
  const linkDialog = makeDialog('link-dialog', 'Посилання або зображення', '<label>Текст / альтернативний текст<input id="link-text"></label><label>URL або відносний шлях<input id="link-url" required></label><label>Підказка (title)<input id="link-title"></label><p>Зовнішні зображення завантажуються лише за окремою командою. Локальні — з папки документа.</p><button type="button" id="choose-image">Обрати локальний файл…</button><button type="button" id="rename-image">Перейменувати вкладення…</button><button type="button" id="remove-link">Прибрати посилання / зображення</button>');
  const codeDialog = makeDialog('code-dialog', 'Код', '<label>Мова (для блока)<input id="code-language" maxlength="80"></label><label>Текст коду<textarea id="code-text" rows="10" spellcheck="false"></textarea></label>');
  const blockDialog = makeDialog('block-source-dialog', 'Markdown вибраного блока', '<label>Джерело<textarea id="block-source-text" rows="14" spellcheck="false"></textarea></label><p>Зміни застосовуються лише до цього блока. Невідому розмітку буде збережено захищеною.</p>');
  let codeTarget = null; let inlineCodeMode = false; let blockTarget = null;

  function topBlock() { let node = elementAtCursor(); while (node && node !== editor && node.parentElement !== editor) node = node.parentElement; return node === editor ? null : node; }
  function insertBlock(block) {
    const selected = topBlock(); if (selected) selected.after(block); else editor.append(block);
    if (['HR', 'TABLE', 'PRE'].includes(block.tagName) && !block.nextSibling) { const p = document.createElement('p'); p.append(document.createElement('br')); block.after(p); }
    if (block.tagName === 'HR') focusAt(block.nextElementSibling ?? block.previousElementSibling); else focusAt(block, true);
  }
  function ensureSize(value) { if (new TextEncoder().encode(value).length > 5 * 1024 * 1024) throw new Error('Документ перевищує ліміт 5 MiB.'); }
  function getSource() { const value = sourceMode ? (source.value === sourceInitialText ? sourceOriginal : source.value.replace(/\r\n?/g, '\n').replace(/\n/g, model.newline)) : model.export(); ensureSize(value); return value; }
  function applySource() {
    if (!sourceMode || getSource() === model.export()) return;
    const value = getSource(); history.before(); model.replaceSource(value); history.commit(); savedSelectionAfterSource();
  }
  function savedSelectionAfterSource() { rememberSelection(); }
  function toggleSource() {
    if (ctx.busy) return;
    try {
      if (!sourceMode) {
        sourceMark = bookmark(editor); sourceOriginal = model.export(); source.value = sourceOriginal; sourceInitialText = source.value; sourceMode = true; editor.hidden = true; source.hidden = false;
        // Anchor approximately by the selected block's source; exact DOM bookmark is kept for an unchanged round trip.
        const selected = topBlock(); const raw = model.records.get(selected?.dataset.sourceId)?.raw?.trimEnd();
        const position = raw ? Math.max(0, source.value.indexOf(raw)) : 0;
        source.focus(); source.setSelectionRange(position, position);
      } else {
        const unchanged = getSource() === model.export(); const position = source.selectionStart; applySource(); sourceMode = false; source.hidden = true; editor.hidden = false;
        if (unchanged) selectBookmark(editor, sourceMark);
        else {
          let offset = 0; let target = editor.firstElementChild;
          for (const block of editor.children) { const raw = model.records.get(block.dataset.sourceId)?.raw ?? ''; if (offset <= position) target = block; offset += raw.length; }
          if (target) focusAt(target);
        }
        rememberSelection(); ctx.changed('mode', false);
      }
      update();
    } catch (error) { showNotice(error.message, true); }
  }
  source.addEventListener('input', () => { try { const dirty = getSource() !== model.savedSource; post({ type: 'changed', dirty }); document.querySelector('#document-state').textContent = dirty ? 'Є незбережені зміни' : 'Усі зміни збережено'; document.querySelector('#header-document-state').textContent = `${document.querySelector('#file-name').textContent}${dirty ? ' •' : ''}`; } catch (error) { showNotice(error.message, true); post({ type: 'changed', dirty: true }); } update(); });
  function undo(redo = false) {
    if (ctx.busy) return;
    if (sourceMode) { source.focus(); document.execCommand(redo ? 'redo' : 'undo'); return; }
    if (history.move(redo)) ctx.changed('history', false); update();
  }
  function indent(outdent = false) {
    mutate(() => {
      const range = selectionRange(); const item = elementAtCursor()?.closest('li'); if (!item || !range) return;
      const list = item.parentElement;
      const items = range.collapsed ? [item] : [...list.children].filter(li => range.intersectsNode(li));
      if (outdent) {
        const parentItem = list.parentElement.closest('li');
        if (!parentItem) { ctx.command(list.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList'); return; }
        const next = items.at(-1).nextElementSibling;
        if (next) { const tail = list.cloneNode(false); tail.removeAttribute('data-source-id'); let n = next; while (n) { const following = n.nextElementSibling; tail.append(n); n = following; } items.at(-1).append(tail); }
        let anchor = parentItem; for (const li of items) { anchor.after(li); anchor = li; }
        if (!list.children.length) list.remove();
      } else {
        const previous = items[0].previousElementSibling; if (!previous) { showNotice('Для вкладення потрібен попередній пункт.'); return; }
        let nested = previous.lastElementChild;
        if (nested?.tagName !== list.tagName) { nested = document.createElement(list.tagName.toLowerCase()); previous.append(nested); }
        nested.append(...items);
      }
      focusAt(items[0]);
    });
  }
  function task() {
    mutate(() => {
      if (!elementAtCursor()?.closest('li')) ctx.command('insertUnorderedList');
      const range = selectionRange(); const item = elementAtCursor()?.closest('li'); if (!item) return;
      const items = range?.collapsed ? [item] : [...item.parentElement.children].filter(li => range.intersectsNode(li));
      const remove = items.every(li => li.querySelector(':scope > input[type=checkbox]'));
      for (const li of items) {
        const existing = li.querySelector(':scope > input[type=checkbox]');
        if (remove) existing?.remove();
        else if (!existing) { const check = document.createElement('input'); check.type = 'checkbox'; check.contentEditable = 'false'; check.setAttribute('aria-label', 'Пункт виконано'); li.prepend(check); }
      }
      focusAt(items[0], true);
    });
  }
  editor.addEventListener('change', event => { if (event.target.matches('input[type=checkbox]')) { history.before(); event.target.toggleAttribute('checked', event.target.checked); ctx.changed(); } });
  function openLink(image) {
    if (sourceMode || protectedSelection() || ctx.busy) return;
    rememberSelection(); imageMode = image; linkTarget = elementAtCursor()?.closest(image ? 'img' : 'a');
    const range = selectionRange();
    if (image && !linkTarget && range?.startContainer.nodeType === 1) linkTarget = range.startContainer.childNodes[range.startOffset]?.nodeType === 1 && range.startContainer.childNodes[range.startOffset]?.matches('img') ? range.startContainer.childNodes[range.startOffset] : null;
    document.querySelector('#link-text').value = linkTarget ? (image ? linkTarget.alt : linkTarget.textContent) : range?.toString() ?? '';
    document.querySelector('#link-url').value = linkTarget ? (image ? linkTarget.dataset.src : linkTarget.getAttribute('href')) : '';
    document.querySelector('#link-title').value = linkTarget?.title ?? '';
    document.querySelector('#choose-image').hidden = !image; document.querySelector('#rename-image').hidden = !image || !linkTarget;
    document.querySelector('#remove-link').hidden = !linkTarget;
    linkDialog.querySelector('h2').textContent = image ? 'Зображення' : 'Посилання'; linkDialog.showModal(); document.querySelector('#link-url').focus();
  }
  editor.addEventListener('dblclick', event => { if (event.target.closest('a,img')) { event.preventDefault(); if (event.target.tagName === 'IMG') { const range = document.createRange(); range.selectNode(event.target); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); } openLink(event.target.tagName === 'IMG'); } });
  // Editing a link never navigates away from the local document.
  editor.addEventListener('click', event => { if (event.target.closest('a')) event.preventDefault(); });
  document.querySelector('#choose-image').onclick = () => post({ type: 'command', command: 'chooseImage' });
  document.querySelector('#rename-image').onclick = () => post({ type: 'command', command: 'renameImage', path: linkTarget?.dataset.src });
  document.querySelector('#remove-link').onclick = () => { linkDialog.close(); mutate(() => { if (imageMode) linkTarget?.remove(); else if (linkTarget) linkTarget.replaceWith(...linkTarget.childNodes); }); };
  linkDialog.querySelector('form').onsubmit = event => {
    event.preventDefault(); const value = document.querySelector('#link-url').value.trim().replace(/ /g, '%20');
    const url = safeUrl(value, imageMode); if (!url) { showNotice('Вкажіть відносний шлях, https/http URL або допустиму адресу посилання.', true); return; }
    linkDialog.close(); mutate(() => {
      const node = linkTarget ?? document.createElement(imageMode ? 'img' : 'a');
      node.title = document.querySelector('#link-title').value;
      if (imageMode) { node.alt = document.querySelector('#link-text').value; node.dataset.src = url; node.removeAttribute('src'); if (!/^https?:/i.test(url)) node.src = url; }
      else { node.setAttribute('href', url); node.textContent = document.querySelector('#link-text').value || url; }
      if (!linkTarget) { const range = selectionRange(); if (!range) { const p = editor.querySelector('p') ?? editor.appendChild(document.createElement('p')); p.append(node); } else { range.deleteContents(); range.insertNode(node); range.setStartAfter(node); range.collapse(true); window.getSelection().removeAllRanges(); window.getSelection().addRange(range); } }
    });
  };
  function code(inline) {
    if (sourceMode || protectedSelection() || ctx.busy) return;
    rememberSelection(); inlineCodeMode = inline; codeTarget = inline ? elementAtCursor()?.closest('code:not(pre code)') : elementAtCursor()?.closest('pre');
    document.querySelector('#code-text').value = codeTarget?.textContent ?? selectionRange()?.toString() ?? '';
    document.querySelector('#code-language').value = codeTarget?.querySelector('code')?.dataset.language ?? '';
    document.querySelector('#code-language').parentElement.hidden = inline; codeDialog.showModal(); document.querySelector('#code-text').focus();
  }
  codeDialog.querySelector('form').onsubmit = event => {
    event.preventDefault(); codeDialog.close(); mutate(() => {
      const text = document.querySelector('#code-text').value;
      if (inlineCodeMode) {
        const node = codeTarget ?? document.createElement('code'); node.textContent = text;
        if (!codeTarget) { const range = selectionRange(); if (!range) return; range.deleteContents(); range.insertNode(node); }
        const after = document.createTextNode(''); node.after(after); const r = document.createRange(); r.setStart(after, 0); r.collapse(true); window.getSelection().removeAllRanges(); window.getSelection().addRange(r);
      } else {
        const pre = codeTarget ?? document.createElement('pre'); const code = document.createElement('code'); code.textContent = text; code.dataset.language = document.querySelector('#code-language').value.trim(); pre.replaceChildren(code);
        if (!codeTarget) insertBlock(pre); else focusAt(code, true);
      }
    });
  };
  function openBlockSource() {
    if (sourceMode || ctx.busy) return;
    rememberSelection(); blockTarget = topBlock(); if (!blockTarget) return;
    const record = model.records.get(blockTarget.dataset.sourceId);
    document.querySelector('#block-source-text').value = record && htmlOf(blockTarget) === record.html ? record.raw : blockMarkdown(blockTarget);
    blockDialog.showModal(); document.querySelector('#block-source-text').focus();
  }
  blockDialog.querySelector('form').onsubmit = event => {
    event.preventDefault();
    try {
      const value = document.querySelector('#block-source-text').value; ensureSize(value);
      const box = document.createElement('div'); const temp = new MarkdownDocument(box); temp.load(value);
      blockDialog.close(); restoreSelection(); history.before();
      if (!blockTarget?.isConnected) return;
      model.records.delete(blockTarget.dataset.sourceId);
      for (const block of box.querySelectorAll('[data-source-id]')) { const old = block.dataset.sourceId; const id = 'source-' + crypto.randomUUID(); block.dataset.sourceId = id; model.records.set(id, { ...temp.records.get(old), html: block.outerHTML }); }
      const target = box.firstElementChild; blockTarget.replaceWith(...box.childNodes); if (target) focusAt(target); ctx.changed();
    } catch (error) { showNotice(error.message, true); }
  };

  function findMatches() {
    const query = document.querySelector('#find-text').value; lastSearch = query;
    const nodes = []; let text = ''; let previousBlock = null;
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, { acceptNode(node) { return node.parentElement.closest('.opaque') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
    let node;
    while ((node = walker.nextNode())) { const block = node.parentElement.closest('p,h1,h2,h3,h4,h5,h6,li,td,th,pre'); if (previousBlock && block !== previousBlock) text += '\n'; previousBlock = block; nodes.push({ node, start: text.length }); text += node.data; }
    matches = [];
    if (query) {
      const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const regex = new RegExp(escaped, document.querySelector('#find-case').checked ? 'gu' : 'giu');
      for (const match of text.matchAll(regex)) {
        const first = nodes.find(n => n.start + n.node.length > match.index); const end = match.index + match[0].length;
        const last = nodes.find(n => n.start + n.node.length >= end && n.start < end);
        if (!first || !last || text.slice(match.index, end).includes('\n')) continue;
        const range = document.createRange(); range.setStart(first.node, match.index - first.start); range.setEnd(last.node, end - last.start); matches.push(range);
      }
    }
    matchIndex = Math.min(matchIndex, matches.length - 1); lastSearchHtml = editor.innerHTML;
    if (globalThis.Highlight && CSS.highlights) CSS.highlights.set('search-results', new Highlight(...matches));
    document.querySelector('#find-status').textContent = `${matches.length} збігів`;
  }
  function findAction(action) {
    if (action === 'close') { searchPanel.hidden = true; CSS.highlights?.delete('search-results'); restoreSelection(); return; }
    if (sourceMode) { showNotice('Для пошуку у видимому тексті перейдіть у візуальний режим.'); return; }
    if (lastSearchHtml !== editor.innerHTML || lastSearch !== document.querySelector('#find-text').value) findMatches();
    if (!matches.length) return;
    if (action === 'next' || action === 'previous') {
      matchIndex = (matchIndex + (action === 'next' ? 1 : -1) + matches.length) % matches.length;
      const range = matches[matchIndex]; const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); rememberSelection(); range.startContainer.parentElement.scrollIntoView({ block: 'center' });
      document.querySelector('#find-status').textContent = `${matchIndex + 1} / ${matches.length}`; return;
    }
    history.before(); const replacement = document.querySelector('#replace-text').value;
    const chosen = action === 'all' ? [...matches].reverse() : [matches[matchIndex < 0 ? 0 : matchIndex]];
    for (const range of chosen) { range.deleteContents(); range.insertNode(document.createTextNode(replacement)); }
    ctx.changed(); findMatches();
  }
  searchPanel.querySelectorAll('[data-find]').forEach(button => button.onclick = () => findAction(button.dataset.find));
  searchPanel.querySelectorAll('input').forEach(input => input.addEventListener('input', findMatches));
  searchPanel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); findAction('close'); } if (event.key === 'Enter') { event.preventDefault(); findAction(event.shiftKey ? 'previous' : 'next'); } });
  function updateOutline() {
    if (outline.hidden) return;
    const heading = document.createElement('strong'); heading.textContent = 'Зміст'; const nodes = [heading];
    for (const block of editor.querySelectorAll('h1,h2,h3,h4,h5,h6')) { const button = document.createElement('button'); button.textContent = block.textContent || '(Порожній заголовок)'; button.dataset.level = block.tagName[1]; button.onclick = () => { focusAt(block); block.scrollIntoView({ block: 'center' }); }; nodes.push(button); }
    if (nodes.length === 1) { const p = document.createElement('p'); p.textContent = 'Додайте заголовки H1–H6.'; nodes.push(p); }
    outline.replaceChildren(...nodes);
  }
  function printContent() {
    applySource(); const clone = editor.cloneNode(true); clone.removeAttribute('contenteditable'); clone.removeAttribute('role'); clone.removeAttribute('aria-label');
    clone.querySelectorAll('.cell-selected').forEach(n => n.classList.remove('cell-selected'));
    for (const opaque of clone.querySelectorAll('.opaque')) { const pre = document.createElement('pre'); pre.textContent = model.records.get(opaque.dataset.sourceId)?.raw ?? ''; opaque.replaceWith(pre); }
    clone.querySelectorAll('[data-source-id]').forEach(n => n.removeAttribute('data-source-id'));
    clone.querySelectorAll('input[type=checkbox]').forEach(n => { n.disabled = true; });
    return clone;
  }
  function preparePrint() {
    document.querySelector('#print-document')?.remove(); const clone = printContent(); clone.id = 'print-document'; document.body.append(clone); return clone;
  }
  function htmlExport() {
    const clone = printContent(); const title = document.querySelector('#file-name').textContent;
    const html = document.implementation.createHTMLDocument(title); html.documentElement.lang = 'uk';
    const meta = html.createElement('meta'); meta.setAttribute('charset', 'utf-8'); html.head.prepend(meta);
    const csp = html.createElement('meta'); csp.httpEquiv = 'Content-Security-Policy'; csp.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"; html.head.append(csp);
    const style = html.createElement('style'); style.textContent = printCss; html.head.append(style); clone.id = 'document'; html.body.append(html.importNode(clone, true));
    return '<!doctype html>\n' + html.documentElement.outerHTML;
  }
  const actions = {
    undo: () => undo(), redo: () => undo(true), source: toggleSource, blockSource: openBlockSource,
    find: () => { searchPanel.hidden = false; document.querySelector('#find-text').focus(); findMatches(); },
    outline: () => { outline.hidden = !outline.hidden; document.body.classList.toggle('outline-open', !outline.hidden); updateOutline(); },
    indent: () => indent(), outdent: () => indent(true), task, link: () => openLink(false), image: () => openLink(true), inlineCode: () => code(true), code: () => code(false),
    quote: () => mutate(() => { const block = topBlock(); if (!block) return; if (block.tagName === 'BLOCKQUOTE') block.replaceWith(...block.childNodes); else { const quote = document.createElement('blockquote'); block.before(quote); quote.append(block); } }),
    rule: () => mutate(() => insertBlock(document.createElement('hr'))),
    copy: () => { restoreSelection(); post({ type: 'clipboardWrite', ...clipboard.selectionData() }); },
    cut: () => { restoreSelection(); if (protectedSelection()) { showNotice('Захищені блоки не можна вирізати.'); return; } post({ type: 'clipboardWrite', ...clipboard.selectionData(), cut: true }); },
    paste: () => { rememberSelection(); post({ type: 'command', command: 'paste' }); },
    pasteMarkdown: () => { rememberSelection(); post({ type: 'command', command: 'pasteMarkdown' }); },
    recovery: () => post({ type: 'command', command: 'recoverDocuments' }), reload: () => post({ type: 'command', command: 'reload' }),
    print: () => post({ type: 'command', command: 'print' }), pdf: () => post({ type: 'command', command: 'pdf' }), html: () => post({ type: 'command', command: 'html' })
  };
  document.querySelectorAll('#menu-bar [data-v2], .toolbar [data-v2]').forEach(button => {
    button.addEventListener('pointerdown', event => { if (!['find', 'source'].includes(button.dataset.v2)) event.preventDefault(); });
    button.onclick = () => { try { actions[button.dataset.v2](); } catch (error) { showNotice(error.message, true); } };
  });
  // Clipboard commands also appear in the existing keyboard-accessible context menu.
  const menu = document.querySelector('#context-menu'); const first = menu.firstChild; const iconBox = document.createElement('div');
  for (const [action, label] of [['undo', 'Скасувати'], ['redo', 'Повторити'], ['copy', 'Копіювати'], ['cut', 'Вирізати'], ['paste', 'Вставити']]) {
    const button = document.createElement('button'); button.setAttribute('role', 'menuitem'); button.dataset.v2 = action; button.textContent = label; button.onpointerdown = event => event.preventDefault(); button.onclick = () => actions[action](); iconBox.append(button);
  }
  addMenuIcons(iconBox); menu.insertBefore(iconBox, first);
  document.addEventListener('keydown', event => {
    if (event.isComposing || composing) return;
    const inField = event.target.matches('input:not([type=checkbox]),textarea,select') && event.target !== source;
    if (event.ctrlKey && !event.altKey && !inField && !document.querySelector('dialog[open]')) {
      const action = event.code === 'KeyZ' ? (event.shiftKey ? 'redo' : 'undo') : event.code === 'KeyY' ? 'redo' : event.code === 'KeyF' || event.code === 'KeyH' ? 'find' : event.code === 'KeyP' ? 'print' : null;
      if (action && !(sourceMode && ['undo', 'redo'].includes(action))) { event.preventDefault(); event.stopImmediatePropagation(); actions[action](); return; }
      if (event.shiftKey && event.code === 'KeyV' && selectionRange()) { event.preventDefault(); event.stopImmediatePropagation(); actions.pasteMarkdown(); return; }
    }
    if (sourceMode || ctx.busy || !selectionRange() || inField) return;
    const pre = elementAtCursor()?.closest('pre');
    if (pre && ['Enter', 'Tab'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation(); mutate(() => {
        const range = selectionRange(); const node = document.createTextNode(event.key === 'Tab' ? '    ' : '\n'); range.deleteContents(); range.insertNode(node); range.setStartAfter(node); range.collapse(true); window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
      }); return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      const item = elementAtCursor()?.closest('li');
      if (item && !item.textContent.trim() && item.parentElement.closest('li')) { event.preventDefault(); event.stopImmediatePropagation(); indent(true); return; }
      const p = elementAtCursor()?.closest('blockquote p');
      if (p && !p.textContent.trim()) { event.preventDefault(); event.stopImmediatePropagation(); mutate(() => { const quote = p.closest('blockquote'); const after = document.createElement('p'); after.append(document.createElement('br')); quote.after(after); p.remove(); if (!quote.textContent.trim()) quote.remove(); focusAt(after); }); }
    }
  }, true);
  editor.addEventListener('compositionstart', () => { history.before(); composing = true; });
  editor.addEventListener('compositionend', () => { composing = false; ctx.changed('composition'); });
  editor.addEventListener('pointerdown', () => history.breakGroup());
  editor.addEventListener('keydown', event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) history.breakGroup(); });

  function update() {
    document.querySelectorAll('#menu-bar [data-v2], .toolbar [data-v2]').forEach(button => { const action = button.dataset.v2; button.disabled = ctx.busy || (sourceMode && !['source', 'find', 'outline', 'print', 'pdf', 'html', 'recovery', 'reload', 'undo', 'redo'].includes(action)); });
    for (const button of document.querySelectorAll('[data-v2="undo"]')) button.disabled = ctx.busy || (!sourceMode && !history.past.length);
    for (const button of document.querySelectorAll('[data-v2="redo"]')) button.disabled = ctx.busy || (!sourceMode && !history.future.length);
    document.querySelectorAll('[data-v2="source"]').forEach(button => button.setAttribute('aria-pressed', String(sourceMode)));
    remote.hidden = !editor.querySelector('img[data-src^="http:"], img[data-src^="https:"]');
    source.disabled = ctx.busy; tables.update(); updateOutline();
    if (sourceMode) document.querySelectorAll('.toolbar button,.toolbar select,[data-table],[data-table-v2]').forEach(button => button.disabled = true);
    if (!searchPanel.hidden && lastSearchHtml !== editor.innerHTML) findMatches();
  }
  function reset() { sourceMode = false; source.hidden = true; source.value = ''; editor.hidden = false; sourceMark = null; matches = []; matchIndex = -1; CSS.highlights?.delete('search-results'); tables.reset(); }
  function receive(message, response) {
    if (message.type === 'clipboard') { restoreSelection(); clipboard.paste(message.payload, message.payload.mode); }
    else if (message.type === 'cutConfirmed') { restoreSelection(); clipboard.cut(); }
    else if (message.type === 'recovery') { response.markdown = getSource(); response.savedMarkdown = model.savedSource; }
    else if (message.type === 'restoreDraft') { model.replaceSource(message.payload.markdown); model.savedSource = message.payload.savedMarkdown; history.reset(); ctx.changed('recovery', false); }
    else if (message.type === 'imageChosen') { document.querySelector('#link-url').value = message.payload.path; }
    else if (message.type === 'imageRenamed') {
      history.before(); for (const img of editor.querySelectorAll('img')) if (img.dataset.src === message.payload.oldPath) { img.dataset.src = message.payload.path; img.src = message.payload.path; }
      document.querySelector('#link-url').value = message.payload.path; ctx.changed();
    }
    else if (message.type === 'preparePrint') { preparePrint(); }
    else if (message.type === 'html') { response.html = htmlExport(); }
    else if (message.type === 'attachments') { applySource(); response.images = [...editor.querySelectorAll('img[data-src]')].map(img => img.dataset.src).filter(src => !/^https?:/i.test(src)); }
    else if (message.type === 'notice') showNotice(message.payload.message, Boolean(message.payload.error));
    else return false;
    return true;
  }
  const remote = document.querySelector('#load-remote-images'); remote.title = 'Виконує мережеві запити до адрес зображень у документі';
  remote.onclick = () => { for (const img of editor.querySelectorAll('img[data-src]')) if (/^https?:/i.test(img.dataset.src)) img.src = img.dataset.src; };
  update();
  return { getSource, applySource, undo, indent, update, reset, receive, clipboard, tables, get sourceMode() { return sourceMode; }, get dirty() { return sourceMode ? getSource() !== model.savedSource : model.dirty; }, get composing() { return composing; } };
}
