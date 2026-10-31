import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import styles from './index.module.scss';

function FittedPreview({
  width,
  children,
}: {
  readonly width: number;
  readonly children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState<number>();
  const scale = availableWidth ? Math.min(1, availableWidth / width) : 1;
  const viewportStyle: CSSProperties & { '--preview-scale': number } = {
    width: width * scale,
    '--preview-scale': scale,
  };

  useEffect(() => {
    const element = container.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      // Compact panels remain mounted while hidden. Keep their last useful measurement.
      if (entry && entry.contentRect.width > 0) {
        setAvailableWidth(entry.contentRect.width);
      }
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={container} className={styles.fittedPreview}>
      <span className={styles.previewZoom} aria-label="Preview zoom">
        Fit · {Math.round(scale * 100)}%
      </span>
      <div className={styles.fittedPreviewViewport} style={viewportStyle}>
        {children}
      </div>
    </div>
  );
}

export default FittedPreview;
