import { allowUploadMimeTypes, maxUploadFileSize } from '@logto/schemas';
import { useState } from 'react';

import FileUploader from '@/ds-components/Uploader/FileUploader';
import useApi from '@/hooks/use-api';

export default function LandingImageSourceField({
  value,
  onChange,
  label = 'Image URL',
}: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly label?: string;
}) {
  const api = useApi();
  const [error, setError] = useState<string>();

  return (
    <div>
      <label>
        <span>{label}</span>
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </label>
      <FileUploader
        apiInstance={api}
        maxSize={maxUploadFileSize}
        allowedMimeTypes={allowUploadMimeTypes.filter((type) => type.startsWith('image/'))}
        actionDescription="Upload or replace this section image"
        onUploadErrorChange={setError}
        onUploadComplete={({ url }) => {
          if (typeof url === 'string') {
            onChange(url);
          }
        }}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
