import { readFileSync } from 'node:fs';

const rendererSource = readFileSync(`${process.cwd()}/public/landing/landing-renderer.js`, 'utf8');
const cmsSource = readFileSync(`${process.cwd()}/public/landing/cms.js`, 'utf8');
const elementsSource = readFileSync(`${process.cwd()}/public/landing/landing-elements.js`, 'utf8');
const landingHtml = readFileSync(`${process.cwd()}/public/landing/index.html`, 'utf8');
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
