// History owns document snapshots, including raw protected records, and DOM-relative selections.
export function bookmark(root) {
  const selection = root.ownerDocument.getSelection();
  if (!selection.rangeCount || !root.contains(selection.anchorNode) || !root.contains(selection.focusNode)) return null;
  function point(node, offset) {
    const path = [];
    while (node !== root) { path.unshift([...node.parentNode.childNodes].indexOf(node)); node = node.parentNode; }
    return { path, offset };
  }
  return { anchor: point(selection.anchorNode, selection.anchorOffset), focus: point(selection.focusNode, selection.focusOffset) };
}
export function selectBookmark(root, mark) {
  root.focus({ preventScroll: true });
  if (!mark) return;
  function point(p) {
    let node = root;
    for (const index of p.path) { if (!node.childNodes[index]) return [root, 0]; node = node.childNodes[index]; }
    return [node, Math.min(p.offset, node.nodeType === 3 ? node.length : node.childNodes.length)];
  }
  root.ownerDocument.getSelection().setBaseAndExtent(...point(mark.anchor), ...point(mark.focus));
}
export class History {
  constructor(capture, restore) { this.capture = capture; this.restore = restore; this.reset(); }
  reset() { this.past = []; this.future = []; this.present = this.capture(); this.kind = null; this.time = 0; }
  before() {
    const state = this.capture();
    if (state.document.html === this.present.document.html) this.present.selection = state.selection;
  }
  commit(kind = 'command') {
    const next = this.capture();
    if (next.document.html === this.present.document.html && next.document.source === this.present.document.source) return;
    const now = performance.now();
    const grouping = kind === 'typing' && this.kind === kind && now - this.time < 650;
    if (!grouping) this.past.push(this.present);
    this.present = next; this.future = []; this.kind = kind; this.time = now;
    let bytes = this.past.reduce((n, s) => n + s.document.html.length * 2 + s.document.source.length * 2, 0);
    while (this.past.length > 100 || (bytes > 40 * 1024 * 1024 && this.past.length > 1)) {
      const old = this.past.shift(); bytes -= old.document.html.length * 2 + old.document.source.length * 2;
    }
  }
  move(redo = false) {
    const from = redo ? this.future : this.past; const to = redo ? this.past : this.future;
    if (!from.length) return false;
    this.before(); to.push(this.present); this.present = from.pop(); this.kind = null;
    this.restore(this.present); return true;
  }
  breakGroup() { this.kind = null; }
}
