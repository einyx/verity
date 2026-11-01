const normalize = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/** Shared classification for exports and outbound-contact eligibility. Never infers consent. */
export const isSyntheticLandingLead = ({
  email,
  profile,
  tags,
}: {
  readonly email?: unknown;
  readonly profile?: {
    syntheticContact?: unknown;
    researchStatus?: unknown;
    domain?: unknown;
  } | null;
  readonly tags?: unknown;
}): boolean => {
  const domains = [
    typeof email === 'string' ? email.split('@').at(-1) : undefined,
    profile?.domain,
  ];
  return (
    profile?.syntheticContact === true ||
    ['synthetic', 'demo-data', 'fixture'].includes(normalize(profile?.researchStatus)) ||
    (Array.isArray(tags) &&
      tags.some((tag: unknown) =>
        ['synthetic', 'demo-data', 'demo data', 'test-data', 'fixture'].includes(normalize(tag))
      )) ||
    domains.some((value) => {
      const domain = normalize(value);
      return domain === 'example.invalid' || domain.endsWith('.example.invalid');
    })
  );
};
