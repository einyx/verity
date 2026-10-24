import { linkedinProfile } from './landing-page-brief.js';

const lead = (contactMethod: string | undefined, contactDetail: string | undefined) => ({
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  company: 'Example',
  contactMethod,
  contactDetail,
});

describe('linkedinProfile', () => {
  it('returns an https linkedin.com profile link when LinkedIn was chosen', () => {
    expect(linkedinProfile(lead('linkedin', 'https://www.linkedin.com/in/ada'))).toBe(
      'https://www.linkedin.com/in/ada'
    );
  });

  it('ignores the detail when another contact method was chosen', () => {
    expect(linkedinProfile(lead('email', 'https://www.linkedin.com/in/ada'))).toBeUndefined();
  });

  it('rejects a link to another site, an http link, and a lookalike host', () => {
    expect(linkedinProfile(lead('linkedin', 'https://example.com/in/ada'))).toBeUndefined();
    expect(linkedinProfile(lead('linkedin', 'http://www.linkedin.com/in/ada'))).toBeUndefined();
    expect(
      linkedinProfile(lead('linkedin', 'https://linkedin.com.evil.test/in/ada'))
    ).toBeUndefined();
  });

  it('returns undefined for text that is not a URL', () => {
    expect(linkedinProfile(lead('linkedin', 'ada on linkedin'))).toBeUndefined();
  });
});
