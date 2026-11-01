import styles from './wizard.module.scss';

function SetupRequirement({ requirement }: { readonly requirement?: string }) {
  if (!requirement) {
    return null;
  }

  return (
    <p className={styles.hint} role="note">
      <strong>Setup requirement:</strong> {requirement}
    </p>
  );
}

export default SetupRequirement;
