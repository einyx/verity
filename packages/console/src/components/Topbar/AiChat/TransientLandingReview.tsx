import { type LandingPageDocument } from '@logto/schemas';

import ReadOnlyLandingPreview from './ReadOnlyLandingPreview';
import useReviewExpiry from './use-review-expiry';

export type TransientPreview = { draft: LandingPageDocument; expiresAt: string };

export default function TransientLandingReview({ preview, onDiscard }: {
  readonly preview: TransientPreview;
  readonly onDiscard: () => void;
}) {
  const expired = useReviewExpiry(preview.expiresAt);
  return (
    <section aria-label="Read-only landing page review">
      <h3>Landing page suggestion · preview only</h3>
      <p>No page or Save proposal is saved. This preview disappears when discarded, expired, or you leave this conversation. Account chat drafts/history follow their existing save settings.</p>
      {expired ? <p role="status">Preview expired. Request a new review to see a fresh suggestion.</p> : <ReadOnlyLandingPreview document={preview.draft} />}
      <button type="button" onClick={onDiscard}>Discard preview</button>
    </section>
  );
}
