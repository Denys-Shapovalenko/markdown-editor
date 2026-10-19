const STORAGE_KEY = 'markdown-editor.view-preferences.v1';
const FONT_SIZES = [14, 16, 18, 20, 22, 24];

function readPreferences() {
  const defaults = { theme: 'light', fontSize: 16, focus: false, typewriter: false };
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return {
      theme: value?.theme === 'dark' ? 'dark' : 'light',
      fontSize: FONT_SIZES.includes(value?.fontSize) ? value.fontSize : 16,
      focus: value?.focus === true,
      typewriter: value?.typewriter === true
    };
  } catch { return defaults; }
}

export function installViewPreferences({ editor }) {
  const preferences = readPreferences();
  const root = document.documentElement;
  const buttons = Object.fromEntries([...document.querySelectorAll('[data-view]')].map(button => [button.dataset.view, button]));
  let scrollPending = false;

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
    document.body.classList.toggle('focus-mode', preferences.focus);
    document.body.classList.toggle('typewriter-mode', preferences.typewriter);
    const themeLabel = preferences.theme === 'dark' ? 'Світла тема' : 'Темна тема';
    buttons.theme.querySelector('.menu-label').textContent = themeLabel;
    buttons.theme.setAttribute('aria-label', themeLabel);
    for (const [key, pressed] of [['focus', preferences.focus], ['typewriter', preferences.typewriter]])
      buttons[key].setAttribute('aria-pressed', String(pressed));
    updateActiveBlock();
  }
  function centerCaret() {
    if (!preferences.typewriter || document.activeElement !== editor || scrollPending) return;
    const block = updateActiveBlock();
    if (!block) return;
    const rect = block.getBoundingClientRect();
    const viewport = window.innerHeight;
    if (rect.top < 120 || rect.bottom > viewport - 72) {
      scrollPending = true;
      requestAnimationFrame(() => {
        block.scrollIntoView({ block: 'center', behavior: 'smooth' });
        scrollPending = false;
      });
    }
  }
  function change(update) { update(); sync(); save(); }

  buttons.theme.addEventListener('click', () => change(() => { preferences.theme = preferences.theme === 'dark' ? 'light' : 'dark'; }));
  buttons.fontDown.addEventListener('click', () => change(() => { preferences.fontSize = FONT_SIZES[Math.max(0, FONT_SIZES.indexOf(preferences.fontSize) - 1)]; }));
  buttons.fontUp.addEventListener('click', () => change(() => { preferences.fontSize = FONT_SIZES[Math.min(FONT_SIZES.length - 1, FONT_SIZES.indexOf(preferences.fontSize) + 1)]; }));
  buttons.fontReset.addEventListener('click', () => change(() => { preferences.fontSize = 16; }));
  buttons.focus.addEventListener('click', () => change(() => { preferences.focus = !preferences.focus; }));
  buttons.typewriter.addEventListener('click', () => change(() => { preferences.typewriter = !preferences.typewriter; }));
  document.addEventListener('selectionchange', () => { updateActiveBlock(); centerCaret(); });
  editor.addEventListener('input', () => { updateActiveBlock(); centerCaret(); });
  editor.addEventListener('focus', () => { updateActiveBlock(); centerCaret(); });
  sync();
  return Object.freeze({ get preferences() { return { ...preferences }; }, reset() { Object.assign(preferences, { theme: 'light', fontSize: 16, focus: false, typewriter: false }); sync(); save(); } });
}
