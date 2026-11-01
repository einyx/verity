import { Theme } from '@logto/schemas';
import { render, screen } from '@testing-library/react';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import { mockSignInExperienceSettings } from '@/__mocks__/logto';

import LandingPageLayout from '.';

describe('LandingPageLayout branding', () => {
  it.each([
    ['meshx dark branding', '#fe330a', '/meshx-logo-dark.svg'],
    ['custom branding', '#123456', 'https://example.com/custom-dark.svg'],
  ])('uses the public experience asset for %s', (_, primaryColor, expectedLogo) => {
    render(
      <PageContext.Consumer>
        {(context) => (
          <PageContext.Provider
            value={{
              ...context,
              theme: Theme.Dark,
              experienceSettings: {
                ...mockSignInExperienceSettings,
                color: {
                  ...mockSignInExperienceSettings.color,
                  primaryColor,
                  isDarkModeEnabled: true,
                },
                branding: {
                  logoUrl: 'https://example.com/custom.svg',
                  darkLogoUrl: 'https://example.com/custom-dark.svg',
                },
              },
            }}
          >
            <LandingPageLayout title="description.sign_in_to_your_account">
              Sign-in form
            </LandingPageLayout>
          </PageContext.Provider>
        )}
      </PageContext.Consumer>
    );

    expect(screen.getByRole('img', { name: 'app logo' }).getAttribute('src')).toBe(expectedLogo);
    expect(screen.getByText('Sign-in form')).not.toBeNull();
  });
});
