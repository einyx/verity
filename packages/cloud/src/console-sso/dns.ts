import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';

/** Looks up TXT records for a name. Each record is a list of string chunks, as DNS returns them. */
export type TxtResolver = (name: string) => Promise<string[][]>;

export const defaultTxtResolver: TxtResolver = resolveTxt;

/** The DNS name the customer publishes the challenge record at. */
export const challengeRecordName = (domain: string) => `_meshx-console-sso.${domain}`;

/** The TXT value that proves control of the domain. Scoped by a random token per challenge. */
export const challengeRecordValue = (token: string) => `meshx-console-sso=${token}`;

export const createChallengeToken = () => randomBytes(24).toString('base64url');

/**
 * Whether the domain publishes the expected challenge record. A lookup failure (no record, NXDOMAIN,
 * timeout) counts as not verified, so the caller can retry once the record propagates.
 */
export const isDomainChallengeSatisfied = async (
  domain: string,
  token: string,
  resolve: TxtResolver = defaultTxtResolver
): Promise<boolean> => {
  try {
    const records = await resolve(challengeRecordName(domain));
    const expected = challengeRecordValue(token);

    return records.some((chunks) => chunks.join('') === expected);
  } catch {
    return false;
  }
};
