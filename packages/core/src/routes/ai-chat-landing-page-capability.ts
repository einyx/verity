import RequestError from '#src/errors/RequestError/index.js';

type LandingPageCapability = 'authorized' | 'authentication_required' | 'forbidden' | 'unavailable';

/** Only classify backend verification failures; never expose credential values or raw errors. */
export const landingPageCapabilityFailure = (
  error: unknown
): Exclude<LandingPageCapability, 'authorized'> => {
  if (error instanceof RequestError && error.status === 401) {
    return 'authentication_required';
  }
  if (error instanceof RequestError && error.status === 403) {
    return 'forbidden';
  }
  return 'unavailable';
};

export const resolveLandingPageCapability = async (
  getToken: () => Promise<string>
): Promise<LandingPageCapability> => {
  try {
    return (await getToken()) ? 'authorized' : 'authentication_required';
  } catch (error) {
    return landingPageCapabilityFailure(error);
  }
};

export const landingPageCapabilityMessage = (capability: LandingPageCapability) =>
  ({
    authorized:
      'Landing-page editing is verified and available. Generate a proposed edit for preview; only explicit Save confirmation saves the page draft. Publishing remains separate.',
    authentication_required:
      'The landing-page credential is missing, invalid or expired. Refresh your session and retry. Editing permissions have not been determined. No page or Save proposal was changed.',
    forbidden:
      'The verified landing-page credential does not authorize this operation for the current user. No page or Save proposal was changed.',
    unavailable:
      'Landing-page credential verification is temporarily unavailable. This is not evidence of missing editing permission. No page or Save proposal was changed.',
  })[capability];
