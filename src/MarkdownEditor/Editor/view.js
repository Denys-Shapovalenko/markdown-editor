const STORAGE_KEY = 'markdown-editor.view-preferences.v1';
const FONT_SIZES = [14, 16, 18, 20, 22, 24];

function readPreferences() {
  const defaults = { theme: 'light', fontSize: 16, pageLayout: true, focus: false, typewriter: false };
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return {
      theme: value?.theme === 'dark' ? 'dark' : 'light',
      fontSize: FONT_SIZES.includes(value?.fontSize) ? value.fontSize : 16,
      pageLayout: value?.pageLayout !== false,
      focus: value?.focus === true,
      typewriter: value?.typewriter === true
    };
  } catch { return defaults; }
}

export function installViewPreferences({ editor }) {
  const preferences = readPreferences();
  const root = document.documentElement;
  const buttons = Object.fromEntries([...document.querySelectorAll('[data-view]')].map(button => [button.dataset.view, button]));
  const layoutButtons = [...document.querySelectorAll('[data-view-layout]')];
  let scrollFrame = 0;

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Preferences are optional when storage is unavailable. */ }
  }
  function activeBlock() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return null;
    let node = selection.anchorNode.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode.parentElement;
    while (node && node.parentElement !== editor) node = node.parentElement;
    return node?.parentElement === editor ? node : null;
  }
  function updateActiveBlock() {
    const current = activeBlock();
    for (const block of editor.children) block.classList.toggle('active-block', block === current);
    return current;
  }
  function sync() {
    root.dataset.theme = preferences.theme;
    root.style.setProperty('--editor-font-size', `${preferences.fontSize}px`);
    document.body.classList.toggle('full-width', !preferences.pageLayout);
    document.body.classList.toggle('focus-mode', preferences.focus);
    document.body.classList.toggle('typewriter-mode', preferences.typewriter);
    const themeLabel = preferences.theme === 'dark' ? 'Світла тема' : 'Темна тема';
    buttons.theme.querySelector('.menu-label').textContent = themeLabel;
    buttons.theme.setAttribute('aria-label', themeLabel);
    for (const [key, pressed] of [['focus', preferences.focus], ['typewriter', preferences.typewriter]])
      buttons[key].setAttribute('aria-pressed', String(pressed));
    for (const button of layoutButtons) button.setAttribute('aria-pressed', String((button.dataset.viewLayout === 'page') === preferences.pageLayout));
    updateActiveBlock();
  }
  function centerCaret() {
    if (!preferences.typewriter || document.activeElement !== editor || scrollFrame) return;
    if (!updateActiveBlock()) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!preferences.typewriter || document.activeElement !== editor) return;
      const selection = window.getSelection();
      if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
      const range = selection.getRangeAt(0);
      const caret = range.getBoundingClientRect();
      const block = activeBlock();
      if (!block) return;
      const blockRect = block.getBoundingClientRect();
      const caretY = caret.height || caret.top ? caret.top + caret.height / 2 : blockRect.top;
      const toolbarBottom = document.querySelector('.toolbar')?.getBoundingClientRect().bottom ?? 0;
      const footerTop = document.querySelector('footer')?.getBoundingClientRect().top ?? window.innerHeight;
      const targetY = (toolbarBottom + footerTop) / 2;
      const offset = caretY - targetY;
      if (Math.abs(offset) > 1) window.scrollBy(0, offset);
    });
  }
  function change(update) { update(); sync(); save(); }
  function changeFontSize(direction) {
    const current = FONT_SIZES.indexOf(preferences.fontSize);
    const next = Math.max(0, Math.min(FONT_SIZES.length - 1, current + direction));
    if (next !== current) change(() => { preferences.fontSize = FONT_SIZES[next]; });
  }

  buttons.theme.addEventListener('click', () => change(() => { preferences.theme = preferences.theme === 'dark' ? 'light' : 'dark'; }));
  buttons.fontDown.addEventListener('click', () => changeFontSize(-1));
  buttons.fontUp.addEventListener('click', () => changeFontSize(1));
  buttons.fontReset.addEventListener('click', () => change(() => { preferences.fontSize = 16; }));
  layoutButtons.forEach(button => button.addEventListener('click', () => change(() => { preferences.pageLayout = button.dataset.viewLayout === 'page'; })));
  buttons.focus.addEventListener('click', () => change(() => { preferences.focus = !preferences.focus; }));
  buttons.typewriter.addEventListener('click', () => change(() => { preferences.typewriter = !preferences.typewriter; }));
  document.addEventListener('wheel', event => {
    if (!event.ctrlKey || event.deltaY === 0) return;
    event.preventDefault();
    changeFontSize(event.deltaY < 0 ? 1 : -1);
  }, { passive: false });
  document.addEventListener('selectionchange', () => { updateActiveBlock(); centerCaret(); });
  editor.addEventListener('input', () => { updateActiveBlock(); centerCaret(); });
  editor.addEventListener('focus', () => { updateActiveBlock(); centerCaret(); });
  sync();
  return Object.freeze({ get preferences() { return { ...preferences }; }, reset() { Object.assign(preferences, defaults); sync(); save(); } });
}
