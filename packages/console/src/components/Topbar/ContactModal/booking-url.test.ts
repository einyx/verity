import { parseContactBookingUrl } from './booking-url';

it('does not invent a personal booking destination', () => {
  expect(parseContactBookingUrl()).toBeUndefined();
  expect(parseContactBookingUrl('')).toBeUndefined();
});

it('accepts only an explicitly configured credential-free HTTPS destination', () => {
  expect(parseContactBookingUrl('https://meet.example.invalid/team')).toBe(
    'https://meet.example.invalid/team'
  );
  for (const value of [
    'http://example.invalid',
    // eslint-disable-next-line no-script-url -- Rejection fixture, never rendered or executed.
    'javascript:alert(1)',
    'https://user:pass@example.invalid',
    'not a URL',
  ]) {
    expect(parseContactBookingUrl(value)).toBeUndefined();
  }
});
