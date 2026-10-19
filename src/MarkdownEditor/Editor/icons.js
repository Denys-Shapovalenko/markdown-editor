const paths = {
  undo: ['M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12'],
  redo: ['m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12'],
  copy: ['M9 8h12v14H9zM4 16H2V2h12v3'],
  cut: ['m7 8 12 13M7 16 19 3M6 6a3 3 0 1 0 0 .1M6 18a3 3 0 1 0 0 .1'],
  paste: ['M9 4H5v18h15V4h-4M9 2h7v5H9zM9 12h7M9 16h7'],
  bold: ['M7 4h6a4 4 0 0 1 0 8H7z', 'M7 12h7a4 4 0 0 1 0 8H7z'],
  italic: ['M11 4h8M5 20h8M15 4 9 20'],
  strikeThrough: ['M17 6c-2-3-10-3-10 1 0 2 2 3 5 4', 'M7 18c2 3 10 3 10-1 0-1-1-2-2-2', 'M3 12h18'],
  insertUnorderedList: ['M9 6h12M9 12h12M9 18h12', 'M3 6h1M3 12h1M3 18h1'],
  insertOrderedList: ['M10 6h11M10 12h11M10 18h11', 'M3 3h1v5M3 8h3', 'M3 12c3-2 4 1 1 3l-1 2h3'],
  new: ['M12 5v14M5 12h14'],
  open: ['M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3z', 'M3 11h18'],
  save: ['M5 3h12l4 4v14H3V3z', 'M7 3v6h10V3M7 21v-8h10v8'],
  saveAs: ['M5 3h12l4 4v14H3V3z', 'M7 3v6h10V3M7 21v-8h10', 'M18 2v5M15.5 4.5h5'],
  find: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'm17 17 4 4'],
  outline: ['M9 5h12M9 12h12M9 19h12', 'M3 5h1M3 12h1M3 19h1'],
  source: ['M4 4h16v16H4z', 'm9 9-3 3 3 3M15 9l3 3-3 3'],
  blockSource: ['M5 3h14v18H5z', 'M8 8h8M8 12h5M8 16h8'],
  link: ['M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7', 'M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21.1l1.7-1.7'],
  image: ['M3 4h18v16H3z', 'm3 16 5-5 4 4 3-3 6 6', 'M15 9h.01'],
  task: ['M4 5h6v6H4zM14 8h6M4 16h6v5H4zM14 18h6', 'm5.5 8 1.5 1.5L10 6'],
  indent: ['M10 5h11M10 12h11M10 19h11', 'm3 8 4 4-4 4'],
  outdent: ['M10 5h11M10 12h11M10 19h11', 'M3 8h4M7 8v8M3 16h4'],
  inlineCode: ['M8 8 4 12l4 4M16 8l4 4-4 4M14 5l-4 14'],
  code: ['M3 4h18v16H3z', 'm9 9-3 3 3 3M15 9l3 3-3 3'],
  quote: ['M10 11H5a2 2 0 0 0-2 2v4h7v-6a7 7 0 0 0-2-5', 'M21 11h-5a2 2 0 0 0-2 2v4h7v-6a7 7 0 0 0-2-5'],
  rule: ['M3 12h18'],
  print: ['M6 9V3h12v6M6 17H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2', 'M6 14h12v7H6z', 'M18 12h.01'],
  pdf: ['M6 2h9l5 5v15H6z', 'M14 2v6h6M8 17h2a1.5 1.5 0 0 0 0-3H8v6M14 20v-6h1a3 3 0 0 1 0 6z'],
  html: ['M5 3h14v18H5z', 'm9 9-3 3 3 3M15 9l3 3-3 3'],
  recovery: ['M3 12a9 9 0 1 0 2.6-6.4L3 8', 'M3 3v5h5', 'M12 7v5l3 2'],
  reload: ['M20 7v5h-5M4 17v-5h5', 'M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3'],
  table: ['M3 4h18v16H3zM3 10h18M9 4v16M15 4v16'],
  rowAdd: ['M3 3h18v11H3zM3 8h18M9 3v11', 'M12 17v6M9 20h6'],
  rowDelete: ['M3 3h18v11H3zM3 8h18M9 3v11', 'M9 20h6'],
  columnAddLeft: ['M9 3h12v18H9zM15 3v18M9 9h12', 'M1 12h6M4 9v6'],
  columnAdd: ['M3 3h12v18H3zM9 3v18M3 9h12', 'M17 12h6M20 9v6'],
  columnDelete: ['M3 3h12v18H3zM9 3v18M3 9h12', 'M17 12h6'],
  delete: ['M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6'],
  selectRow: ['M3 5h18v5H3zM3 13h18v5H3z', 'M1 3v18'],
  selectColumn: ['M5 3h5v18H5zM13 3h5v18h-5z', 'M3 1v22'],
  rowUp: ['M4 15h16v6H4zM4 8h16', 'm12 11-4-4 4-4M8 7h8'],
  rowDown: ['M4 3h16v6H4zM4 16h16', 'm12 13 4 4-4 4M16 17H8'],
  columnLeft: ['M14 4h6v16h-6zM8 4v16', 'm11 12-4-4-4 4M7 8v8'],
  columnRight: ['M4 4h6v16H4zM16 4v16', 'm13 12 4 4 4-4M17 16V8'],
  alignLeft: ['M4 5h16M4 10h10M4 15h16M4 20h10'],
  alignCenter: ['M4 5h16M7 10h10M4 15h16M7 20h10'],
  alignRight: ['M4 5h16M10 10h10M4 15h16M10 20h10']
};

function iconKey(button) {
  if (button.dataset.menuTrigger === 'insert-table' || button.id === 'insert-table') return 'table';
  const key = button.dataset.command ?? button.dataset.table ?? button.dataset.tableV2 ?? button.dataset.v2 ?? button.dataset.file ?? button.dataset.icon;
  return key === 'pasteMarkdown' ? 'paste' : key;
}

function makeIcon(document, className) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false'); icon.classList.add(className);
  return icon;
}

function draw(document, icon, key) {
  for (const data of paths[key] ?? []) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', data); icon.append(path);
  }
}

export function addMenuIcons(menu) {
  const document = menu.ownerDocument;
  for (const button of menu.querySelectorAll('button')) {
    if (button.querySelector('.menu-icon')) continue;
    const key = iconKey(button); if (!paths[key]) continue;
    const icon = makeIcon(document, 'menu-icon'); draw(document, icon, key);
    const label = document.createElement('span'); label.className = 'menu-label';
    for (const node of [...button.childNodes]) if (node.nodeName !== 'KBD') label.append(node);
    button.prepend(icon, label);
  }
}

export function addToolbarIcons(toolbar) {
  const document = toolbar.ownerDocument;
  for (const button of toolbar.querySelectorAll('button')) {
    if (button.querySelector('.toolbar-icon')) continue;
    const key = iconKey(button); if (!paths[key]) continue;
    const icon = makeIcon(document, 'toolbar-icon'); draw(document, icon, key);
    if (button.classList.contains('icon-only')) button.replaceChildren(icon);
    else button.prepend(icon);
  }
}
