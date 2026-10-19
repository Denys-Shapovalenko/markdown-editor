import { marked } from './vendor/marked.js';

const inlineTypes = new Set(['text', 'escape', 'strong', 'em', 'del', 'br', 'codespan', 'link', 'image']);
const labels = { code: 'Код', blockquote: 'Цитата', html: 'HTML', hr: 'Розділювач', def: 'Визначення посилання', list: 'Складний список', paragraph: 'Абзац із непідтримуваною розміткою', table: 'Складна таблиця' };
export function inlineSupported(tokens = []) {
  return tokens.every(t => inlineTypes.has(t.type) && (!['link', 'image'].includes(t.type) || safeUrl(t.href, t.type === 'image')) && (!t.tokens || inlineSupported(t.tokens)));
}
export function htmlOf(node, inner = false) {
  const clone = node.cloneNode(true);
  for (const selected of clone.querySelectorAll('.cell-selected')) { selected.classList.remove('cell-selected'); if (!selected.className) selected.removeAttribute('class'); }
  for (const img of clone.querySelectorAll('img[data-src]')) if (/^https?:/i.test(img.dataset.src)) img.removeAttribute('src');
  return inner ? clone.innerHTML : clone.outerHTML;
}
export function blockSupported(token) {
  if (['paragraph', 'heading', 'text'].includes(token.type)) return inlineSupported(token.tokens);
  if (['code', 'hr'].includes(token.type)) return true;
  if (token.type === 'blockquote') return token.tokens.every(t => t.type === 'space' || blockSupported(t));
  if (token.type === 'list') return token.items.every(item => item.tokens.every(t => ['space', 'checkbox'].includes(t.type) || blockSupported(t)));
  if (token.type === 'table') return [...token.header, ...token.rows.flat()].every(c => inlineSupported(c.tokens));
  return false;
}

export function tokenize(source) {
  const normalized = source.replace(/\r\n?/g, '\n');
  const tokens = marked.lexer(normalized, { gfm: true });
  // Refuse partial interpretation if a lexer ever skips or normalizes source characters.
  if (tokens.map(t => t.raw).join('') !== normalized) return [{ type: 'unknown', raw: source, supported: false }];
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\r' && source[i + 1] === '\n') i++;
    offsets.push(i + 1);
  }
  let cursor = 0;
  return tokens.map(token => {
    const start = cursor;
    cursor += token.raw.length;
    return { ...token, originalRaw: source.slice(offsets[start], offsets[cursor]), supported: blockSupported(token) };
  });
}

function decodeEntities(text, document) {
  const decoder = document.createElement('textarea');
  // Only character references go through HTML parsing; arbitrary text is never interpreted as HTML.
  return text.replace(/&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]+);/gi, entity => { decoder.innerHTML = entity; return decoder.value; });
}

export function safeUrl(value, image = false) {
  const url = String(value ?? '').trim();
  if (!url || /[\u0000-\u0020\u007f]/.test(url) || url.startsWith('//') || url.startsWith('\\')) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(url) && !(image ? /^https?:/i : /^(https?:|mailto:|tel:)/i).test(url)) return null;
  return url;
}

export function renderInline(tokens, parent) {
  const document = parent.ownerDocument;
  for (const token of tokens ?? []) {
    if (token.type === 'text' || token.type === 'escape') parent.append(document.createTextNode(token.type === 'escape' ? token.text : decodeEntities(token.text, document)));
    else if (token.type === 'br') parent.append(document.createElement('br'));
    else if (token.type === 'codespan') { const code = document.createElement('code'); code.textContent = token.text; parent.append(code); }
    else if (token.type === 'link') {
      const a = document.createElement('a'); a.setAttribute('href', safeUrl(token.href) ?? '#');
      if (token.title) a.title = token.title;
      renderInline(token.tokens, a); parent.append(a);
    } else if (token.type === 'image') {
      const img = document.createElement('img'); img.alt = token.text ?? ''; if (token.title) img.title = token.title;
      const url = safeUrl(token.href, true);
      if (url) { img.dataset.src = url; if (!/^https?:/i.test(url)) img.src = url; }
      parent.append(img);
    }
    else {
      const element = document.createElement({ strong: 'strong', em: 'em', del: 's' }[token.type]);
      renderInline(token.tokens, element); parent.append(element);
    }
  }
}

export function renderBlock(token, document) {
  let block;
  if (['paragraph', 'heading', 'text'].includes(token.type)) {
    block = document.createElement(token.type === 'heading' ? `h${token.depth}` : 'p');
    renderInline(token.tokens, block);
  } else if (token.type === 'list') {
    block = document.createElement(token.ordered ? 'ol' : 'ul');
    if (token.ordered && token.start !== 1) block.start = token.start;
    for (const item of token.items) {
      const li = document.createElement('li');
      if (item.task) {
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.contentEditable = 'false';
        checkbox.setAttribute('aria-label', 'Пункт виконано');
        if (item.checked) checkbox.setAttribute('checked', '');
        li.append(checkbox);
      }
      for (const child of item.tokens.filter(t => !['space', 'checkbox'].includes(t.type))) {
        if (child.type === 'text') renderInline(child.tokens, li);
        else li.append(renderBlock(child, document));
      }
      if (!li.hasChildNodes()) li.append(document.createElement('br'));
      block.append(li);
    }
  } else if (token.type === 'code') {
    block = document.createElement('pre'); const code = document.createElement('code');
    code.textContent = token.text; if (token.lang) code.dataset.language = token.lang; block.append(code);
  } else if (token.type === 'hr') block = document.createElement('hr');
  else if (token.type === 'blockquote') {
    block = document.createElement('blockquote');
    for (const child of token.tokens.filter(t => t.type !== 'space')) block.append(renderBlock(child, document));
  } else if (token.type === 'table') {
    block = document.createElement('table');
    const head = block.createTHead().insertRow();
    const body = block.createTBody();
    function addCells(row, cells, heading) {
      cells.forEach((cell, i) => {
        const element = document.createElement(heading ? 'th' : 'td');
        if (token.align[i]) element.style.textAlign = token.align[i];
        renderInline(cell.tokens, element);
        if (!element.hasChildNodes()) element.append(document.createElement('br'));
        row.append(element);
      });
    }
    addCells(head, token.header, true);
    token.rows.forEach(row => addCells(body.insertRow(), row, false));
  }
  if (block && block.tagName !== 'HR' && !block.hasChildNodes()) block.append(document.createElement('br'));
  return block;
}

export function escapeText(text) {
  return text.replace(/\u00a0/g, ' ').replace(/&/g, '&amp;').replace(/[\\`*{}\[\]()#+\-.!_><|~]/g, '\\$&');
}

function wrap(text, marker) {
  if (!text.trim()) return text;
  const [, before, content, after] = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  return before + marker + content + marker + after;
}

export function inlineMarkdown(parent, cell = false) {
  const children = [...parent.childNodes];
  return children.map(node => {
    if (node.nodeType === 3) return escapeText(node.data);
    if (node.nodeType !== 1) return '';
    const tag = node.tagName;
    if (tag === 'INPUT' && node.type === 'checkbox') return '';
    if (tag === 'CODE') {
      const value = node.textContent.replace(/\n/g, ' '); const runs = value.match(/`+/g) ?? [];
      const fence = '`'.repeat(Math.max(0, ...runs.map(s => s.length)) + 1);
      const pad = value.startsWith('`') || value.endsWith('`') || (/^ .* $/.test(value) && value.trim()) ? ' ' : '';
      return fence + pad + value + pad + fence;
    }
    if (tag === 'IMG') {
      const url = safeUrl(node.dataset.src ?? node.getAttribute('src'), true);
      if (!url) throw new Error('Некоректний шлях зображення.');
      return '![' + escapeText(node.alt) + '](<' + url.replace(/[<>]/g, c => encodeURIComponent(c)) + '>' + (node.title ? ' "' + node.title.replace(/["\\]/g, '\\$&') + '"' : '') + ')';
    }
    if (tag === 'BR') return children.length === 1 ? '' : cell ? ' ' : '  \n';
    const text = inlineMarkdown(node, cell);
    if (tag === 'A') {
      const url = safeUrl(node.getAttribute('href'));
      if (!url) throw new Error('Некоректна адреса посилання.');
      return '[' + text + '](<' + url.replace(/[<>]/g, c => encodeURIComponent(c)) + '>' + (node.title ? ' "' + node.title.replace(/["\\]/g, '\\$&') + '"' : '') + ')';
    }
    if (['B', 'STRONG'].includes(tag)) return wrap(text, '**');
    if (['I', 'EM'].includes(tag)) return wrap(text, '*');
    if (['S', 'STRIKE', 'DEL'].includes(tag)) return wrap(text, '~~');
    if (tag === 'SPAN') {
      let value = text;
      if (node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600) value = wrap(value, '**');
      if (node.style.fontStyle === 'italic') value = wrap(value, '*');
      if (node.style.textDecorationLine.includes('line-through')) value = wrap(value, '~~');
      return value;
    }
    if (['P', 'DIV'].includes(tag)) return text + (cell ? ' ' : '\n');
    throw new Error(`Не можна безпечно зберегти елемент ${tag}. Документ не записано.`);
  }).join('');
}

export function blockMarkdown(block) {
  if (block.nodeType === 3) return escapeText(block.data);
  const tag = block.tagName;
  if (/^H[1-6]$/.test(tag)) return '#'.repeat(Number(tag[1])) + ' ' + inlineMarkdown(block);
  if (['P', 'DIV'].includes(tag)) return inlineMarkdown(block);
  if (tag === 'HR') return '---';
  if (tag === 'PRE') {
    const code = block.querySelector('code') ?? block;
    const value = code.textContent.replace(/\r\n?/g, '\n');
    const fence = '`'.repeat(Math.max(2, ...(value.match(/`+/g) ?? []).map(s => s.length)) + 1);
    return fence + (code.dataset.language ?? '').replace(/[\r\n`]/g, '') + '\n' + value + (value.endsWith('\n') ? '' : '\n') + fence;
  }
  if (tag === 'BLOCKQUOTE') return [...block.children].map(b => blockMarkdown(b)).join('\n\n').split('\n').map(line => '> ' + line).join('\n');
  if (['UL', 'OL'].includes(tag)) {
    const start = Number(block.getAttribute('start')) || 1;
    return [...block.children].map((li, i) => {
      if (li.tagName !== 'LI') throw new Error('Некоректний пункт списку.');
      const prefix = `${tag === 'OL' ? start + i + '.' : '-'} `;
      const clone = li.cloneNode(true); const checkbox = clone.querySelector(':scope > input[type=checkbox]');
      const task = checkbox ? (checkbox.hasAttribute('checked') ? '[x] ' : '[ ] ') : ''; checkbox?.remove();
      const parts = []; let inline = clone.ownerDocument.createElement('span');
      const flush = () => { if (inline.hasChildNodes()) { parts.push(inlineMarkdown(inline)); inline = clone.ownerDocument.createElement('span'); } };
      for (const child of [...clone.childNodes]) {
        if (['UL', 'OL', 'P', 'DIV', 'PRE', 'BLOCKQUOTE', 'HR'].includes(child.tagName)) { flush(); parts.push(blockMarkdown(child)); }
        else inline.append(child);
      }
      flush();
      return prefix + (task + parts.join('\n\n')).replace(/\n/g, '\n' + ' '.repeat(prefix.length));
    }).join('\n');
  }
  if (tag === 'TABLE') {
    const rows = [...block.rows];
    if (!rows.length || !rows[0].cells.length) throw new Error('Таблиця не має заголовка.');
    const width = rows[0].cells.length;
    if (rows.some(row => row.cells.length !== width)) throw new Error('Таблиця має різну кількість клітинок у рядках.');
    const row = r => '| ' + [...r.cells].map(c => inlineMarkdown(c, true).replace(/\n/g, ' ').trim()).join(' | ') + ' |';
    const alignment = '| ' + [...rows[0].cells].map(c => ({ left: ':---', center: ':---:', right: '---:' }[c.style.textAlign] ?? '---')).join(' | ') + ' |';
    return [row(rows[0]), alignment, ...rows.slice(1).map(row)].join('\n');
  }
  if (tag === 'BR') return '';
  throw new Error(`Непідтримувана структура ${tag}. Документ не записано.`);
}

export class MarkdownDocument {
  constructor(editor) { this.editor = editor; this.records = new Map(); this.load(''); }
  load(source) {
    const document = this.editor.ownerDocument;
    const fragment = document.createDocumentFragment();
    const records = new Map();
    let counter = 0;
    for (const token of tokenize(source)) {
      if (token.type === 'space') continue;
      const id = `b${++counter}`;
      let block;
      if (token.supported) block = renderBlock(token, document);
      else {
        block = document.createElement('section');
        block.className = 'opaque'; block.contentEditable = 'false';
        block.setAttribute('aria-label', 'Захищена Markdown-розмітка');
        const badge = document.createElement('span'); badge.className = 'opaque-icon'; badge.textContent = '◇';
        const label = document.createElement('span');
        const name = document.createElement('strong'); name.textContent = labels[token.type] ?? 'Непідтримувана розмітка';
        const detail = document.createElement('small'); detail.textContent = 'Захищений блок · збережеться без змін';
        label.append(name, detail); block.append(badge, label);
        block.title = (token.originalRaw ?? token.raw).replace(/\r\n?/g, '\n');
      }
      block.dataset.sourceId = id;
      records.set(id, { raw: token.originalRaw ?? token.raw, html: htmlOf(block), opaque: !token.supported });
      fragment.append(block);
    }
    // A trailing paragraph allows typing after a protected block or table.
    if (!fragment.lastChild || ['SECTION', 'TABLE'].includes(fragment.lastChild.tagName)) {
      const p = document.createElement('p'); p.append(document.createElement('br')); fragment.append(p);
    }
    this.editor.replaceChildren(fragment);
    this.records = records; this.source = source; this.savedSource = source;
    this.newline = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n';
    this.baseline = htmlOf(this.editor, true);
    return { protectedBlocks: [...records.values()].filter(r => r.opaque).length };
  }
  get dirty() { try { return this.export() !== this.savedSource; } catch { return true; } }
  snapshot() { return { html: htmlOf(this.editor, true), records: [...this.records], source: this.source, newline: this.newline, baseline: this.baseline }; }
  restore(state) {
    this.editor.innerHTML = state.html; this.records = new Map(state.records); this.source = state.source; this.newline = state.newline; this.baseline = state.baseline;
  }
  replaceSource(source) { const saved = this.savedSource; const info = this.load(source); this.savedSource = saved; return info; }
  markSaved() {
    this.source = this.export();
    this.savedSource = this.source;
    this.baseline = htmlOf(this.editor, true);
  }
  export() {
    const seen = new Set();
    for (const block of this.editor.querySelectorAll('[data-source-id]')) {
      const id = block.dataset.sourceId;
      if (seen.has(id) && this.records.get(id)?.opaque) throw new Error('Захищений блок продубльовано. Збереження зупинено.');
      seen.add(id);
    }
    for (const [id, record] of this.records) {
      if (!record.opaque) continue;
      const block = [...this.editor.children].find(b => b.dataset.sourceId === id);
      if (!block || htmlOf(block) !== record.html) throw new Error('Захищений блок змінено або видалено. Збереження зупинено, щоб не втратити розмітку.');
    }
    if (htmlOf(this.editor, true) === this.baseline) return this.source;
    let output = '';
    for (const block of this.editor.childNodes) {
      const record = this.records.get(block.dataset?.sourceId);
      const unchanged = record && htmlOf(block) === record.html;
      const text = unchanged ? record.raw : blockMarkdown(block).replace(/\r\n?/g, '\n').replace(/\n/g, this.newline);
      if (!text) continue;
      if (output) {
        const normalized = output.replace(/\r\n?/g, '\n');
        if (!normalized.endsWith('\n')) output += this.newline + this.newline;
        else if (!normalized.endsWith('\n\n')) output += this.newline;
      }
      output += text;
    }
    if (output && !/[\r\n]$/.test(output)) output += this.newline;
    return output;
  }
}
