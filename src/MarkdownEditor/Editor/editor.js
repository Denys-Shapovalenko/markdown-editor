import { MarkdownDocument } from './markdown.js';
import { addMenuIcons, addToolbarIcons } from './icons.js';
import { History, bookmark, selectBookmark } from './history.js';
import { installFeatures } from './features.js';
import { installViewPreferences } from './view.js';

const editor = document.querySelector('#editor');
const model = new MarkdownDocument(editor);
const styleSelect = document.querySelector('#block-style');
const notice = document.querySelector('#notice');
const tableDialog = document.querySelector('#table-dialog');
const contextMenu = document.querySelector('#context-menu');
addMenuIcons(contextMenu);
addMenuIcons(document.querySelector('#menu-bar'));
addToolbarIcons(document.querySelector('.toolbar'));
const appMenus = [...document.querySelectorAll('#menu-bar details')].sort((a, b) => Number(getComputedStyle(a).order) - Number(getComputedStyle(b).order));
for (const menu of appMenus) menu.addEventListener('toggle', () => {
  if (menu.open) for (const other of appMenus) if (other !== menu) other.open = false;
});
document.addEventListener('pointerdown', event => { if (!event.target.closest('#menu-bar')) appMenus.forEach(menu => { menu.open = false; }); });
document.addEventListener('keydown', event => {
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
    const key = { f: 'file', e: 'edit', v: 'view', i: 'insert', o: 'format', t: 'table' }[event.key.toLowerCase()];
    if (key) { event.preventDefault(); const menu = document.querySelector(`#menu-bar [data-menu="${key}"]`); appMenus.forEach(item => { item.open = item === menu; }); menu.querySelector('summary').focus(); return; }
  }
  const open = appMenus.find(menu => menu.open);
  if (event.key === 'Escape' && open) { event.preventDefault(); open.open = false; open.querySelector('summary').focus(); return; }
  if (!open) return;
  if (['ArrowLeft', 'ArrowRight'].includes(event.key) && event.target.matches('#menu-bar summary')) {
    event.preventDefault(); const index = appMenus.indexOf(open); const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + appMenus.length) % appMenus.length;
    appMenus.forEach((item, i) => { item.open = i === next; }); appMenus[next].querySelector('summary').focus(); return;
  }
  const items = [...open.querySelectorAll('.menu-popup button:not(:disabled):not([hidden])')];
  if (event.key === 'ArrowDown' && event.target.matches('#menu-bar summary')) { event.preventDefault(); items[0]?.focus(); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !items.includes(event.target)) return;
  event.preventDefault(); let index = items.indexOf(event.target);
  index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[index]?.focus();
});
document.querySelector('#menu-bar').addEventListener('click', event => {
  if (event.target.closest('.menu-popup button')) setTimeout(() => appMenus.forEach(menu => { menu.open = false; }), 0);
});
let savedRange = null;
let busy = false;
let activeCell = null;
let features = null;
const history = new History(() => ({ document: model.snapshot(), selection: bookmark(editor) }), state => {
  model.restore(state.document); savedRange = null; activeCell = null; selectBookmark(editor, state.selection); rememberSelection();
});

document.execCommand('defaultParagraphSeparator', false, 'p');
document.execCommand('styleWithCSS', false, false);

function post(message) { window.chrome?.webview?.postMessage(message); }
function showNotice(message, error = false) {
  notice.textContent = message; notice.hidden = !message; notice.classList.toggle('error', error);
}
function selectionRange() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return editor.contains(range.commonAncestorContainer) ? range : null;
}
function rememberSelection() {
  const range = selectionRange();
  if (range) savedRange = range.cloneRange();
}
function restoreSelection() {
  editor.focus();
  if (savedRange && editor.contains(savedRange.commonAncestorContainer)) {
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(savedRange);
  }
}
function elementAtCursor() {
  const node = selectionRange()?.startContainer;
  return node?.nodeType === 3 ? node.parentElement : node;
}
function currentCell() {
  const cell = elementAtCursor()?.closest?.('td,th');
  if (cell && editor.contains(cell)) return cell;
  return activeCell && editor.contains(activeCell) ? activeCell : null;
}
function protectedSelection(range = selectionRange()) {
  if (!range) return false;
  return [...editor.querySelectorAll('.opaque')].some(block => range.intersectsNode(block));
}
function focusAt(element, end = false) {
  activeCell = element.closest('td,th');
  editor.focus();
  const range = document.createRange(); range.selectNodeContents(element); range.collapse(!end);
  window.getSelection().removeAllRanges(); window.getSelection().addRange(range); rememberSelection(); updateToolbar();
}
function selectionBookmark() {
  const selection = selectionRange();
  if (!selection) return () => {};
  const startPoint = { node: selection.startContainer, offset: selection.startOffset };
  const endPoint = { node: selection.endContainer, offset: selection.endOffset };
  function offset(node, position) { const range = document.createRange(); range.selectNodeContents(editor); range.setEnd(node, position); return range.toString().length; }
  const start = offset(selection.startContainer, selection.startOffset);
  const end = offset(selection.endContainer, selection.endOffset);
  return () => {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const texts = []; let node; let total = 0;
    while ((node = walker.nextNode())) { texts.push({ node, start: total }); total += node.length; }
    function point(original, position) {
      if (editor.contains(original.node)) return [original.node, Math.min(original.offset, original.node.nodeType === 3 ? original.node.length : original.node.childNodes.length)];
      if (!texts.length) return [editor, 0];
      const item = texts.find(t => position <= t.start + t.node.length) ?? texts.at(-1);
      return [item.node, Math.min(item.node.length, Math.max(0, position - item.start))];
    }
    const range = document.createRange(); range.setStart(...point(startPoint, start)); range.setEnd(...point(endPoint, end));
    const current = window.getSelection(); current.removeAllRanges(); current.addRange(range); rememberSelection();
  };
}
const paragraphTags = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
function currentTopBlock(range = selectionRange()) {
  if (!range) return null;
  let node = range.startContainer;
  if (node === editor) return editor.childNodes[range.startOffset] ?? editor.lastChild;
  while (node && node.parentNode !== editor) node = node.parentNode;
  return node;
}
function atBlockEdge(block, node, offset, end) {
  if (!block.contains(node)) return false;
  while (node !== block) {
    const length = node.nodeType === 3 ? node.length : node.childNodes.length;
    if (offset !== (end ? length : 0) || (end ? node.nextSibling : node.previousSibling)) return false;
    node = node.parentNode; offset = end ? node.childNodes.length : 0;
  }
  return offset === (end ? block.childNodes.length : 0);
}
function selectedTopBlocks(range) {
  if (range.collapsed) return [currentTopBlock(range)].filter(Boolean);
  return [...editor.children].filter(block => range.intersectsNode(block)
    && !atBlockEdge(block, range.endContainer, range.endOffset, false)
    && !atBlockEdge(block, range.startContainer, range.startOffset, true));
}
function appendParagraphItems(container, list) {
  // contenteditable may contain nested DIV/P paragraphs. Each is a block, not
  // a line continuation inside the first LI. Move inline nodes to keep formatting.
  if (!container.hasChildNodes()) { const empty = document.createElement('li'); empty.append(document.createElement('br')); list.append(empty); return; }
  let item = null;
  function flush() { if (item) { list.append(item); item = null; } }
  for (const child of [...container.childNodes]) {
    if (paragraphTags.has(child.tagName)) { flush(); appendParagraphItems(child, list); }
    else { item ??= document.createElement('li'); item.append(child); }
  }
  flush();
}
function selectedListUnits(range) {
  if (range.collapsed) {
    const item = elementAtCursor()?.closest?.('li');
    if (item) return [item];
  }
  return selectedTopBlocks(range).flatMap(block => {
    if (!['UL', 'OL'].includes(block.tagName)) return [block];
    if (range.collapsed) {
      const item = elementAtCursor()?.closest?.('li');
      return [item ?? block.children[Math.min(range.startOffset, block.children.length - 1)]].filter(Boolean);
    }
    return [...block.children].filter(item => range.intersectsNode(item)
      && !atBlockEdge(item, range.endContainer, range.endOffset, false)
      && !atBlockEdge(item, range.startContainer, range.startOffset, true));
  });
}
function listSegment(source, index, tag = source.tagName) {
  const list = document.createElement(tag);
  if (tag === 'OL' && source.tagName === 'OL') list.start = (Number(source.getAttribute('start')) || 1) + index;
  return list;
}
function mergeAdjacentLists() {
  for (const list of [...editor.querySelectorAll('ul,ol')]) {
    if (!list.isConnected || !['UL', 'OL'].includes(list.tagName)) continue;
    while (list.nextElementSibling?.tagName === list.tagName) {
      const following = list.nextElementSibling; list.append(...following.childNodes); following.remove();
    }
  }
}
function toggleList(ordered) {
  const range = selectionRange(); if (!range || currentCell() || protectedSelection()) return;
  const units = selectedListUnits(range);
  const blocks = [...new Set(units.map(unit => unit.tagName === 'LI' ? unit.parentElement : unit))];
  if (!units.length || units.some(unit => unit.tagName !== 'LI' && !paragraphTags.has(unit.tagName))) return;
  const restore = selectionBookmark();
  const tag = ordered ? 'OL' : 'UL';
  const remove = units.every(unit => unit.tagName === 'LI' && unit.parentElement.tagName === tag);
  const chosen = new Set(units); const replacements = new Map();
  const emptyCaret = range.collapsed && !units[0].textContent;
  for (const block of blocks) {
    if (!['UL', 'OL'].includes(block.tagName)) {
      const list = document.createElement(tag); appendParagraphItems(block, list);
      replacements.set(block, list.firstElementChild); block.replaceWith(list); continue;
    }
    const fragment = document.createDocumentFragment();
    let segment = null; let lastSelected = null;
    [...block.children].forEach((item, index) => {
      const selected = chosen.has(item);
      if (selected && remove) {
        const p = document.createElement('p'); p.append(...item.childNodes); fragment.append(p);
        replacements.set(item, p); segment = null;
      } else {
        if (!segment || lastSelected !== selected) {
          segment = listSegment(block, index, selected ? tag : block.tagName); fragment.append(segment);
        }
        segment.append(item); replacements.set(item, item);
      }
      lastSelected = selected;
    });
    block.replaceWith(fragment);
  }
  mergeAdjacentLists();
  if (emptyCaret) { focusAt(replacements.get(units[0])); return; }
  restore();
}
function insertParagraph() {
  const range = selectionRange();
  if (!range || protectedSelection()) return;
  let block = elementAtCursor()?.closest?.('li,p,h1,h2,h3,h4,h5,h6,div');
  if (block?.closest('li')) block = block.closest('li');
  if (block && !block.contains(range.endContainer)) return false;
  if (!block || !editor.contains(block)) {
    const p = document.createElement('p'); p.append(document.createElement('br'));
    range.deleteContents(); range.insertNode(p); focusAt(p); changed(); return;
  }
  if (!range.collapsed) range.deleteContents();
  if (block.tagName === 'LI' && !block.textContent.trim()) {
    const list = block.parentElement;
    const following = list.cloneNode(false); following.removeAttribute('data-source-id');
    if (following.tagName === 'OL') following.start = (Number(list.getAttribute('start')) || 1) + [...list.children].indexOf(block) + 1;
    while (block.nextSibling) following.append(block.nextSibling);
    const p = document.createElement('p'); p.append(document.createElement('br'));
    list.after(p); if (following.hasChildNodes()) p.after(following);
    block.remove(); if (!list.hasChildNodes()) list.remove();
    focusAt(p); changed(); return;
  }
  const tail = document.createRange(); tail.selectNodeContents(block); tail.setStart(range.startContainer, range.startOffset);
  const next = document.createElement(block.tagName === 'LI' ? 'li' : 'p'); next.append(tail.extractContents());
  if (next.tagName === 'LI' && block.querySelector(':scope > input[type=checkbox]')) {
    const checkbox = block.querySelector(':scope > input[type=checkbox]').cloneNode(); checkbox.removeAttribute('checked'); next.prepend(checkbox);
  }
  for (const paragraph of [block, next]) if (!paragraph.textContent && !paragraph.querySelector('br')) paragraph.append(document.createElement('br'));
  block.after(next); focusAt(next); changed();
}
function updateToolbar() {
  const cell = currentCell();
  const range = selectionRange();
  const units = range && !cell ? selectedListUnits(range) : [];
  document.querySelector('#table-hint').textContent = cell ? `Рядок ${cell.parentElement.rowIndex + 1} · стовпець ${cell.cellIndex + 1}` : 'Оберіть клітинку таблиці';
  document.querySelectorAll('[data-table]').forEach(button => {
    button.disabled = busy || features?.sourceMode || !cell || (button.dataset.table === 'columnDelete' && cell.parentElement.cells.length === 1);
  });
  const unavailable = busy || features?.sourceMode || protectedSelection();
  for (const button of document.querySelectorAll('[data-command]')) {
    const command = button.dataset.command;
    button.disabled = unavailable || (Boolean(cell) && command.includes('List'));
    const listTag = { insertUnorderedList: 'UL', insertOrderedList: 'OL' }[command];
    const pressed = listTag ? units.length > 0 && units.every(unit => unit.tagName === 'LI' && unit.parentElement.tagName === listTag) : Boolean(range) && document.queryCommandState(command);
    button.setAttribute('aria-pressed', String(pressed));
  }
  styleSelect.disabled = unavailable || Boolean(cell);
  const heading = elementAtCursor()?.closest?.('p,h1,h2,h3,h4,h5,h6');
  styleSelect.value = heading?.tagName.toLowerCase() ?? 'p';
  document.querySelector('#insert-table').disabled = unavailable || Boolean(cell);
  features?.tables.update();
}
function changed(kind = 'command', record = true) {
  if (!editor.hasChildNodes()) { const p = document.createElement('p'); p.append(document.createElement('br')); editor.append(p); }
  const dirty = features?.dirty ?? model.dirty;
  document.querySelector('#document-state').textContent = dirty ? 'Є незбережені зміни' : 'Усі зміни збережено';
  document.querySelector('#header-document-state').textContent = `${document.querySelector('#file-name').textContent}${dirty ? ' •' : ''}`;
  document.querySelector('#footer-status').textContent = dirty ? 'Редагування документа' : 'Готово до роботи';
  const clone = editor.cloneNode(true); clone.querySelectorAll('.opaque').forEach(node => node.remove());
  const count = (clone.textContent.trim().match(/\S+/g) ?? []).length;
  document.querySelector('#word-count').textContent = `${count} слів`;
  if (record && !features?.composing) history.commit(kind);
  post({ type: 'changed', dirty }); updateToolbar(); features?.update();
}
function command(name, value = null) {
  if (busy) return;
  restoreSelection();
  history.before();
  if (protectedSelection()) { showNotice('Захищені блоки не можна змінювати. Виберіть текст поза ними.'); return; }
  if (currentCell() && (name.includes('List') || name === 'formatBlock')) return;
  if (name === 'insertUnorderedList' || name === 'insertOrderedList') toggleList(name === 'insertOrderedList');
  else document.execCommand(name, false, value);
  rememberSelection(); changed();
}

document.addEventListener('selectionchange', () => {
  const range = selectionRange();
  const element = elementAtCursor();
  const cell = element?.closest?.('td,th');
  if (cell) activeCell = cell;
  else if (range && element?.closest?.('p,h1,h2,h3,h4,h5,h6,li')) activeCell = null;
  rememberSelection(); updateToolbar();
});
editor.addEventListener('pointerdown', event => { if (event.button === 0) activeCell = event.target.closest('td,th'); });
editor.addEventListener('click', event => {
  const cell = event.target.closest('td,th');
  if (cell) {
    activeCell = cell;
    if (!cell.contains(selectionRange()?.startContainer)) focusAt(cell);
    rememberSelection(); updateToolbar();
  }
});
for (const button of document.querySelectorAll('.toolbar button, .table-tools button, #context-menu button')) button.addEventListener('pointerdown', event => event.preventDefault());
for (const button of document.querySelectorAll('#menu-bar .menu-popup button')) button.addEventListener('pointerdown', event => { event.preventDefault(); rememberSelection(); });
styleSelect.addEventListener('pointerdown', rememberSelection);
for (const button of document.querySelectorAll('[data-command]')) button.addEventListener('click', () => command(button.dataset.command));
styleSelect.addEventListener('change', () => {
  const value = styleSelect.value;
  restoreSelection();
  if (protectedSelection()) return;
  const list = elementAtCursor()?.closest?.('ul,ol');
  if (list) toggleList(list.tagName === 'OL');
  command('formatBlock', value);
});
for (const button of document.querySelectorAll('[data-file]')) button.addEventListener('click', () => {
  if (!window.chrome?.webview) { showNotice('Файлові команди доступні в настільній програмі Windows.'); return; }
  post({ type: 'command', command: button.dataset.file });
});

document.querySelector('#insert-table').addEventListener('click', () => {
  rememberSelection(); tableDialog.showModal(); document.querySelector('#table-rows').focus();
});
document.querySelectorAll('[data-menu-trigger]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.menuTrigger).click()));
document.querySelector('#cancel-table').addEventListener('click', () => { tableDialog.close(); restoreSelection(); });
tableDialog.addEventListener('cancel', () => setTimeout(restoreSelection, 0));
document.querySelector('#table-form').addEventListener('submit', event => {
  event.preventDefault();
  const rows = Number(document.querySelector('#table-rows').value);
  const columns = Number(document.querySelector('#table-columns').value);
  if (!Number.isInteger(rows) || rows < 1 || rows > 100 || !Number.isInteger(columns) || columns < 1 || columns > 20) return;
  tableDialog.close(); restoreSelection();
  if (busy || protectedSelection() || currentCell()) return;
  const table = document.createElement('table');
  const head = table.createTHead(); const body = table.createTBody();
  for (let r = 0; r < rows; r++) {
    const row = (r === 0 ? head : body).insertRow();
    for (let c = 0; c < columns; c++) { const cell = document.createElement(r === 0 ? 'th' : 'td'); cell.append(document.createElement('br')); row.append(cell); }
  }
  const range = selectionRange();
  if (range) {
    // Put a block table between paragraphs without nesting it inside a paragraph or list.
    let block = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
    while (block && block.parentNode !== editor && block !== editor) block = block.parentElement;
    if (block && block !== editor) block.after(table); else editor.append(table);
  } else editor.append(table);
  if (!table.nextElementSibling) { const p = document.createElement('p'); p.append(document.createElement('br')); table.after(p); }
  focusAt(table.rows[0].cells[0]); changed();
});

function addRow(table, afterRow = table.rows[table.rows.length - 1]) {
  const body = table.tBodies[0] ?? table.createTBody();
  const row = document.createElement('tr');
  for (const header of table.rows[0].cells) { const cell = document.createElement('td'); cell.style.textAlign = header.style.textAlign; cell.append(document.createElement('br')); row.append(cell); }
  if (afterRow.parentElement.tagName === 'TBODY') afterRow.after(row); else body.prepend(row);
  return row;
}
for (const button of document.querySelectorAll('[data-table]')) button.addEventListener('click', () => {
  if (busy) return;
  restoreSelection(); const cell = currentCell(); if (!cell) return;
  const table = cell.closest('table'); const row = cell.parentElement;
  const index = cell.cellIndex; const action = button.dataset.table;
  if (action === 'rowAdd') focusAt(addRow(table, row).cells[index]);
  if (action === 'rowDelete') {
    if (table.rows.length === 1) {
      const p = document.createElement('p'); p.append(document.createElement('br')); table.replaceWith(p); focusAt(p);
    } else if (row.rowIndex === 0) {
      const alignment = [...row.cells].map(header => header.style.textAlign);
      const following = table.rows[1]; const heading = document.createElement('tr');
      [...following.cells].forEach((original, i) => {
        const header = document.createElement('th'); header.style.textAlign = alignment[i];
        header.append(...original.childNodes); heading.append(header);
      });
      following.remove(); row.replaceWith(heading); focusAt(heading.cells[index]);
    } else {
      const previous = table.rows[row.rowIndex - 1]; row.remove(); focusAt(previous.cells[index]);
    }
  }
  if (action === 'columnAdd' || action === 'columnAddLeft') {
    const left = action === 'columnAddLeft';
    for (const r of table.rows) {
      const next = document.createElement(r.rowIndex === 0 ? 'th' : 'td'); next.style.textAlign = r.cells[index].style.textAlign; next.append(document.createElement('br'));
      if (left) r.cells[index].before(next); else r.cells[index].after(next);
    }
    focusAt(row.cells[left ? index : index + 1]);
  }
  if (action === 'columnDelete') {
    if (row.cells.length === 1) { showNotice('У таблиці має залишитися хоча б один стовпець.'); return; }
    for (const r of table.rows) r.cells[index].remove();
    focusAt(row.cells[Math.min(index, row.cells.length - 1)]);
  }
  if (action === 'delete') {
    const p = document.createElement('p'); p.append(document.createElement('br')); table.replaceWith(p); focusAt(p);
  }
  changed();
});

function closeContextMenu(restore = false) {
  const wasOpen = !contextMenu.hidden; contextMenu.hidden = true;
  if (wasOpen && restore) restoreSelection();
}
function showContextMenu(x, y) {
  rememberSelection(); updateToolbar();
  document.querySelector('#context-table').hidden = !currentCell();
  contextMenu.hidden = false;
  const width = contextMenu.offsetWidth; const height = contextMenu.offsetHeight;
  contextMenu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  contextMenu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
  contextMenu.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
}
editor.addEventListener('contextmenu', event => {
  event.preventDefault();
  if (busy) return;
  if (event.target.closest('.opaque')) { showNotice('Цей захищений блок зберігається без змін.'); return; }
  const cell = event.target.closest('td,th'); activeCell = cell;
  const range = document.caretRangeFromPoint(event.clientX, event.clientY);
  const existing = selectionRange();
  const inSelection = existing && !existing.collapsed && range && existing.isPointInRange(range.startContainer, range.startOffset);
  if (!inSelection && range && editor.contains(range.startContainer)) {
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }
  if (cell && !cell.contains(selectionRange()?.startContainer)) focusAt(cell);
  showContextMenu(event.clientX, event.clientY);
});
contextMenu.addEventListener('click', event => { if (event.target.closest('button:not(:disabled)')) closeContextMenu(); });
contextMenu.addEventListener('keydown', event => {
  event.stopPropagation();
  if (['Escape', 'Tab'].includes(event.key)) { event.preventDefault(); event.stopPropagation(); closeContextMenu(true); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  const items = [...contextMenu.querySelectorAll('button:not(:disabled)')].filter(item => !item.closest('[hidden]'));
  let index = items.indexOf(document.activeElement);
  if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = items.length - 1;
  else index = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[index]?.focus();
});
document.addEventListener('pointerdown', event => { if (!contextMenu.contains(event.target)) closeContextMenu(); });
window.addEventListener('scroll', () => closeContextMenu());
window.addEventListener('resize', () => closeContextMenu());

editor.addEventListener('input', event => { rememberSelection(); changed(['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(event.inputType) ? 'typing' : 'command'); });
editor.addEventListener('beforeinput', event => {
  history.before();
  if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') { event.preventDefault(); if (!busy) features.undo(event.inputType === 'historyRedo'); return; }
  if (busy || ['insertFromPaste', 'insertFromDrop', 'deleteByCut'].includes(event.inputType) || protectedSelection()) {
    event.preventDefault();
    if (protectedSelection()) showNotice('Захищений блок зберігається без змін.');
    return;
  }
  if (event.inputType === 'insertParagraph' && !event.isComposing && !currentCell()) {
    if (insertParagraph() !== false) event.preventDefault();
    return;
  }
  // Also protect a block directly adjacent to a collapsed deletion range.
  if (event.inputType.startsWith('delete')) {
    for (const target of event.getTargetRanges()) {
      const range = document.createRange(); range.setStart(target.startContainer, target.startOffset); range.setEnd(target.endContainer, target.endOffset);
      if (protectedSelection(range)) { event.preventDefault(); showNotice('Захищений блок не можна видалити.'); return; }
    }
  }
});
for (const name of ['drop', 'dragstart']) editor.addEventListener(name, event => event.preventDefault());
document.addEventListener('keydown', event => {
  if (event.target.matches('input,textarea,select') && event.target.id !== 'source-editor') return;
  if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && selectionRange() && !busy) {
    event.preventDefault(); const rect = selectionRange().getBoundingClientRect(); showContextMenu(rect.left, rect.bottom); return;
  }
  const modifier = event.ctrlKey || event.metaKey;
  if (modifier && !event.altKey && !tableDialog.open) {
    const key = event.code;
    const file = { KeyS: event.shiftKey ? 'saveAs' : 'save', KeyO: 'open', KeyN: 'new' }[key];
    if (file) { event.preventDefault(); if (!busy) document.querySelector(`[data-file="${file}"]`).click(); return; }
    if (event.target.id === 'source-editor') return;
    const formatting = { KeyB: 'bold', KeyI: 'italic', KeyX: event.shiftKey ? 'strikeThrough' : null }[key];
    if (formatting) { event.preventDefault(); command(formatting); return; }
  }
  if (busy || !selectionRange()) return;
  const cell = currentCell();
  if (event.key === 'Enter' && event.shiftKey && !cell && elementAtCursor()?.closest?.('h1,h2,h3,h4,h5,h6')) {
    event.preventDefault(); showNotice('Заголовок займає один рядок. Натисніть Enter, щоб створити наступний абзац.'); return;
  }
  if (cell && ['Tab', 'Enter'].includes(event.key)) {
    event.preventDefault();
    const table = cell.closest('table'); const cells = [...table.querySelectorAll('th,td')];
    const step = event.key === 'Enter' ? (event.shiftKey ? -cell.parentElement.cells.length : cell.parentElement.cells.length) : event.shiftKey ? -1 : 1;
    const target = cells.indexOf(cell) + step;
    if (target < 0) return;
    if (target >= cells.length) { const row = addRow(table); focusAt(row.cells[event.key === 'Enter' ? cell.cellIndex : 0]); changed(); }
    else focusAt(cells[target]);
  } else if (event.key === 'Tab' && elementAtCursor()?.closest?.('li')) { event.preventDefault(); features.indent(event.shiftKey); }
});

function load(markdown, name = 'Без назви') {
  if (new TextEncoder().encode(markdown).length > 5 * 1024 * 1024) throw new Error('Файл перевищує ліміт 5 MiB.');
  const info = model.load(markdown); savedRange = null; activeCell = null; closeContextMenu();
  features?.reset(); history.reset();
  document.querySelector('#file-name').textContent = name;
  document.querySelector('#header-document-state').textContent = name;
  showNotice(info.protectedBlocks ? `Захищених блоків: ${info.protectedBlocks}. Вони збережуться у Markdown без змін.` : '');
  changed('load', false); return info;
}
async function receive(message) {
  if (message.type === 'busy') {
    busy = Boolean(message.value); editor.contentEditable = String(!busy);
    if (busy) closeContextMenu();
    document.body.classList.toggle('busy', busy);
    document.querySelectorAll('[data-file], [data-table]').forEach(button => button.disabled = busy);
    updateToolbar(); return;
  }
  const response = { type: 'response', requestId: message.requestId };
  try {
    if (message.type === 'load') Object.assign(response, load(message.payload.markdown, message.payload.name));
    else if (message.type === 'export') response.markdown = features.getSource();
    else if (message.type === 'state') response.dirty = features.dirty;
    else if (message.type === 'saved') { features.applySource(); model.markSaved(); document.querySelector('#file-name').textContent = message.payload.name; changed('saved', false); }
    else if (message.type === 'awaitImages') {
      await Promise.race([Promise.allSettled([...document.querySelectorAll('#print-document img,#editor img')].filter(img => img.hasAttribute('src')).map(img => img.decode())), new Promise(resolve => setTimeout(resolve, 5000))]);
      await document.fonts.ready;
    }
    else if (features.receive(message, response)) { /* Feature-specific host requests. */ }
    else throw new Error('Невідома команда оболонки.');
  } catch (error) { response.error = error.message; showNotice(error.message, true); }
  post(response); return response;
}
window.chrome?.webview?.addEventListener('message', event => receive(event.data));
// The same editor can be embedded in another shell without WinForms dependencies.
features = installFeatures({ editor, model, history, post, changed, showNotice, selectionRange, elementAtCursor, protectedSelection, focusAt, rememberSelection, restoreSelection, currentCell, command, get busy() { return busy; } });
addToolbarIcons(document.querySelector('#table-tools'));
for (const button of document.querySelectorAll('#table-tools button')) button.addEventListener('pointerdown', event => event.preventDefault());
installViewPreferences({ editor });
window.markdownEditor = Object.freeze({ load, export: () => features.getSource(), get dirty() { return features.dirty; }, receive, features });
changed(); post({ type: 'ready' });
