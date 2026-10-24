import { isMeshxDarkBranding } from './meshx-dark-branding';

describe('isMeshxDarkBranding', () => {
  it('recognizes the MeshX Dark sign-in template', () => {
    expect(isMeshxDarkBranding({ primaryColor: '#DA2C09', isDarkModeEnabled: true })).toBe(true);
    expect(isMeshxDarkBranding({ primaryColor: '#FE330A', isDarkModeEnabled: true })).toBe(true);
  });

  it('does not match when dark mode is disabled', () => {
    expect(isMeshxDarkBranding({ primaryColor: '#fe330a', isDarkModeEnabled: false })).toBe(false);
  });

  it('does not match another dark branding color', () => {
    expect(isMeshxDarkBranding({ primaryColor: '#6139F6', isDarkModeEnabled: true })).toBe(false);
  });
});
