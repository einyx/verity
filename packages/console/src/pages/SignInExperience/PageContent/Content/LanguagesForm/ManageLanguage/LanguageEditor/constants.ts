import {
  type LocalePhraseGroupKey,
  type LocalePhraseKey,
} from '@logto/phrases-experience/lib/types';

/**
 * List of locale phrase groups that should be hidden from the experience UI language editor.
 *
 * Note:
 * - Not allowed customized phrases groups should be added here. Currently only the `development_tenant` group is not allowed.
 *
 * - Unreleased feature phrase group keys should be added here while the feature is not yet released.
 * @example
 * ```ts
 * export const hiddenLocalePhraseGroups: readonly LocalePhraseGroupKey[] = [
 *  'development_tenant',
 *  ...conditionalArray(!isUnreleasedFeatureEnabled && 'mfa'),
 * ];
 * ```
 */
export const hiddenLocalePhraseGroups: readonly LocalePhraseGroupKey[] = ['development_tenant'];

/**
 * List of locale phrase key that should be hidden from the experience UI language editor.
 *
 * Note:
 * Unreleased feature phrase keys should be added here while the feature is not yet released.
 * @example
 * ```ts
 * export const hiddenLocalePhrases: readonly LocalePhraseKey[] = [
 * ...conditionalArray(
 *    !isUnreleasedFeatureEnabled &&
 *      ([
 *        'action.copy',
 *        'action.verify_via_passkey',
 *        'action.download',
 *        'input.backup_code',
 *      ] satisfies LocalePhraseKey[])
 *  ),
 * ];
 * ```
 */
export const hiddenLocalePhrases: readonly LocalePhraseKey[] = [];
