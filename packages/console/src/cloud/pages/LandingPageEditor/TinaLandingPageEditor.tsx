import { useLandingPage } from '@/cloud/hooks/use-landing-page';

// Spike placeholder for TinaCMS integration.
//
// The previous attempt to `import { useForm } from 'tinacms'` does not work with the
// current tinacms v2 package exports (it exposes Form, FormBuilder etc. but the
// hook pattern for arbitrary forms is different and normally requires a TinaProvider
// + schema-driven setup or @tinacms/toolkit).
//
// For now this is a non-crashing stub so the Landing page editor can be visited
// without import/runtime errors (which were surfacing as or compounding auth issues
// on tenant switch).
//
// Full Tina visual editing (in-place on the live preview iframe) will be wired by
// expanding the schema in tina/config.ts, adding a proper <TinaProvider>, using
// Tina's <InlineForm> / field plugins or their iframe preview bridge, and syncing
// saves through the existing useLandingPage + saveDraft/publish.

// eslint-disable-next-line import/no-unused-modules
export function TinaLandingPageEditor() {
  const { data, error } = useLandingPage();

  if (error) {
    return (
      <div style={{ padding: 16, color: '#b00' }}>
        Error loading landing page data: {error.message}
      </div>
    );
  }

  if (!data) {
    return <div style={{ padding: 16 }}>Loading landing page editor…</div>;
  }

  return (
    <div style={{ padding: 16, border: '1px dashed #ccc', background: '#fafafa' }}>
      <h3>TinaCMS live editor (spike – not yet wired)</h3>
      <p>
        Using the live rendered preview below (iframe). Direct in-place Tina visual editing will be
        enabled here in a follow-up.
      </p>
      <p style={{ fontSize: 12, opacity: 0.7 }}>
        {/* eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- data.draft may be falsy per schema */}
        Draft keys present: {Object.keys(data.draft || {}).join(', ') || 'none'}
      </p>
      {/* In a real integration the Tina fields / visual chrome would live here or wrap the preview */}
    </div>
  );
}
