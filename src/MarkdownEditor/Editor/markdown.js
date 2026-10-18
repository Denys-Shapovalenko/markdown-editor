import { marked } from './vendor/marked.js';

const inlineTypes = new Set(['text', 'escape', 'strong', 'em', 'del', 'br']);
const labels = { code: 'Код', blockquote: 'Цитата', html: 'HTML', hr: 'Розділювач', def: 'Визначення посилання', list: 'Складний список', paragraph: 'Абзац із непідтримуваною розміткою', table: 'Складна таблиця' };
export function inlineSupported(tokens = []) {
  return tokens.every(t => inlineTypes.has(t.type) && (!t.tokens || inlineSupported(t.tokens)));
}
export function blockSupported(token) {
  if (['paragraph', 'heading'].includes(token.type)) return inlineSupported(token.tokens);
  if (token.type === 'list') return token.items.every(item => !item.task && item.tokens.filter(t => t.type !== 'space').length === 1 && item.tokens.every(t => t.type === 'space' || (['text', 'paragraph'].includes(t.type) && inlineSupported(t.tokens))));
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

function renderInline(tokens, parent) {
  const document = parent.ownerDocument;
  for (const token of tokens ?? []) {
    if (token.type === 'text' || token.type === 'escape') parent.append(document.createTextNode(token.type === 'escape' ? token.text : decodeEntities(token.text, document)));
    else if (token.type === 'br') parent.append(document.createElement('br'));
    else {
      const element = document.createElement({ strong: 'strong', em: 'em', del: 's' }[token.type]);
      renderInline(token.tokens, element); parent.append(element);
    }
  }
}

export function renderBlock(token, document) {
  let block;
  if (token.type === 'paragraph' || token.type === 'heading') {
    block = document.createElement(token.type === 'heading' ? `h${token.depth}` : 'p');
    renderInline(token.tokens, block);
  } else if (token.type === 'list') {
    block = document.createElement(token.ordered ? 'ol' : 'ul');
    if (token.ordered && token.start !== 1) block.start = token.start;
    for (const item of token.items) {
      const li = document.createElement('li');
      renderInline(item.tokens.find(t => t.type !== 'space')?.tokens, li);
      if (!li.hasChildNodes()) li.append(document.createElement('br'));
      block.append(li);
    }
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
  if (block && !block.hasChildNodes()) block.append(document.createElement('br'));
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
    if (tag === 'BR') return children.length === 1 ? '' : cell ? ' ' : '  \n';
    const text = inlineMarkdown(node, cell);
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
  if (['UL', 'OL'].includes(tag)) {
    const start = Number(block.getAttribute('start')) || 1;
    return [...block.children].map((li, i) => {
      if (li.tagName !== 'LI' || li.querySelector('ul,ol')) throw new Error('Вкладені списки можна зберігати лише як захищені блоки.');
      const prefix = `${tag === 'OL' ? start + i + '.' : '-'} `;
      return prefix + inlineMarkdown(li).replace(/\n/g, '\n' + ' '.repeat(prefix.length));
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
        block.title = token.originalRaw ?? token.raw;
      }
      block.dataset.sourceId = id;
      records.set(id, { raw: token.originalRaw ?? token.raw, html: block.outerHTML, opaque: !token.supported });
      fragment.append(block);
    }
    // A trailing paragraph allows typing after a protected block or table.
    if (!fragment.lastChild || ['SECTION', 'TABLE'].includes(fragment.lastChild.tagName)) {
      const p = document.createElement('p'); p.append(document.createElement('br')); fragment.append(p);
    }
    this.editor.replaceChildren(fragment);
    this.records = records; this.source = source;
    this.newline = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n';
    this.baseline = this.editor.innerHTML;
    return { protectedBlocks: [...records.values()].filter(r => r.opaque).length };
  }
  get dirty() { return this.editor.innerHTML !== this.baseline; }
  markSaved() {
    this.source = this.export();
    this.baseline = this.editor.innerHTML;
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
      if (!block || block.outerHTML !== record.html) throw new Error('Захищений блок змінено або видалено. Збереження зупинено, щоб не втратити розмітку.');
    }
    if (!this.dirty) return this.source;
    let output = '';
    for (const block of this.editor.childNodes) {
      const record = this.records.get(block.dataset?.sourceId);
      const unchanged = record && block.outerHTML === record.html;
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
