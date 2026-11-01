import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';

import { defaultLandingPageContent } from '@logto/schemas';
import { waitFor } from '@testing-library/react';

it('renders the structured hero introduction from the published-document fetch path', async () => {
  const landing = `${process.cwd()}/public/landing`;
  const html = readFileSync(`${landing}/index.html`, 'utf8');
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  document.body.replaceChildren(...body.childNodes);
  document.documentElement.setAttribute('lang', 'en');
  window.history.replaceState({}, '', '/');
  const published = {
    ...defaultLandingPageContent,
    sections: defaultLandingPageContent.sections.map((section) =>
      section.type === 'hero' ? { ...section, lede: 'Published intro' } : section
    ),
  };
  const NodeResponse = runInThisContext('Response') as typeof Response;
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Serve an isolated published fixture rather than contacting a real API.
  window.fetch = jest.fn(
    async () => new NodeResponse(JSON.stringify({ published }))
  ) as unknown as typeof fetch;
  window.eval(readFileSync(`${landing}/landing-renderer.js`, 'utf8'));
  window.eval(readFileSync(`${landing}/landing-elements.js`, 'utf8'));
  window.eval(readFileSync(`${landing}/cms.js`, 'utf8'));
  await waitFor(() => {
    expect(document.querySelector('#top [data-cms="sections.0.lede"]')?.textContent).toBe(
      'Published intro'
    );
  });
});
