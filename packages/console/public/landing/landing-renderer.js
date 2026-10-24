// Safe, schema-shaped renderer used by the landing-page CMS preview and published page.
(() => {
  const types = new Set([
    'hero', 'fomo', 'howItWorks', 'agents', 'platform', 'products', 'industries',
    'stories', 'why', 'trust', 'closingCta', 'text', 'image', 'cta',
  ]);
  const anchors = {
    hero: 'top', fomo: 'missing-layer', howItWorks: 'how-it-works', agents: 'agents',
    platform: 'platform', products: 'products', industries: 'industries', stories: 'stories',
    why: 'why', trust: 'security', closingCta: 'start',
  };
  const safeLink = (value) => {
    if (typeof value !== 'string' || !value) return false;
    if (value.startsWith('#') || (value.startsWith('/') && !value.startsWith('//'))) return true;
    try { return new URL(value).protocol === 'https:'; } catch { return false; }
  };
  const safeImage = (value) => {
    try { return new URL(value, location.origin).protocol === 'https:'; } catch { return false; }
  };
  const setText = (element, text, path) => {
    element.textContent = text;
    if (path) element.dataset.cms = path;
  };
  const pathFor = (base, key) => `${base}.${key}`;

  const renderValue = (parent, value, path, options = {}) => {
    if (typeof value === 'string' && value) {
      const paragraph = document.createElement(options.inline ? 'span' : 'p');
      setText(paragraph, value, path);
      parent.append(paragraph);
      return;
    }
    if (!Array.isArray(value)) return;
    if (value.every((item) => typeof item === 'string')) {
      const list = document.createElement('ul');
      list.className = 'cms-rendered-list';
      value.forEach((item, index) => {
        const entry = document.createElement('li');
        setText(entry, item, `${path}.${index}`);
        list.append(entry);
      });
      parent.append(list);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'cms-rendered-grid';
    value.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return;
      const card = document.createElement('article');
      card.className = 'cms-rendered-card';
      card.dataset.cmsCard = '';
      const itemPath = `${path}.${index}`;
      const titleKey = ['heading', 'title', 'name', 'role', 'label', 'customer'].find(
        (key) => typeof item[key] === 'string' && item[key]
      );
      if (titleKey) {
        const heading = document.createElement('h3');
        setText(heading, item[titleKey], pathFor(itemPath, titleKey));
        card.append(heading);
      }
      for (const [key, child] of Object.entries(item)) {
        if (key === titleKey || key === 'id' || key === 'type' || /href$/i.test(key)) continue;
        if (typeof child === 'string') renderValue(card, child, pathFor(itemPath, key));
        else if (Array.isArray(child)) renderValue(card, child, pathFor(itemPath, key));
      }
      renderLinks(card, item, itemPath);
      grid.append(card);
    });
    if (grid.childElementCount) parent.append(grid);
  };

  const renderLinks = (parent, value, path) => {
    if (!value || typeof value !== 'object') return;
    const links = [];
    const visit = (item, itemPath, depth) => {
      if (!item || typeof item !== 'object' || depth > 5) return;
      if (Array.isArray(item)) {
        item.forEach((child, index) => visit(child, `${itemPath}.${index}`, depth + 1));
        return;
      }
      const label = item.label ?? item.ctaLabel ?? item.primaryLabel ?? item.secondaryLabel ?? item.buttonLabel;
      const href = item.href ?? item.ctaHref ?? item.primaryHref ?? item.secondaryHref ?? item.buttonHref;
      const hrefKey = item.href ? 'href' : item.ctaHref ? 'ctaHref' : item.primaryHref ? 'primaryHref' : item.secondaryHref ? 'secondaryHref' : 'buttonHref';
      const labelKey = item.label ? 'label' : item.ctaLabel ? 'ctaLabel' : item.primaryLabel ? 'primaryLabel' : item.secondaryLabel ? 'secondaryLabel' : 'buttonLabel';
      if (typeof label === 'string' && safeLink(href)) links.push({ label, href, hrefPath: `${itemPath}.${hrefKey}`, labelPath: `${itemPath}.${labelKey}` });
      Object.entries(item).forEach(([key, child]) => visit(child, `${itemPath}.${key}`, depth + 1));
    };
    visit(value, path, 0);
    if (!links.length) return;
    const actions = document.createElement('div');
    actions.className = 'cms-rendered-actions';
    links.forEach(({ label, href, hrefPath, labelPath }) => {
      const link = document.createElement('a');
      link.href = href;
      link.dataset.cmsHref = hrefPath;
      setText(link, label, labelPath);
      actions.append(link);
    });
    parent.append(actions);
  };

  const renderOne = (section, index, usedAnchors) => {
    if (!section || !types.has(section.type) || typeof section.id !== 'string') return null;
    const root = document.createElement('section');
    root.className = 'cms-rendered-section';
    root.dataset.sectionId = section.id;
    root.dataset.sectionType = section.type;
    const anchor = anchors[section.type];
    root.id = anchor
      ? usedAnchors.has(anchor)
        ? `${anchor}-${index}`
        : anchor
      : `cms-section-${index}`;
    if (anchor) usedAnchors.add(anchor);
    const inner = document.createElement('div');
    inner.className = 'cms-rendered-section__inner';
    const kicker = section.kicker ?? section.pill ?? section.proofLabel;
    if (typeof kicker === 'string') {
      const label = document.createElement('p');
      label.className = 'cms-rendered-kicker';
      setText(label, kicker, `sections.${index}.${section.kicker ? 'kicker' : section.pill ? 'pill' : 'proofLabel'}`);
      inner.append(label);
    }
    const headingValue = section.headline ?? section.heading;
    if (typeof headingValue === 'string' || Array.isArray(headingValue)) {
      const heading = document.createElement(section.type === 'hero' ? 'h1' : 'h2');
      if (Array.isArray(headingValue)) {
        headingValue.forEach((line, lineIndex) => {
          const span = document.createElement('span');
          setText(span, line, `sections.${index}.${section.headline ? 'headline' : 'heading'}.${lineIndex}`);
          heading.append(span);
        });
      } else {
        setText(heading, headingValue, `sections.${index}.${section.headline ? 'headline' : 'heading'}`);
      }
      inner.append(heading);
    }
    for (const key of ['lede', 'body', 'definition']) {
      if (typeof section[key] === 'string') renderValue(inner, section[key], `sections.${index}.${key}`);
    }
    if (section.type === 'image' && safeImage(section.src)) {
      const image = document.createElement('img');
      image.className = 'cms-rendered-image';
      image.src = section.src;
      image.alt = typeof section.alt === 'string' ? section.alt : '';
      image.dataset.cmsImageSrc = `sections.${index}.src`;
      inner.append(image);
      if (typeof section.caption === 'string') renderValue(inner, section.caption, `sections.${index}.caption`);
    }
    for (const [key, value] of Object.entries(section)) {
      if (['id', 'type', 'kicker', 'pill', 'proofLabel', 'headline', 'heading', 'lede', 'body', 'definition', 'src', 'alt', 'caption'].includes(key)) continue;
      if (Array.isArray(value)) renderValue(inner, value, `sections.${index}.${key}`);
    }
    renderLinks(inner, section, `sections.${index}`);
    root.append(inner);
    return root;
  };

  const render = (container, sections, sourceIndexes = sections.map((_, index) => index)) => {
    if (!(container instanceof HTMLElement) || !Array.isArray(sections)) return;
    const active = document.activeElement;
    const activePath = active instanceof HTMLElement ? active.dataset.cms : undefined;
    const selection = active instanceof HTMLElement && active.isContentEditable && window.getSelection()?.rangeCount
      ? window.getSelection().getRangeAt(0).cloneRange()
      : undefined;
    const usedAnchors = new Set();
    const children = sections
      .slice(0, 40)
      .map((section, index) => renderOne(section, sourceIndexes[index] ?? index, usedAnchors))
      .filter(Boolean);
    container.replaceChildren(...children);
    if (activePath) {
      const restored = [...container.querySelectorAll('[data-cms]')].find((item) => item.dataset.cms === activePath);
      if (restored) {
        restored.focus();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(restored);
          range.collapse(false);
          const current = window.getSelection();
          current?.removeAllRanges();
          current?.addRange(range);
        }
      }
    }
  };

  window.LandingRenderer = { render, safeLink };
})();
