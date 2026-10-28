import styles from './index.module.scss';

const devices = [
  { label: 'Mobile', width: 390 },
  { label: 'Tablet', width: 768 },
  { label: 'Desktop', width: 1280 },
] as const;

function PreviewDeviceSwitch({
  width,
  onChange,
}: {
  readonly width: number;
  readonly onChange: (width: number) => void;
}) {
  return (
    <div role="group" aria-label="Preview device" className={styles.previewDevices}>
      {devices.map((device) => (
        <button
          key={device.label}
          type="button"
          aria-pressed={width === device.width}
          title={`${device.width}px wide`}
          onClick={() => {
            onChange(device.width);
          }}
        >
          {device.label}
        </button>
      ))}
    </div>
  );
}

export default PreviewDeviceSwitch;
