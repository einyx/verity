// Fills the marketing copy from the published landing page document. The static HTML keeps the
// shipped copy, so the page still reads correctly if the request fails or nothing is published.
(() => {
  const read = (doc, path) => path.split('.').reduce((value, key) => value?.[key], doc);

  fetch('/api/landing-page', { headers: { accept: 'application/json' } })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      const doc = data?.published;
      if (!doc) {
        return;
      }

      for (const el of document.querySelectorAll('[data-cms]')) {
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
    })
    .catch(() => {
      // Keep the shipped copy when the request fails.
    });
})();
