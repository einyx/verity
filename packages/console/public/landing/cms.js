// Fills the marketing copy from the landing page document. The static HTML keeps the shipped copy, so
// the page still reads correctly if the request fails or nothing is published.
//
// In the CMS editor's preview (`?cmsPreview=1`, inside the editor's iframe), the page takes the draft the
// editor sends, and text edits made on the page are sent back to the editor one field at a time.
(() => {
  const read = (doc, path) => path.split('.').reduce((value, key) => value?.[key], doc);

  const fill = (doc) => {
    for (const el of document.querySelectorAll('[data-cms]')) {
      // Never overwrite the text the visitor is typing into.
      if (el === document.activeElement) {
        continue;
      }

      const value = read(doc, el.dataset.cms);
      // A headline can have fewer lines than the page has spans; an absent line is cleared.
      el.textContent = typeof value === 'string' ? value : '';
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
  };

  const isPreview = new URLSearchParams(location.search).has('cmsPreview') && window.parent !== window;

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
  });

  // Text marked for the CMS is editable in place. Links and buttons are not navigated to in preview.
  for (const el of document.querySelectorAll('[data-cms]')) {
    el.setAttribute('contenteditable', 'plaintext-only');
    el.addEventListener('input', () => {
      window.parent.postMessage(
        { type: 'meshx-cms-edit', path: el.dataset.cms, value: el.textContent },
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

  window.parent.postMessage({ type: 'meshx-cms-ready' }, location.origin);
})();
