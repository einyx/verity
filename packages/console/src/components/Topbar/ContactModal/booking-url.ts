/** Public build configuration only: never put access credentials in a booking URL. */
export const parseContactBookingUrl = (value?: unknown): string | undefined => {
  if (typeof value !== 'string' || !value.trim()) {
    return;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {}
};
