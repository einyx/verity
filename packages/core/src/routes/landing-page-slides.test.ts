import { buildSlidesDeck } from './landing-page-slides.js';

describe('buildSlidesDeck', () => {
  it('returns a PPTX file, which is a ZIP archive, built from the lead and the profile', async () => {
    const file = await buildSlidesDeck(
      {
        lead: {
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          company: 'Example Air',
          role: 'COO',
        },
        profile: {
          summary: 'A regional carrier looking at turnaround times.',
          sources: ['Turnaround efficiency'],
          conversation: {
            outcomes: ['Wants a shared view of delays'],
            nextSteps: ['Book a working session'],
          },
        },
        bookingUrl: 'https://example.com/book',
      },
      '2026-10-21'
    );

    // ZIP local file header signature: "PK\x03\x04".
    expect(file.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    expect(file.length).toBeGreaterThan(1000);
  });
});
