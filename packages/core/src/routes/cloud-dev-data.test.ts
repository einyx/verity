import { routes } from './cloud-dev-data.js';

describe('local cloud invitations stand-in', () => {
  it('answers the tenant invitations list with the billing response shape', () => {
    const match = routes.find(([pattern]) => pattern.test('/api/tenants/t1/invitations'));

    expect(match?.[1]()).toEqual({ invitations: [] });
  });
});
