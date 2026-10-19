export function installTableFeatures(ctx, mutate) {
  const { editor, focusAt, currentCell, showNotice } = ctx;
  let anchor = null; let selected = new Set();
  const tools = document.querySelector('#table-tools');
  const labels = {
    selectRow: ['Виділити рядок', 'Виділити весь поточний рядок'], selectColumn: ['Виділити стовпець', 'Виділити весь поточний стовпець'],
    rowUp: ['Рядки ↑', 'Перемістити вибрані рядки вгору'], rowDown: ['Рядки ↓', 'Перемістити вибрані рядки вниз'],
    columnLeft: ['Стовпці ←', 'Перемістити вибрані стовпці ліворуч'], columnRight: ['Стовпці →', 'Перемістити вибрані стовпці праворуч'],
    alignLeft: ['Ліворуч', 'Вирівняти вибрані стовпці ліворуч'], alignCenter: ['По центру', 'Вирівняти вибрані стовпці по центру'], alignRight: ['Праворуч', 'Вирівняти вибрані стовпці праворуч']
  };
  for (const [action, [label, tooltip]] of Object.entries(labels)) {
    const button = document.createElement('button'); button.className = 'icon-only'; button.dataset.tableV2 = action; button.textContent = label; button.title = tooltip; button.setAttribute('aria-label', label); button.disabled = true;
    button.onpointerdown = event => event.preventDefault(); button.onclick = () => run(action); tools.insertBefore(button, document.querySelector('#table-hint'));
  }
  function clear() { for (const cell of selected) { cell.classList.remove('cell-selected'); if (!cell.className) cell.removeAttribute('class'); } selected = new Set(); }
  function select(cells) { clear(); selected = new Set(cells); for (const cell of selected) cell.classList.add('cell-selected'); update(); }
  editor.addEventListener('pointerdown', event => {
    const cell = event.target.closest('td,th'); if (!cell) { clear(); anchor = null; return; }
    if (event.shiftKey && anchor?.isConnected && anchor.closest('table') === cell.closest('table')) {
      event.preventDefault(); const table = cell.closest('table');
      const r0 = Math.min(anchor.parentElement.rowIndex, cell.parentElement.rowIndex), r1 = Math.max(anchor.parentElement.rowIndex, cell.parentElement.rowIndex);
      const c0 = Math.min(anchor.cellIndex, cell.cellIndex), c1 = Math.max(anchor.cellIndex, cell.cellIndex);
      select([...table.rows].slice(r0, r1 + 1).flatMap(row => [...row.cells].slice(c0, c1 + 1)));
    } else { clear(); anchor = cell; }
  });
  function cellsFor(table, cell) { const live = [...selected].filter(c => c.isConnected && c.closest('table') === table); return live.length ? live : [cell]; }
  function run(action) {
    const cell = currentCell(); if (!cell || ctx.busy) return;
    const table = cell.closest('table'); const chosen = cellsFor(table, cell);
    if (action === 'selectRow') { select(chosen.flatMap(c => [...c.parentElement.cells])); return; }
    if (action === 'selectColumn') { const indices = new Set(chosen.map(c => c.cellIndex)); select([...table.rows].flatMap(r => [...r.cells].filter(c => indices.has(c.cellIndex)))); return; }
    mutate(() => {
      if (action.startsWith('align')) {
        const align = { alignLeft: 'left', alignCenter: 'center', alignRight: 'right' }[action]; const columns = new Set(chosen.map(c => c.cellIndex));
        for (const row of table.rows) for (const c of row.cells) if (columns.has(c.cellIndex)) c.style.textAlign = align;
      } else if (action === 'rowUp' || action === 'rowDown') {
        const rows = [...new Set(chosen.map(c => c.parentElement))].sort((a, b) => a.rowIndex - b.rowIndex);
        if (rows.some(row => row.rowIndex === 0)) { showNotice('Заголовок таблиці залишається верхнім рядком.'); return; }
        if (action === 'rowUp') { const before = rows[0].previousElementSibling; if (before) for (const row of rows) before.before(row); }
        else { const after = rows.at(-1).nextElementSibling; if (after) for (const row of [...rows].reverse()) after.after(row); }
      } else if (action === 'columnLeft' || action === 'columnRight') {
        const indices = [...new Set(chosen.map(c => c.cellIndex))].sort((a, b) => a - b);
        const pivot = action === 'columnLeft' ? indices[0] - 1 : indices.at(-1) + 1;
        if (pivot < 0 || pivot >= table.rows[0].cells.length) return;
        for (const row of table.rows) {
          const cells = [...row.cells]; const reference = cells[pivot];
          if (action === 'columnLeft') for (const i of indices) reference.before(cells[i]);
          else for (const i of [...indices].reverse()) reference.after(cells[i]);
        }
      }
      focusAt(cell); select(chosen);
    });
  }
  for (const button of document.querySelectorAll('#menu-bar [data-table-v2]')) {
    button.onpointerdown = event => event.preventDefault();
    button.onclick = () => run(button.dataset.tableV2);
  }
  // Capture bulk deletion before the original single-cell toolbar/context-menu handler.
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-table]'); if (!button || selected.size < 2) return;
    const action = button.dataset.table; if (!['rowDelete', 'columnDelete'].includes(action)) return;
    const cell = currentCell(); if (!cell || ctx.busy) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const table = cell.closest('table'); const chosen = cellsFor(table, cell);
    mutate(() => {
      if (action === 'rowDelete') {
        const alignment = [...table.rows[0].cells].map(c => c.style.textAlign);
        const rows = new Set(chosen.map(c => c.parentElement)); for (const row of rows) row.remove(); clear();
        if (!table.rows.length) { const p = document.createElement('p'); p.append(document.createElement('br')); table.replaceWith(p); focusAt(p); return; }
        const first = table.rows[0];
        if (first.parentElement.tagName !== 'THEAD') {
          const heading = table.tHead ?? table.createTHead(); heading.append(first);
          [...first.cells].forEach((c, i) => { const th = document.createElement('th'); th.style.textAlign = alignment[i]; th.append(...c.childNodes); c.replaceWith(th); });
        }
      } else {
        const indices = [...new Set(chosen.map(c => c.cellIndex))].sort((a, b) => b - a);
        if (indices.length === table.rows[0].cells.length) { showNotice('Залиште хоча б один стовпець або видаліть усю таблицю.'); return; }
        clear(); for (const row of table.rows) for (const index of indices) row.cells[index].remove();
      }
      focusAt(table.rows[0].cells[0]);
    });
  }, true);
  function update() {
    selected = new Set([...selected].filter(c => c.isConnected));
    const inTable = Boolean(currentCell());
    tools.classList.toggle('table-active', inTable);
    tools.querySelectorAll('button').forEach(b => b.disabled = ctx.busy || !inTable);
    document.querySelectorAll('#menu-bar [data-table-v2]').forEach(b => b.disabled = ctx.busy || !inTable);
  }
  function reset() { clear(); anchor = null; }
  return { run, select, reset, update };
}
