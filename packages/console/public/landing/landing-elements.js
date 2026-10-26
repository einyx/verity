// Stable authored-element bindings shared by published rendering and the live editor.
(() => {
  const preview = new URLSearchParams(location.search).has('cmsPreview') && window.parent !== window;
  const originals = new WeakMap();
  const positions = new WeakMap();
  let selected;
  let menu;
  let menuTarget;
  let lastDoc;
  let moveHandle;
  let drag;
  const post = (data) => window.parent.postMessage(data, location.origin);
  const safeLink = (value) => {
    if (typeof value !== 'string' || /[\\\u0000-\u0020]/.test(value)) return false;
    if (value.startsWith('#') || (value.startsWith('/') && !value.startsWith('//'))) return true;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  };
  const safeImage = (value) => { try { return typeof value === 'string' && new URL(value).protocol === 'https:'; } catch { return false; } };
  const labelFor = (element) => {
    if (element.matches('[data-cms], [data-cms-copy]')) return element;
    return element.querySelector('[data-cms], [data-cms-copy], [data-cms-element-label]');
  };
  const targetElement = (target) => target.closest('img[data-cms-element], svg[data-cms-element]') || target.closest('a[data-cms-element], button[data-cms-element]') || target.closest('[data-cms-element]');
  const describe = (element) => {
    const label = labelFor(element);
    const image = element.matches('img, svg, [data-cms-image]') ? element : undefined;
    const sectionId = element.closest('[data-section-id]')?.dataset.sectionId;
    return {
      id: element.dataset.cmsElement,
      kind: image ? 'image' : element.closest('header') ? 'navigation' : element.matches('a, button') ? 'link' : 'text',
      ...(sectionId ? { sectionId } : {}),
      fields: {
        ...(label?.dataset.cms ? { text: label.dataset.cms } : label?.dataset.cmsCopy ? { text: `copy.${label.dataset.cmsCopy}.${document.documentElement.lang || 'en'}` } : {}),
        ...(element.dataset.cmsHref ? { href: element.dataset.cmsHref } : {}),
        ...(element.dataset.cmsImageSrc ? { src: element.dataset.cmsImageSrc, alt: element.dataset.cmsImageSrc.replace(/\.src$/, '.alt') } : {}),
      },
      values: {
        ...(label ? { text: label.textContent || '' } : {}),
        ...(element.matches('a') ? { href: element.getAttribute('href') || '' } : {}),
        ...(image ? { src: image.getAttribute('src') || '', alt: image.getAttribute('alt') || image.getAttribute('aria-label') || '' } : {}),
      },
    };
  };
  const bind = () => {
    for (const region of document.querySelectorAll('header, main, footer')) {
      let index = 0;
      for (const element of region.querySelectorAll('a[href], button, img, svg[role="img"], main > section svg[viewBox], [data-cms], [data-cms-copy], [data-cms-image]')) {
        if (element.closest('.cms-context-menu, [data-cms-replacement]') || element.dataset.cmsElement) continue;
        // A composite image (for example the hero diagram figure) is one selectable and movable
        // unit: mark the root only, never the svg or img pieces inside it.
        const composite = element.closest('[data-cms-image]');
        if (composite && composite !== element) continue;
        if (element.matches('svg') && (element.closest('a, button') && element.getAttribute('role') !== 'img')) continue;
        if (element.matches('svg') && Number((element.getAttribute('viewBox') || '').split(/\s+/)[2]) < 100 && element.getAttribute('role') !== 'img') continue;
        const section = element.closest('[data-section-id]');
        const field = (element.dataset.cms || element.dataset.cmsImageSrc || element.dataset.cmsImage)?.replace(/^sections\.\d+\./, '');
        if (element.matches('[data-cms-image]')) element.dataset.cmsImageSrc = field;
        const prefix = section?.dataset.sectionId || region.tagName.toLowerCase();
        element.dataset.cmsElement = `${prefix}-${field || ++index}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
        if (element.matches('a, button') && !labelFor(element)) {
          // Wrap only the label text; retain icons, brand SVGs and existing handlers.
          for (const node of [...element.childNodes]) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
              const span = document.createElement('span');
              span.dataset.cmsElementLabel = 'true';
              node.replaceWith(span);
              span.append(node);
            }
          }
        }
        originals.set(element, { href: element.getAttribute('href'), src: element.getAttribute('src'), srcset: element.getAttribute('srcset'), alt: element.getAttribute('alt'), fit: element.style.objectFit, translate: element.style.translate, text: labelFor(element)?.textContent, display: element.style.display });
        if (preview) {
          element.setAttribute('tabindex', element.getAttribute('tabindex') || '0');
          const label = labelFor(element);
          if (label && !label.matches('[data-cms], [data-cms-copy]')) {
            label.setAttribute('contenteditable', 'plaintext-only');
            label.setAttribute('aria-label', `Edit ${label.textContent?.trim() || 'label'}`);
            label.addEventListener('input', () => post({ type: 'meshx-cms-element-edit', selection: describe(element), field: 'text', value: label.textContent || '' }));
          }
        }
      }
    }
  };
  const fill = (doc) => {
    lastDoc = doc;
    bind();
    for (const element of document.querySelectorAll('[data-cms-element]')) {
      const original = originals.get(element);
      if (!original) continue;
      const override = doc.elements?.[element.dataset.cmsElement] || {};
      const label = labelFor(element);
      if (label && !label.matches('[data-cms], [data-cms-copy]') && label !== document.activeElement) label.textContent = typeof override.text === 'string' ? override.text : original.text;
      if (element.matches('a') && !element.dataset.cmsHref) element.setAttribute('href', safeLink(override.href) ? override.href : original.href || '#');
      if (element.matches('img')) {
        element.setAttribute('src', safeImage(override.src) ? override.src : original.src || '');
        if (safeImage(override.src)) element.removeAttribute('srcset');
        else if (original.srcset) element.setAttribute('srcset', original.srcset);
        element.setAttribute('alt', typeof override.alt === 'string' ? override.alt : original.alt || '');
      }
      if (element.matches('svg')) {
        const replacement = element.nextElementSibling?.matches('[data-cms-replacement]') ? element.nextElementSibling : undefined;
        if (safeImage(override.src)) {
          const image = replacement || document.createElement('img');
          image.dataset.cmsReplacement = 'true';
          image.dataset.cmsElement = element.dataset.cmsElement;
          image.setAttribute('class', element.getAttribute('class') || '');
          image.src = override.src;
          image.alt = override.alt || element.getAttribute('aria-label') || '';
          image.style.objectFit = override.fit === 'contain' ? 'contain' : 'cover';
          image.style.maxWidth = '100%';
          const box = (element.getAttribute('viewBox') || '').split(/\s+/).map(Number);
          if (box[2] && box[3]) image.style.aspectRatio = `${box[2]} / ${box[3]}`;
          if (!replacement) element.after(image);
          element.style.display = 'none';
        } else { replacement?.remove(); element.style.display = original.display; }
      }
      element.style.objectFit = ['cover', 'contain'].includes(override.fit) ? override.fit : original.fit;
      const x = Number.isInteger(override.x) && Math.abs(override.x) <= 400 ? override.x : 0;
      const y = Number.isInteger(override.y) && Math.abs(override.y) <= 400 ? override.y : 0;
      positions.set(element, { x, y });
      element.style.translate = x || y ? `${x}px ${y}px` : original.translate;
      if (element.nextElementSibling?.matches('[data-cms-replacement]')) element.nextElementSibling.style.translate = element.style.translate;
    }
    if (selected && !selected.isConnected) { selected = undefined; moveHandle?.remove(); }
    positionHandle();
  };
  const offset = (value) => Number.isInteger(value) && Math.abs(value) <= 400 ? value : 0;
  const clamp = (value) => Math.max(-400, Math.min(400, Math.round(value)));
  const imageTarget = () => selected?.nextElementSibling?.matches('[data-cms-replacement]') ? selected.nextElementSibling : selected;
  const positionHandle = () => {
    if (!moveHandle || !selected?.isConnected) return;
    const box = imageTarget().getBoundingClientRect();
    moveHandle.hidden = box.bottom < 0 || box.top > innerHeight;
    moveHandle.style.left = `${Math.max(8, Math.min(box.left, innerWidth - 120))}px`;
    moveHandle.style.top = `${Math.max(8, Math.min(box.top, innerHeight - 44))}px`;
  };
  const paintMove = (x, y) => {
    positions.set(selected, { x, y });
    selected.style.translate = `${x}px ${y}px`;
    if (imageTarget() !== selected) imageTarget().style.translate = selected.style.translate;
    positionHandle();
  };
  const finishDrag = (commit) => {
    if (!drag) return;
    const current = drag;
    drag = undefined;
    if (commit && (current.x !== current.startX || current.y !== current.startY)) {
      post({ type: 'meshx-cms-move', id: selected.dataset.cmsElement, x: current.x, y: current.y });
    } else {
      positions.set(selected, { x: current.startX, y: current.startY });
      selected.style.translate = current.translate;
      if (imageTarget() !== selected) imageTarget().style.translate = current.translate;
    }
    if (moveHandle.hasPointerCapture?.(current.pointerId)) moveHandle.releasePointerCapture(current.pointerId);
    positionHandle();
  };
  const attachMoveHandle = () => {
    finishDrag(false);
    moveHandle?.remove();
    moveHandle = undefined;
    if (!preview || !selected.matches('img, svg, [data-cms-image]')) return;
    moveHandle = document.createElement('button');
    moveHandle.type = 'button';
    moveHandle.className = 'cms-move-handle cms-image-drag-handle';
    moveHandle.dataset.visible = 'true';
    moveHandle.textContent = 'Move image';
    moveHandle.setAttribute('aria-label', 'Move image: drag or use arrow keys; Shift for 10 pixels');
    moveHandle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const stored = positions.get(selected);
      const x = offset(stored?.x), y = offset(stored?.y);
      drag = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, startX: x, startY: y, x, y, translate: selected.style.translate };
      moveHandle.setPointerCapture?.(event.pointerId);
      moveHandle.focus();
    });
    moveHandle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      drag.x = clamp(drag.startX + event.clientX - drag.clientX);
      drag.y = clamp(drag.startY + event.clientY - drag.clientY);
      paintMove(drag.x, drag.y);
    });
    moveHandle.addEventListener('pointerup', (event) => { if (event.pointerId === drag?.pointerId) finishDrag(true); });
    moveHandle.addEventListener('pointercancel', () => finishDrag(false));
    moveHandle.addEventListener('lostpointercapture', () => finishDrag(false));
    moveHandle.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { finishDrag(false); return; }
      const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!direction || drag) return;
      event.preventDefault();
      const stored = positions.get(selected);
      const step = event.shiftKey ? 10 : 1;
      const x = clamp(offset(stored?.x) + direction[0] * step), y = clamp(offset(stored?.y) + direction[1] * step);
      paintMove(x, y);
      post({ type: 'meshx-cms-move', id: selected.dataset.cmsElement, x, y });
    });
    document.body.append(moveHandle);
    positionHandle();
  };
  const select = (element) => {
    finishDrag(false);
    if (element.matches('[data-cms-replacement]') && element.previousElementSibling?.matches('svg[data-cms-element]')) element = element.previousElementSibling;
    document.querySelectorAll('[data-cms-selected]').forEach((item) => item.removeAttribute('data-cms-selected'));
    selected = element;
    selected.dataset.cmsSelected = 'true';
    attachMoveHandle();
    post({ type: 'meshx-cms-select-element', selection: describe(element) });
  };
  const close = (restore = true) => {
    menu?.remove(); menu = undefined;
    if (restore && menuTarget?.isConnected) menuTarget.focus();
  };
  const open = (target, x = 16, y = 56) => {
    close(false);
    menuTarget = target;
    const element = targetElement(target);
    if (element) select(element);
    const section = target.closest('[data-section-id]');
    const sectionId = section?.dataset.sectionId;
    const singleton = ['hero', 'closingCta'].includes(section?.dataset.sectionType);
    menu = document.createElement('div');
    menu.className = 'cms-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Edit page element');
    const add = (label, run, disabled = false) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label; button.disabled = disabled;
      button.setAttribute('role', 'menuitem');
      button.addEventListener('click', () => { close(); run(); });
      menu.append(button);
    };
    if (element) add(`Edit ${describe(element).kind}`, () => post({ type: 'meshx-cms-select-element', selection: describe(element) }));
    if (element?.matches('img, svg')) add('Replace image', () => post({ type: 'meshx-cms-select-element', selection: describe(element) }));
    if (sectionId) {
      for (const [label, action] of [['Edit section', 'edit'], ['Move section up', 'up'], ['Move section down', 'down'], ['Duplicate section', 'duplicate'], ['Delete section', 'delete']]) {
        add(label, () => post({ type: 'meshx-cms-section-action', sectionId, action }), singleton && ['duplicate', 'delete'].includes(action));
      }
    }
    for (const [type, label] of [['text', 'Text section'], ['image', 'Image section'], ['cta', 'Call to action']]) {
      for (const position of (sectionId ? ['before', 'after'] : ['end'])) {
        add(`Add ${label.toLowerCase()}${sectionId ? ` ${position}` : ''}`, () => post({ type: 'meshx-cms-add-section', sectionType: type, targetSectionId: sectionId, position }), (lastDoc?.sections?.length || 0) >= 40);
      }
    }
    document.body.append(menu);
    const box = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - box.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - box.height - 8))}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
  };
  bind();
  window.LandingElements = { fill, describe };
  if (!preview) return;
  window.addEventListener('scroll', positionHandle, { passive: true });
  window.addEventListener('resize', positionHandle);
  // The editor styles ship as a separate file: the page's content security policy allows
  // same-origin stylesheets but blocks inline style blocks, and the file keeps the version hash
  // in the URL so a changed stylesheet is never served from a stale cache.
  // so the editor styles ship as a file next to this script.
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = '/console/landing/landing-elements.css?v=e1dc7377b5';
  document.head.append(style);
  // The editor owns this control outside the preview so it never covers the website navigation.
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.type === 'meshx-cms-open-actions') {
      open(selected || document.querySelector('main'), innerWidth - 250, 8);
    }
  });
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || event.target.closest('.cms-context-menu, .cms-move-handle')) return;
    const element = targetElement(event.target);
    if (!element) return;
    select(element);
    if (element.matches('a, button') || element.closest('a, button')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('contextmenu', (event) => {
    if (!(event.target instanceof Element)) return;
    event.preventDefault(); event.stopImmediatePropagation(); open(event.target, event.clientX, event.clientY);
  }, true);
  document.addEventListener('pointerdown', (event) => { if (menu && !menu.contains(event.target)) close(false); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { finishDrag(false); close(); return; }
    if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && event.target instanceof Element) { event.preventDefault(); open(event.target); return; }
    if (!menu) return;
    if (event.key === 'Tab') { close(false); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  });
})();
