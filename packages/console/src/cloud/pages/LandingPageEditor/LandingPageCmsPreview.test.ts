import { readFileSync } from 'node:fs';

const rendererSource = readFileSync(`${process.cwd()}/public/landing/landing-renderer.js`, 'utf8');
const cmsSource = readFileSync(`${process.cwd()}/public/landing/cms.js`, 'utf8');
const elementsSource = readFileSync(`${process.cwd()}/public/landing/landing-elements.js`, 'utf8');
const landingHtml = readFileSync(`${process.cwd()}/public/landing/index.html`, 'utf8');
const previewListeners: { cleanup?: () => void } = {};
const sendDraftDocument = (document_: unknown) =>
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      source: window.parent,
      data: { type: 'meshx-cms-draft', doc: document_ },
    })
  );

const postDraft = (sections: unknown[]) => {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      source: window.parent,
      data: { type: 'meshx-cms-draft', doc: { sections } },
    })
  );
};

it('keeps editor actions outside the site header and accepts only its parent toolbar', () => {
  expect(document.querySelector('.cms-element-actions')).toBeNull();
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: 'https://untrusted.example',
      source: window.parent,
      data: { type: 'meshx-cms-open-actions' },
    })
  );
  expect(document.querySelector('.cms-context-menu')).toBeNull();
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      source: window.parent,
      data: { type: 'meshx-cms-open-actions' },
    })
  );
  expect(document.querySelector('.cms-context-menu')).not.toBeNull();
});

beforeEach(() => {
  const windowListeners = jest.spyOn(window, 'addEventListener');
  const documentListeners = jest.spyOn(document, 'addEventListener');
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Dispose only the listeners installed by this test's evaluated preview scripts.
  previewListeners.cleanup = () => {
    for (const [type, listener, options] of windowListeners.mock.calls) {
      window.removeEventListener(type, listener, options);
    }
    for (const [type, listener, options] of documentListeners.mock.calls) {
      document.removeEventListener(type, listener, options);
    }
    windowListeners.mockRestore();
    documentListeners.mockRestore();
  };
  window.history.replaceState({}, '', '/console/landing-preview?cmsPreview=1');
  // The preview-mode guard must observe a parent frame in this jsdom test.
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- define the browser's readonly parent property for iframe simulation.
  Object.defineProperty(window, 'parent', {
    configurable: true,
    value: { postMessage: jest.fn() },
  });
  // eslint-disable-next-line @silverhand/fp/no-mutation -- use the checked-in site HTML as the preview fixture.
  document.body.innerHTML = new DOMParser().parseFromString(
    landingHtml,
    'text/html'
  ).body.innerHTML;
  window.eval(rendererSource);
  window.eval(elementsSource);
  window.eval(cmsSource);
});

const sentMessages = () =>
  jest
    .mocked(window.parent.postMessage)
    .mock.calls.map(([data]) => data as Record<string, unknown>);

const sentSelections = () =>
  sentMessages()
    .filter((data) => data.type === 'meshx-cms-select-element')
    .map((data) => data.selection as { kind?: string });

const pointer = (target: EventTarget, type: string, clientX: number, clientY: number) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
  });
  // eslint-disable-next-line @silverhand/fp/no-mutating-methods -- jsdom lacks PointerEvent; add the pointer identity to this test event only.
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
};

it('drags a selected image from its saved offsets and commits only once on release', () => {
  const image = document.querySelector<HTMLElement>('footer img')!;
  const id = image.dataset.cmsElement!;
  sendDraftDocument({ elements: { [id]: { x: 20, y: -10 } } });
  image.click();
  const handle = document.querySelector<HTMLButtonElement>('.cms-move-handle')!;
  expect(handle).not.toBeNull();
  pointer(handle, 'pointerdown', 100, 100);
  pointer(handle, 'pointermove', 130, 120);
  expect(image.style.translate).toBe('50px 10px');
  expect(sentMessages().filter(({ type }) => type === 'meshx-cms-move')).toHaveLength(0);
  pointer(handle, 'pointerup', 130, 120);
  expect(sentMessages().filter(({ type }) => type === 'meshx-cms-move')).toEqual([
    { type: 'meshx-cms-move', id, x: 50, y: 10 },
  ]);
});

it('cancels a drag without saving and supports bounded keyboard nudges', () => {
  const image = document.querySelector<HTMLElement>('footer img')!;
  image.click();
  const originalTranslate = image.style.translate;
  const handle = document.querySelector<HTMLButtonElement>('.cms-move-handle')!;
  expect(handle).not.toBeNull();
  pointer(handle, 'pointerdown', 0, 0);
  pointer(handle, 'pointermove', 50, 60);
  handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(image.style.translate).toBe(originalTranslate);
  expect(sentMessages().filter(({ type }) => type === 'meshx-cms-move')).toHaveLength(0);
  handle.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true })
  );
  expect(sentMessages()).toContainEqual({
    type: 'meshx-cms-move',
    id: image.dataset.cmsElement,
    x: 10,
    y: 0,
  });
  handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(sentMessages()).toContainEqual({
    type: 'meshx-cms-move',
    id: image.dataset.cmsElement,
    x: 11,
    y: 0,
  });
});

it('bounds image moves and restores the starting position on pointer cancellation', () => {
  const image = document.querySelector<HTMLElement>('footer img')!;
  image.click();
  const handle = document.querySelector<HTMLButtonElement>('.cms-image-drag-handle')!;
  pointer(handle, 'pointerdown', 0, 0);
  pointer(handle, 'pointermove', 1000, -1000);
  expect(image.style.translate).toBe('400px -400px');
  pointer(handle, 'pointercancel', 1000, -1000);
  expect(sentMessages().filter(({ type }) => type === 'meshx-cms-move')).toHaveLength(0);
  pointer(handle, 'pointerdown', 0, 0);
  pointer(handle, 'pointermove', 1000, -1000);
  pointer(handle, 'pointerup', 1000, -1000);
  expect(sentMessages()).toContainEqual({
    type: 'meshx-cms-move',
    id: image.dataset.cmsElement,
    x: 400,
    y: -400,
  });
});

it('selects header links and images with element-specific properties rather than navigating', () => {
  const link = document.querySelector<HTMLElement>('header a[href]:not(:has(svg))');
  expect(link).not.toBeNull();
  link?.click();
  expect(sentSelections().map((selection) => selection.kind)).toContain('navigation');

  const image = document.querySelector<HTMLElement>('footer img');
  image?.click();
  expect(sentSelections().map((selection) => selection.kind)).toContain('image');
});

it('opens contextual editing actions with keyboard access and restores focus on Escape', () => {
  const link = document.querySelector<HTMLElement>('header a[href]:not(:has(svg))');
  link?.focus();
  link?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
  expect(document.querySelector('.cms-context-menu')?.textContent).toContain('Edit navigation');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(document.querySelector('.cms-context-menu')).toBeNull();
  expect(document.activeElement).toBe(link);
});

it('applies and then removes page-level overrides without destroying authored icons', () => {
  const link = document.querySelector<HTMLElement>('header a[href]:not(:has(svg))');
  const id = link?.dataset.cmsElement;
  const original = link?.textContent;
  sendDraftDocument({
    elements: { [id ?? '']: { text: 'Edited navigation', href: '/new-destination' } },
  });
  expect(link?.textContent).toContain('Edited navigation');
  expect(link?.getAttribute('href')).toBe('/new-destination');
  sendDraftDocument({ elements: {} });
  expect(link?.textContent).toBe(original);
});

afterEach(() => {
  previewListeners.cleanup?.();
  window.history.replaceState({}, '', '/');
});

it('keeps authored sections visible and applies section draft copy to their original markup', () => {
  const document_ = {
    sections: [
      { id: 'hero', type: 'hero', headline: ['Draft hero'] },
      { id: 'fomo', type: 'fomo', definition: 'Draft definition' },
    ],
  };

  // Use the same message event the preview bridge listens for, with the parent
  // frame as source so the test exercises its origin/source guards.
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      source: window.parent,
      data: { type: 'meshx-cms-draft', doc: document_ },
    })
  );

  expect(document.querySelector<HTMLElement>('#top')?.hidden).toBe(false);
  expect(document.querySelector('#top h1')?.textContent).toBe('Draft hero');
  expect(document.querySelector<HTMLElement>('#missing-layer')?.hidden).toBe(false);
  expect(document.querySelector('#missing-layer')?.textContent).toContain('Draft definition');
  expect(document.querySelectorAll('main > section')).toHaveLength(11);
  expect(document.querySelector('.cms-rendered-section')).toBeNull();
});

it('uses the live section index when an in-place preview edit is sent back', () => {
  const document_ = { sections: [{ id: 'hero', type: 'hero', headline: ['Draft hero'] }] };

  window.dispatchEvent(
    new MessageEvent('message', {
      origin: window.location.origin,
      source: window.parent,
      data: { type: 'meshx-cms-draft', doc: document_ },
    })
  );

  const headline = document.querySelector<HTMLElement>('[data-cms]');
  expect(headline?.dataset.cms).toBe('sections.0.headline.0');
});

it('updates an active field path when Puck reorders its section', () => {
  postDraft([
    { id: 'hero', type: 'hero', headline: ['Draft hero'] },
    { id: 'fomo', type: 'fomo', definition: 'Draft definition' },
  ]);

  const headline = document.querySelector<HTMLElement>('[data-cms]');
  headline?.focus();

  postDraft([
    { id: 'fomo', type: 'fomo', definition: 'Draft definition' },
    { id: 'hero', type: 'hero', headline: ['Draft hero'] },
  ]);

  expect(headline?.dataset.cms).toBe('sections.1.headline.0');
});

it('makes the copy that no structured field covers editable in place', () => {
  const cardTitle = document.querySelector<HTMLElement>('#products [data-slot="card-title"]');

  expect(cardTitle?.getAttribute('contenteditable')).toBe('true');
  expect(cardTitle?.dataset.cmsCopy).toMatch(/^products-\d+$/);
});

it('wraps the words that sit next to a graphic, so the graphic stays', () => {
  const lede = document.querySelector<HTMLElement>('#top p.mt-6');
  const words = lede?.querySelector<HTMLElement>('span[data-cms-copy]');

  expect(words?.textContent).toContain('The intelligence layer');
  expect(words?.getAttribute('contenteditable')).toBe('true');
  expect(lede?.querySelector('br')).not.toBeNull();
});

it('applies a stored copy override to the marked text', () => {
  const cardTitle = document.querySelector<HTMLElement>('#products [data-slot="card-title"]');
  const id = cardTitle?.dataset.cmsCopy ?? '';

  sendDraftDocument({ copy: { [id]: { en: 'Edited card title' } } });

  expect(cardTitle?.textContent).toBe('Edited card title');
});

it('sends an edited text back under its own copy path', async () => {
  const cardTitle = document.querySelector<HTMLElement>('#products [data-slot="card-title"]');
  cardTitle!.textContent = 'Edited card title';
  cardTitle!.dispatchEvent(new Event('input', { bubbles: true }));
  // The preview waits a moment before it sends the text, so it does not send every keystroke.
  await new Promise((resolve) => {
    setTimeout(resolve, 200);
  });

  expect(sentMessages().filter(({ type }) => type === 'meshx-cms-edit')).toEqual([
    {
      type: 'meshx-cms-edit',
      path: `copy.${cardTitle?.dataset.cmsCopy}.en`,
      value: 'Edited card title',
    },
  ]);
});
