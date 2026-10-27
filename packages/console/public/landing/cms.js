// Fills the marketing copy from the landing page document. The static HTML keeps the shipped copy, so
// the page still reads correctly if the request fails or nothing is published.
//
// In the CMS editor's preview (`?cmsPreview=1`, inside the editor's iframe), the page takes the draft the
// editor sends, and text edits made on the page are sent back to the editor one field at a time.
(() => {
  const read = (doc, path) => path.split('.').reduce((value, key) => value?.[key], doc);
  const sectionAnchors = Object.freeze({
    hero: 'top',
    fomo: 'missing-layer',
    howItWorks: 'how-it-works',
    agents: 'agents',
    platform: 'platform',
    products: 'products',
    industries: 'industries',
    stories: 'stories',
    why: 'why',
    trust: 'security',
    closingCta: 'start',
  });
  const sectionTypeForPath = new Set(Object.keys(sectionAnchors));
  const pathInDocument = (doc, path) => {
    const [prefix, ...rest] = path.split('.');
    if (!prefix || !sectionTypeForPath.has(prefix) || !Array.isArray(doc.sections)) return path;
    const index = doc.sections.findIndex((section) => section?.type === prefix);
    return index < 0 ? path : `sections.${index}.${rest.join('.')}`;
  };
  const sectionTypes = Object.freeze([
    ['hero', 'Hero'],
    ['fomo', 'Problem and opportunity'],
    ['howItWorks', 'How it works'],
    ['agents', 'Agents'],
    ['platform', 'Platform'],
    ['products', 'Products'],
    ['industries', 'Industries'],
    ['stories', 'Customer stories'],
    ['why', 'Why us'],
    ['trust', 'Security and trust'],
    ['closingCta', 'Closing call to action'],
    ['text', 'Text section'],
    ['image', 'Image section'],
    ['cta', 'Call to action'],
  ]);
  const validLinkTarget = (value) =>
    typeof value === 'string' &&
    (value.startsWith('#') ||
      (value.startsWith('/') && !value.startsWith('//')) ||
      (() => {
        try {
          return new URL(value).protocol === 'https:';
        } catch {
          return false;
        }
      })());
  const validImageSource = (value) => {
    try {
      const url = new URL(value, location.origin);
      return url.protocol === 'https:' || (url.protocol === 'http:' && url.origin === location.origin);
    } catch {
      return false;
    }
  };
  const offsets = new Map();

  const ensureCustomSectionStyles = () => {
    if (document.getElementById('cms-added-section-styles')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'cms-added-section-styles';
    style.textContent = `
      .cms-added-section { border-block: 1px solid var(--color-border, #e5e5e5); background: var(--color-background, #fff); }
      .cms-added-section__inner { width: min(100% - 3rem, 80rem); margin-inline: auto; padding-block: clamp(3rem, 7vw, 6rem); }
      .cms-added-section h2 { max-width: 48rem; margin: 0 0 1rem; font-size: clamp(1.75rem, 4vw, 3rem); line-height: 1.08; font-weight: 600; }
      .cms-added-section p { max-width: 48rem; margin: 0; color: var(--color-muted-foreground, #57534e); line-height: 1.65; }
      .cms-added-section img { display: block; width: 100%; max-height: 38rem; margin-top: 1.5rem; border-radius: 1rem; object-fit: cover; }
      .cms-added-section__caption { margin-top: .75rem !important; font-size: .875rem; }
      .cms-added-section__button { display: inline-flex; margin-top: 1.5rem; padding: .75rem 1.25rem; border-radius: .5rem; background: var(--color-brand, #d92d20); color: white !important; font-weight: 600; text-decoration: none; }
      .cms-context-menu { position: fixed; z-index: 2147483001; display: grid; min-width: 190px; padding: 6px; border: 1px solid #d6d3d1; border-radius: 8px; background: #fff; box-shadow: 0 8px 24px #0002; color: #292524; font: 14px/1.4 system-ui, sans-serif; }
      .cms-context-menu__title { margin: 0; padding: 7px 9px 5px; color: #78716c; font-size: 11px; font-weight: 650; }
      .cms-context-menu button { min-height: 36px; padding: 7px 9px; border: 0; border-radius: 5px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
      .cms-context-menu button:hover, .cms-context-menu button:focus-visible { outline: none; background: #f5f5f4; }
      .cms-move-handle { position: fixed; z-index: 2147483000; display: grid; width: 32px; height: 32px; padding: 0; place-items: center; border: 1px solid #fff; border-radius: 999px; background: #d92d20; box-shadow: 0 2px 12px #0004; color: #fff; font: 700 18px/1 sans-serif; cursor: grab; touch-action: none; opacity: 0; pointer-events: none; transition: opacity 100ms ease, transform 100ms ease; }
      .cms-move-handle[data-visible="true"], .cms-move-handle:focus-visible { opacity: 1; pointer-events: auto; outline: 2px solid #d92d20; outline-offset: 2px; }
      .cms-move-handle:active { cursor: grabbing; transform: scale(.96); }
    `;
    document.head.append(style);
  };

  const renderCustomSections = (sections) => {
    const insertionPoint = document.getElementById('start');
    if (!insertionPoint) {
      return;
    }

    ensureCustomSectionStyles();
    let container = document.getElementById('cms-added-sections');
    if (!container) {
      container = document.createElement('div');
      container.id = 'cms-added-sections';
      insertionPoint.before(container);
    }
    document.querySelectorAll('.cms-move-handle[data-cms-generated-handle="true"]').forEach((handle) => handle.remove());
    container.replaceChildren();

    if (!Array.isArray(sections)) {
      return;
    }

    for (const section of sections) {
      if (!section || typeof section.id !== 'string' || typeof section.heading !== 'string') {
        continue;
      }

      const sectionElement = document.createElement('section');
      sectionElement.className = 'cms-added-section';
      sectionElement.id = `cms-section-${section.id}`;
      const inner = document.createElement('div');
      inner.className = 'cms-added-section__inner';
      const heading = document.createElement('h2');
      heading.textContent = section.heading;
      inner.append(heading);

      if (section.type === 'text' && typeof section.body === 'string') {
        const body = document.createElement('p');
        body.textContent = section.body;
        inner.append(body);
      } else if (section.type === 'image' && typeof section.src === 'string' && validImageSource(section.src)) {
        const image = document.createElement('img');
        image.src = section.src;
        image.alt = typeof section.alt === 'string' ? section.alt : '';
        image.dataset.cmsImage = `custom.${section.id}`;
        image.dataset.cmsMovable = `custom.${section.id}`;
        inner.append(image);
        if (typeof section.caption === 'string' && section.caption) {
          const caption = document.createElement('p');
          caption.className = 'cms-added-section__caption';
          caption.textContent = section.caption;
          inner.append(caption);
        }
      } else if (
        section.type === 'cta' &&
        typeof section.body === 'string' &&
        typeof section.buttonLabel === 'string' &&
        validLinkTarget(section.buttonHref)
      ) {
        const body = document.createElement('p');
        body.textContent = section.body;
        const link = document.createElement('a');
        link.className = 'cms-added-section__button';
        link.textContent = section.buttonLabel;
        link.href = section.buttonHref;
        link.dataset.cmsHref = `customSections.${sections.indexOf(section)}.buttonHref`;
        link.dataset.cmsMovable = `custom.${section.id}`;
        link.dataset.cmsLinkPath = `customSections.${section.id}`;
        inner.append(body, link);
      } else if (section.type !== 'text') {
        continue;
      }

      sectionElement.append(inner);
      container.append(sectionElement);
    }
  };

  const renderDocumentSections = (doc) => {
    // Canonical sections reuse the authored DOM so the editor retains the published page's layout.
    const main = document.querySelector('main');
    if (!main || !Array.isArray(doc.sections)) return;

    const staticByType = new Map();
    for (const [type, anchor] of Object.entries(sectionAnchors)) {
      const section = document.getElementById(anchor);
      if (section instanceof HTMLElement && section.tagName === 'SECTION') {
        staticByType.set(type, section);
      }
    }

    const claimedTypes = new Set();
    const dynamicSections = [];
    const dynamicIndexes = [];
    doc.sections.slice(0, 40).forEach((section, index) => {
      if (staticByType.has(section?.type) && !claimedTypes.has(section.type)) {
        claimedTypes.add(section.type);
      } else {
        dynamicSections.push(section);
        dynamicIndexes.push(index);
      }
    });

    const rendered = document.createElement('div');
    if (window.LandingRenderer) {
      window.LandingRenderer.render(rendered, dynamicSections, dynamicIndexes);
    }
    const dynamicById = new Map(
      [...rendered.querySelectorAll('[data-section-id]')].map((section) => [
        section.dataset.sectionId,
        section,
      ])
    );
    for (const section of dynamicById.values()) section.id = `cms-section-${section.dataset.sectionId}`;
    const ordered = [];
    claimedTypes.clear();
    doc.sections.slice(0, 40).forEach((section) => {
      const staticSection = staticByType.get(section?.type);
      if (staticSection && !claimedTypes.has(section.type)) {
        claimedTypes.add(section.type);
        staticSection.hidden = false;
        staticSection.dataset.sectionId = section.id;
        staticSection.dataset.sectionType = section.type;
        ordered.push(staticSection);
      } else {
        const dynamicSection = dynamicById.get(section?.id);
        if (dynamicSection) ordered.push(dynamicSection);
      }
    });

    for (const [type, section] of staticByType) {
      if (!claimedTypes.has(type)) {
        section.hidden = true;
        delete section.dataset.sectionId;
        delete section.dataset.sectionType;
      }
    }

    const oldRendered = main.querySelectorAll(':scope > .cms-rendered-section');
    oldRendered.forEach((section) => section.remove());
    const firstStatic = [...staticByType.values()].find((section) => section.parentElement === main);
    let cursor = firstStatic || main.firstChild;
    for (const section of ordered) {
      // Leave already-ordered DOM connected so draft updates do not steal the typing caret.
      if (section !== cursor) main.insertBefore(section, cursor);
      cursor = section.nextSibling;
    }
  };

  // The last document filled, so the preview can refill it after the language changes.
  let lastDoc;

  // The page is editable only in the editor's preview, which is the same page in an iframe with the
  // preview flag. On the published site the copy is read-only: the visitor gets the published
  // document and nothing else.
  const isPreview =
    new URLSearchParams(location.search).has('cmsPreview') && window.parent !== window;

  const fill = (doc) => {
    lastDoc = doc;

    if (Array.isArray(doc.sections)) {
      renderDocumentSections(doc);
    } else {
      renderCustomSections(doc.customSections);
    }

    for (const el of document.querySelectorAll('[data-cms]')) {
      el.dataset.cmsSource ??= el.dataset.cms;
      el.dataset.cms = pathInDocument(doc, el.dataset.cmsSource);
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
      el.dataset.cmsHrefSource ??= el.dataset.cmsHref;
      el.dataset.cmsHref = pathInDocument(doc, el.dataset.cmsHrefSource);
      const value = read(doc, el.dataset.cmsHref);
      if (validLinkTarget(value)) {
        el.setAttribute('href', value);
      }
      el.dataset.cmsLinkPath = el.dataset.cmsHref;
      el.dataset.cmsMovable ??= el.dataset.cmsHref.replace(/(?:\.href|Href)$/, '');
    }

    for (const el of document.querySelectorAll('[data-cms-image]')) {
      const image = doc.images?.[el.dataset.cmsImage];
      if (typeof image === 'string' && el instanceof HTMLElement) {
        el.style.setProperty('--cms-image', `url("${image.replaceAll('"', '%22')}")`);
        if (el instanceof HTMLImageElement) {
          el.src = image;
          el.removeAttribute('srcset');
        }
      }
    }

    // Position overrides apply to explicit image and CTA slots only.
    for (const el of document.querySelectorAll('[data-cms-image], [data-cms-movable]')) {
      const id = el.dataset.cmsMovable ?? el.dataset.cmsImage;
      if (!id) {
        continue;
      }
      const offset = doc.elements?.[el.dataset.cmsElement] ?? doc.layout?.[id];
      const safeOffset =
        offset && typeof offset.x === 'number' && typeof offset.y === 'number'
          ? offset
          : { x: 0, y: 0 };
      offsets.set(id, safeOffset);
      el.style.translate = `${safeOffset.x}px ${safeOffset.y}px`;
    }

    if (isPreview) {
      attachPositionControls();
      attachEditableFields();
    }
    window.LandingElements?.fill(doc);
  };

  if (isPreview && !window.LandingElements) {
    let addMenu;
    const closeAddMenu = () => {
      addMenu?.remove();
      addMenu = undefined;
    };
    document.addEventListener('contextmenu', (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      event.preventDefault();
      closeAddMenu();

      const menu = document.createElement('div');
      menu.className = 'cms-context-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Add a landing page section');
      const title = document.createElement('p');
      title.className = 'cms-context-menu__title';
      title.textContent = 'Add section';
      menu.append(title);

      const sectionElement = event.target.closest('[data-section-id]');
      const targetSectionId = sectionElement?.dataset.sectionId;
      const bounds = sectionElement?.getBoundingClientRect();
      const position = !targetSectionId || !bounds
        ? 'end'
        : event.clientY < bounds.top + bounds.height / 2
          ? 'before'
          : 'after';

      for (const [sectionType, label] of sectionTypes) {
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('role', 'menuitem');
        button.textContent = label;
        button.addEventListener('click', () => {
          window.parent.postMessage(
            { type: 'meshx-cms-add-section', sectionType, targetSectionId, position },
            location.origin
          );
          closeAddMenu();
        });
        menu.append(button);
      }

      document.body.append(menu);
      const menuBounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.min(event.clientX, window.innerWidth - menuBounds.width - 8)}px`;
      menu.style.top = `${Math.min(event.clientY, window.innerHeight - menuBounds.height - 8)}px`;
      addMenu = menu;
      menu.querySelector('button')?.focus();
    });

    document.addEventListener('pointerdown', (event) => {
      if (addMenu && event.target instanceof Node && !addMenu.contains(event.target)) {
        closeAddMenu();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeAddMenu();
        return;
      }
      if (!addMenu || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
      const items = [...addMenu.querySelectorAll('button')];
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'ArrowDown'
        ? (index + 1) % items.length
        : (index <= 0 ? items.length - 1 : index - 1);
      items[next]?.focus();
      event.preventDefault();
    });

    document.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      const section = event.target.closest('[data-section-id]');
      if (section?.dataset.sectionId) {
        window.parent.postMessage(
          { type: 'meshx-cms-select-section', sectionId: section.dataset.sectionId },
          location.origin
        );
      }
    });
  }

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

    if (event.data?.type === 'meshx-cms-editor-viewport' && Number.isFinite(event.data.height)) {
      document.documentElement.style.setProperty('--cms-editor-viewport', `${event.data.height}px`);
    }

    if (
      event.data?.type === 'meshx-cms-select-section' &&
      typeof event.data.sectionId === 'string'
    ) {
      const target = [...document.querySelectorAll('[data-section-id]')].find(
        (element) => element.dataset.sectionId === event.data.sectionId
      );
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  function attachEditableFields(root = document) {
    for (const el of root.querySelectorAll('[data-cms], [data-cms-copy]')) {
      if (el.dataset.cmsEditAttached === 'true') continue;
      el.dataset.cmsEditAttached = 'true';
    // Extra copy is stored under `copy.<id>` in the draft; the main copy uses its own dotted path.
    // Extra copy is stored per language, so the path is read when the edit is made.
    const path = () =>
      el.dataset.cms ?? `copy.${el.dataset.cmsCopy}.${document.documentElement.lang}`;
    // plaintext-only is not supported by every browser, so plain editing is used and pasting is
    // limited to plain text, which keeps the stored copy free of formatting.
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('spellcheck', 'true');
    el.setAttribute('aria-label', el.getAttribute('aria-label') ?? `Edit ${el.textContent?.trim() ?? 'page content'}`);

    // Modern plain-text paste (no formatting). Falls back to execCommand only if needed.
    // This avoids the deprecated execCommand path for the common case.
    el.addEventListener('paste', (event) => {
      event.preventDefault();
      const text = event.clipboardData?.getData('text/plain') ?? '';

      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        // Move cursor to end of inserted text
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        // Fallback for very old browsers
        document.execCommand('insertText', false, text);
    }
    });

    // Debounced input to reduce noisy postMessage spam during typing.
    let inputTimer;
    el.addEventListener('input', () => {
      clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        window.parent.postMessage(
          { type: 'meshx-cms-edit', path: path(), value: el.textContent ?? '' },
          location.origin
        );
      }, 120);
    });
    }
  }
  if (isPreview) {
    attachEditableFields();
  }

  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const link = event.target.closest('a[data-cms-href]');
      if (window.LandingElements) return;
      if (link) {
        event.preventDefault();
        event.stopPropagation();
        window.parent.postMessage(
          { type: 'meshx-cms-select-link', path: link.dataset.cmsHref },
          location.origin
        );
        return;
      }

      if (event.target.closest('a[href]')) {
        event.preventDefault();
      }
    },
    true
  );

  function attachPositionControls() {
    // Authored-element controls use the same stable IDs and offsets as the inspector. Keep the
    // legacy wrapper controls only for previews that do not load the element editor.
    if (window.LandingElements) return;
    for (const el of document.querySelectorAll('[data-cms-image], [data-cms-movable]')) {
      if (!(el instanceof HTMLElement) || el.dataset.cmsMoveControlAttached === 'true') {
        continue;
      }
      const id = el.dataset.cmsMovable ?? el.dataset.cmsImage;
      if (!id) {
        continue;
      }
      el.dataset.cmsMovable = id;
      el.dataset.cmsMoveControlAttached = 'true';
      const isButton = el.matches('a[data-cms-href]');
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'cms-move-handle';
      handle.textContent = '↕';
      handle.setAttribute('aria-label', `Move ${isButton ? 'button' : 'image'}: ${el.textContent?.trim() || el.getAttribute('alt') || 'page element'}`);
      handle.title = 'Drag to move. Use arrow keys to nudge.';
      if (el.closest('#cms-added-sections')) {
        handle.dataset.cmsGeneratedHandle = 'true';
      }
      document.body.append(handle);

      let hideTimer;
      const updateHandlePosition = () => {
        const bounds = el.getBoundingClientRect();
        handle.style.left = `${Math.min(window.innerWidth - 36, Math.max(4, bounds.right - 12))}px`;
        handle.style.top = `${Math.max(4, bounds.top - 12)}px`;
      };
      const showHandle = () => {
        clearTimeout(hideTimer);
        handle.dataset.visible = 'true';
        updateHandlePosition();
      };
      const hideHandleSoon = () => {
        hideTimer = setTimeout(() => {
          if (document.activeElement !== handle && !handle.matches(':hover')) {
            delete handle.dataset.visible;
          }
        }, 140);
      };
      el.addEventListener('pointerenter', showHandle);
      el.addEventListener('focusin', showHandle);
      el.addEventListener('pointerleave', hideHandleSoon);
      handle.addEventListener('pointerenter', showHandle);
      handle.addEventListener('pointerleave', hideHandleSoon);
      handle.addEventListener('focus', showHandle);
      window.addEventListener('scroll', updateHandlePosition, true);
      window.addEventListener('resize', updateHandlePosition);

      const savePosition = (offset) => {
        offsets.set(id, offset);
        window.parent.postMessage(
          { type: 'meshx-cms-move', id: el.dataset.cmsElement ?? id, x: offset.x, y: offset.y },
          location.origin
        );
      };
      const clamp = (value, axis) => {
        const limit = isButton ? (axis === 'x' ? 240 : 160) : 400;
        return Math.min(limit, Math.max(-limit, Math.round(value)));
      };
      handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const start = {
          x: event.clientX,
          y: event.clientY,
          base: offsets.get(id) ?? { x: 0, y: 0 },
        };
        handle.setPointerCapture(event.pointerId);
        const onMove = (moveEvent) => {
          const offset = {
            x: clamp(start.base.x + moveEvent.clientX - start.x, 'x'),
            y: clamp(start.base.y + moveEvent.clientY - start.y, 'y'),
          };
          offsets.set(id, offset);
          el.style.translate = `${offset.x}px ${offset.y}px`;
          updateHandlePosition();
        };
        const onUp = (upEvent) => {
          handle.removeEventListener('pointermove', onMove);
          handle.removeEventListener('pointerup', onUp);
          handle.removeEventListener('pointercancel', onCancel);
          if (upEvent.type === 'pointerup') {
            savePosition(offsets.get(id) ?? start.base);
          }
        };
        const onCancel = () => {
          offsets.set(id, start.base);
          el.style.translate = `${start.base.x}px ${start.base.y}px`;
          onUp({ type: 'pointercancel' });
        };
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
        handle.addEventListener('pointercancel', onCancel);
      });
      handle.addEventListener('keydown', (event) => {
        const directions = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const direction = directions[event.key];
        if (!direction) {
          return;
        }
        event.preventDefault();
        const step = event.shiftKey ? 10 : 2;
        const current = offsets.get(id) ?? { x: 0, y: 0 };
        const offset = {
          x: clamp(current.x + direction[0] * step, 'x'),
          y: clamp(current.y + direction[1] * step, 'y'),
        };
        offsets.set(id, offset);
        el.style.translate = `${offset.x}px ${offset.y}px`;
        updateHandlePosition();
        savePosition(offset);
      });
    }
  }

  if (isPreview) {
    window.parent.postMessage({ type: 'meshx-cms-ready' }, location.origin);
  }
})();
