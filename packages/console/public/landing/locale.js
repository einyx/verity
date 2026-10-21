// Language modal for the marketing site. The globe opens a list of languages; choosing one applies its
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
  const list = document.querySelector('[data-locale-list]');
  const originals = new Map();

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

  const applyTranslations = async (code) => {
    for (const node of textNodes()) {
      if (!originals.has(node)) {
        originals.set(node, node.nodeValue);
      }
    }

    let table = {};

    if (code !== 'en') {
      try {
        const response = await fetch(`/console/landing/i18n/${code}.json`);
        table = response.ok ? await response.json() : {};
      } catch {
        table = {};
      }
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

  const choose = (code) => {
    setLocale(code);
    try {
      window.localStorage.setItem(storageKey, code);
    } catch {
      // Storage can be unavailable. The choice still applies for this page view.
    }
    window.closeLocaleModal?.();
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
