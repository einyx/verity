import { isPrysmDarkBranding } from './prysm-dark-branding';

describe('isPrysmDarkBranding', () => {
  it('recognizes the Prysm Dark sign-in template', () => {
    expect(isPrysmDarkBranding({ primaryColor: '#1F1F23', isDarkModeEnabled: true })).toBe(true);
  });

  it('does not match when dark mode is disabled', () => {
    expect(isPrysmDarkBranding({ primaryColor: '#1f1f23', isDarkModeEnabled: false })).toBe(false);
  });

  it('does not match another dark branding color', () => {
    expect(isPrysmDarkBranding({ primaryColor: '#6139F6', isDarkModeEnabled: true })).toBe(false);
  });
});
