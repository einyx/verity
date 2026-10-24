import { readFileSync } from 'node:fs';

const rendererSource = readFileSync(`${process.cwd()}/public/landing/landing-renderer.js`, 'utf8');
type RendererWindow = Window & {
  LandingRenderer: {
    render: (container: HTMLElement, sections: unknown[], sourceIndexes?: number[]) => void;
  };
};
const getContainer = () => {
  const container = document.querySelector<HTMLElement>('#rendered');
  if (!container) {
    throw new Error('Renderer test container was not created.');
  }
  return container;
};

beforeEach(() => {
  document.body.replaceChildren(document.createElement('main'));
  document.body.firstElementChild?.insertAdjacentHTML('beforeend', '<div id="rendered"></div>');
  window.eval(rendererSource);
});

it('renders sections in document order and renders repeated built-ins independently', () => {
  const container = document.querySelector('#rendered');
  const sections = [
    { id: 'hero-main', type: 'hero', headline: ['First', 'headline'], lede: 'Intro' },
    {
      id: 'agents-copy',
      type: 'agents',
      heading: ['Agents'],
      cards: [{ title: 'First card', body: 'One' }],
    },
    {
      id: 'agents-copy-2',
      type: 'agents',
      heading: ['More agents'],
      cards: [{ title: 'Second card', body: 'Two' }],
    },
  ];

  (window as unknown as RendererWindow).LandingRenderer.render(getContainer(), sections);

  expect(
    [...getContainer().querySelectorAll<HTMLElement>('[data-section-id]')].map(
      (item) => item.dataset.sectionId
    )
  ).toEqual(['hero-main', 'agents-copy', 'agents-copy-2']);
  expect(getContainer().textContent).toContain('Second card');
});

it('keeps section edit paths tied to their original document indexes when rendering fallback sections', () => {
  (window as unknown as RendererWindow).LandingRenderer.render(
    getContainer(),
    [{ id: 'text-1', type: 'text', heading: 'Fallback section' }],
    [7]
  );

  expect(getContainer().querySelector('[data-cms="sections.7.heading"]')).not.toBeNull();
});

it('renders variable card collections and treats copy as text while rejecting unsafe destinations', () => {
  const container = document.querySelector('#rendered');
  const sections = [
    {
      id: 'products-1',
      type: 'products',
      heading: ['Products'],
      products: Array.from({ length: 7 }, (_, index) => ({
        name: `Product ${index}`,
        body: '<img src=x onerror=alert(1)>',
        ctaLabel: 'Open',
        ctaHref: `${['java', 'script'].join('')}:alert(1)`,
      })),
    },
  ];

  (window as unknown as RendererWindow).LandingRenderer.render(getContainer(), sections);

  expect(getContainer().querySelectorAll('.cms-rendered-card')).toHaveLength(7);
  expect(getContainer().querySelector('img[onerror]')).toBeNull();
  expect(getContainer().querySelector('a[href^="javascript:"]')).toBeNull();
  expect(getContainer().textContent).toContain('<img src=x onerror=alert(1)>');
});
