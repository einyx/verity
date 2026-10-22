// Language menu for the marketing site. The globe opens a dropdown of languages; choosing one applies its
// translation from i18n/ (English where there is none) and remembers the choice in this browser.
(() => {
  const storageKey = 'landing-locale';
  const locales = [
    ['en', 'English'],
    ['ar', 'العربية'],
    ['de', 'Deutsch'],
    ['es', 'Español'],
    ['fa-ir', 'فارسی'],
    ['fr', 'Français'],
    ['it', 'Italiano'],
    ['ja', '日本語'],
    ['ko', '한국어'],
    ['pl-pl', 'Polski'],
    ['pt-br', 'Português (Brasil)'],
    ['pt-pt', 'Português (Portugal)'],
    ['ru', 'Русский'],
    ['th', 'ไทย'],
    ['tr-tr', 'Türkçe'],
    ['zh-cn', '简体中文'],
    ['zh-hk', '繁體中文（香港）'],
    ['zh-tw', '繁體中文（台灣）'],
  ];
  const triggers = [...document.querySelectorAll('[data-locale-button]')];
  const menu = document.getElementById('locale-menu');
  const list = document.querySelector('[data-locale-list]');
  const originals = new Map();
  const tables = new Map();
  let latest = 0;
  let anchor;

  const textNodes = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      // The language names themselves (the list and the trigger label) are never translated.
      const inPicker = node.parentElement?.closest('[data-locale-list], [data-locale-button]');
      if (
        node.parentElement &&
        !inPicker &&
        !['SCRIPT', 'STYLE'].includes(node.parentElement.tagName) &&
        node.nodeValue.trim()
      ) {
        nodes.push(node);
      }
    }
    return nodes;
  };

  const loadTable = (code) => {
    if (!tables.has(code)) {
      tables.set(
        code,
        fetch(`/console/landing/i18n/${code}.json`)
          .then((response) => (response.ok ? response.json() : {}))
          .catch(() => ({}))
      );
    }
    return tables.get(code);
  };

  const applyTranslations = async (code) => {
    const request = ++latest;

    for (const node of textNodes()) {
      if (!originals.has(node)) {
        originals.set(node, node.nodeValue);
      }
    }

    const table = code === 'en' ? {} : await loadTable(code);

    // A slower translation must not overwrite a language picked after it was requested.
    if (request !== latest) {
      return;
    }

    for (const [node, original] of originals) {
      const key = original.replace(/\s+/g, ' ').trim();
      const translated = table[key];
      node.nodeValue = translated ? original.replace(original.trim(), translated) : original;
    }
  };

  const setLocale = (code) => {
    const [, label] = locales.find(([value]) => value === code) ?? locales[0];
    document.documentElement.lang = code;
    document.documentElement.dir = ['ar', 'fa-ir'].includes(code) ? 'rtl' : 'ltr';
    for (const trigger of triggers) {
      trigger.setAttribute('aria-label', `Language: ${label}`);
      trigger.querySelector('[data-locale-label]').textContent = label;
    }
    for (const button of list?.querySelectorAll('button') ?? []) {
      button.setAttribute('aria-current', String(button.dataset.locale === code));
    }
    void applyTranslations(code);
  };

  const close = () => {
    menu?.classList.remove('is-open');
    for (const trigger of triggers) {
      trigger.setAttribute('aria-expanded', 'false');
    }
    anchor = undefined;
  };

  const open = (trigger) => {
    anchor = trigger;
    menu.classList.add('is-open');
    const rect = trigger.getBoundingClientRect();
    const left = rect.right - menu.offsetWidth;
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.left = `${Math.max(16, Math.min(left, window.innerWidth - menu.offsetWidth - 16))}px`;
    for (const button of triggers) {
      button.setAttribute('aria-expanded', String(button === trigger));
    }
    menu.querySelector('[aria-current="true"]')?.focus();
  };

  const choose = (code) => {
    setLocale(code);
    close();
    try {
      window.localStorage.setItem(storageKey, code);
    } catch {
      // Storage can be unavailable. The choice still applies for this page view.
    }
  };

  if (list) {
    for (const [code, label] of locales) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.locale = code;
      button.textContent = label;
      button.addEventListener('click', () => choose(code));
      list.append(button);
    }
  }

  for (const trigger of triggers) {
    trigger.setAttribute('aria-haspopup', 'true');
    trigger.setAttribute('aria-controls', 'locale-menu');
    trigger.setAttribute('aria-expanded', 'false');
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const trigger = target?.closest('[data-locale-button]');
    if (trigger) {
      if (menu.classList.contains('is-open') && anchor === trigger) {
        close();
      } else {
        open(trigger);
      }
      return;
    }
    if (menu.classList.contains('is-open') && !menu.contains(target)) {
      close();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
    }
  });

  window.addEventListener('scroll', close, { passive: true });

  let current = 'en';

  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored && locales.some(([value]) => value === stored)) {
      current = stored;
    }
  } catch {
    // Storage can be unavailable. The default language still applies.
  }

  setLocale(current);
})();
