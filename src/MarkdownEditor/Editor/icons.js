const paths = {
  bold: ['M7 4h6a4 4 0 0 1 0 8H7z', 'M7 12h7a4 4 0 0 1 0 8H7z'],
  italic: ['M11 4h8M5 20h8M15 4 9 20'],
  strikeThrough: ['M17 6c-2-3-10-3-10 1 0 2 2 3 5 4', 'M7 18c2 3 10 3 10-1 0-1-1-2-2-2', 'M3 12h18'],
  insertUnorderedList: ['M9 6h12M9 12h12M9 18h12', 'M3 6h1M3 12h1M3 18h1'],
  insertOrderedList: ['M10 6h11M10 12h11M10 18h11', 'M3 3h1v5M3 8h3', 'M3 12c3-2 4 1 1 3l-1 2h3'],
  rowAdd: ['M3 3h18v11H3zM3 8h18M9 3v11', 'M12 17v6M9 20h6'],
  rowDelete: ['M3 3h18v11H3zM3 8h18M9 3v11', 'M9 20h6'],
  columnAddLeft: ['M9 3h12v18H9zM15 3v18M9 9h12', 'M1 12h6M4 9v6'],
  columnAdd: ['M3 3h12v18H3zM9 3v18M3 9h12', 'M17 12h6M20 9v6'],
  columnDelete: ['M3 3h12v18H3zM9 3v18M3 9h12', 'M17 12h6'],
  delete: ['M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6']
};

export function addMenuIcons(menu) {
  const document = menu.ownerDocument;
  for (const button of menu.querySelectorAll('button')) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
    icon.classList.add('menu-icon');
    for (const data of paths[button.dataset.command ?? button.dataset.table] ?? []) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', data); icon.append(path);
    }
    const label = document.createElement('span'); label.className = 'menu-label';
    for (const node of [...button.childNodes]) if (node.nodeName !== 'KBD') label.append(node);
    button.prepend(icon, label);
  }
}
