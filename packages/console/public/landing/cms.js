// Fills the marketing copy from the landing page document. The static HTML keeps the shipped copy, so
// the page still reads correctly if the request fails or nothing is published.
//
// In the CMS editor's preview (`?cmsPreview=1`, inside the editor's iframe), the page takes the draft the
// editor sends, and text edits made on the page are sent back to the editor one field at a time.
(() => {
  const read = (doc, path) => path.split('.').reduce((value, key) => value?.[key], doc);

  // The last document filled, so the preview can refill it after the language changes.
  let lastDoc;

  const fill = (doc) => {
    lastDoc = doc;

    for (const el of document.querySelectorAll('[data-cms]')) {
      // Never overwrite the text the visitor is typing into.
      if (el === document.activeElement) {
        continue;
      }

      const value = read(doc, el.dataset.cms);
      // A headline can have fewer lines than the page has spans; an absent line is cleared.
      el.textContent = typeof value === 'string' ? value : '';
    }

    // Extra copy, keyed by its `data-cms-copy` id. Without an override the shipped text stays.
    for (const el of document.querySelectorAll('[data-cms-copy]')) {
      if (el === document.activeElement) {
        continue;
      }

      // Overrides are per language. The page's language is set by locale.js, so it is read here.
      const value = doc.copy?.[el.dataset.cmsCopy]?.[document.documentElement.lang];
      if (typeof value === 'string') {
        el.textContent = value;
      }
    }

    // The quote marks are part of the design, not the copy, so they are added here.
    for (const el of document.querySelectorAll('[data-cms-quote]')) {
      const value = read(doc, el.dataset.cmsQuote);
      if (typeof value === 'string') {
        el.textContent = `“${value}”`;
      }
    }

    for (const el of document.querySelectorAll('[data-cms-href]')) {
      const value = read(doc, el.dataset.cmsHref);
      if (typeof value === 'string') {
        el.setAttribute('href', value);
      }
    }

    // Images keep their place in the layout and are only shifted by the offset the editor saved.
    for (const el of document.querySelectorAll('[data-cms-image]')) {
      const offset = doc.layout?.[el.dataset.cmsImage];
      if (offset && typeof offset.x === 'number' && typeof offset.y === 'number') {
        offsets.set(el.dataset.cmsImage, offset);
        el.style.translate = `${offset.x}px ${offset.y}px`;
      }
    }
  };

  // The offset each movable image currently has, keyed by its `data-cms-image` id.
  const offsets = new Map();

  const isPreview =
    new URLSearchParams(location.search).has('cmsPreview') && window.parent !== window;

  if (!isPreview) {
    fetch('/api/landing-page', { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        const doc = data?.published;
        if (doc) {
          fill(doc);
        }
      })
      .catch(() => {
        // Keep the shipped copy when the request fails.
      });

    return;
  }

  // Preview: only the editor's own window may send a draft or receive edits.
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) {
      return;
    }

    if (event.data?.type === 'meshx-cms-draft' && event.data.doc) {
      fill(event.data.doc);
    }

    // The editor picked a language to preview. The page switches to it with its own language menu,
    // then the draft is filled again so the overrides for that language show. The translation loads
    // asynchronously, so the refill waits for it.
    if (event.data?.type === 'meshx-cms-locale' && /^[a-z-]+$/.test(event.data.code)) {
      document
        .querySelector(`[data-locale-list] button[data-locale="${event.data.code}"]`)
        ?.click();
      setTimeout(() => {
        if (lastDoc) {
          fill(lastDoc);
        }
      }, 800);
    }
  });

  // Text marked for the CMS is editable in place. Links and buttons are not navigated to in preview.
  for (const el of document.querySelectorAll('[data-cms], [data-cms-copy]')) {
    // Extra copy is stored under `copy.<id>` in the draft; the main copy uses its own dotted path.
    // Extra copy is stored per language, so the path is read when the edit is made.
    const path = () =>
      el.dataset.cms ?? `copy.${el.dataset.cmsCopy}.${document.documentElement.lang}`;
    // plaintext-only is not supported by every browser, so plain editing is used and pasting is
    // limited to plain text, which keeps the stored copy free of formatting.
    el.setAttribute('contenteditable', 'true');
    el.addEventListener('paste', (event) => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain') ?? '';
      document.execCommand('insertText', false, text);
    });
    el.addEventListener('input', () => {
      window.parent.postMessage(
        { type: 'meshx-cms-edit', path: path(), value: el.textContent },
        location.origin
      );
    });
  }

  document.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) {
        event.preventDefault();
      }
    },
    true
  );

  // Images can be dragged to a new position. The offset is sent to the editor when the drag ends.
  for (const el of document.querySelectorAll('[data-cms-image]')) {
    const id = el.dataset.cmsImage;
    el.style.cursor = 'move';
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (event) => {
      const start = { x: event.clientX, y: event.clientY, base: offsets.get(id) ?? { x: 0, y: 0 } };
      el.setPointerCapture(event.pointerId);

      const onMove = (moveEvent) => {
        // Clamped to the range the document schema accepts, so the preview never shows an offset that
        // would not save.
        const clamp = (value) => Math.min(400, Math.max(-400, Math.round(value)));
        const offset = {
          x: clamp(start.base.x + moveEvent.clientX - start.x),
          y: clamp(start.base.y + moveEvent.clientY - start.y),
        };
        offsets.set(id, offset);
        el.style.translate = `${offset.x}px ${offset.y}px`;
      };

      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        const offset = offsets.get(id) ?? start.base;
        window.parent.postMessage(
          { type: 'meshx-cms-move', id, x: offset.x, y: offset.y },
          location.origin
        );
      };

      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }

  window.parent.postMessage({ type: 'meshx-cms-ready' }, location.origin);
})();
