import congratsImage from '@/assets/images/congrats.svg?url';
import organizationImage from '@/assets/images/organization-empty.svg?url';
import welcomeImage from '@/assets/images/wizard/inspired-intro.svg?url';

import styles from '../index.module.scss';

// Vertical stepper: each step has a title, a short description and an image.
// Completed steps stay clickable so users can go back and change an answer.
const steps = [
  {
    title: 'Choose a workspace',
    text: 'Pick a workspace type. Each type starts from an approved template.',
    image: welcomeImage,
  },
  {
    title: 'Set the tenant',
    text: 'Enter the tenant ID. Mode is optional.',
    image: organizationImage,
  },
  {
    title: 'Review and create',
    text: 'Check the rendered YAML before you create the workspace.',
    image: congratsImage,
  },
];

export function StepIntro({
  step,
  onStepChange,
}: {
  readonly step: 1 | 2 | 3;
  readonly onStepChange: (number: number) => void;
}) {
  return (
    <>
      <img className={styles.stepImage} src={steps[step - 1]?.image} alt="" />
      <ol className={styles.stepper} aria-label={`Step ${step} of 3`}>
        {steps.map((item, index) => {
          const number = index + 1;
          const isActive = number === step;
          const isDone = number < step;
          return (
            <li
              key={item.title}
              className={styles.stepItem}
              aria-current={isActive ? 'step' : undefined}
            >
              <button
                type="button"
                className={styles.stepButton}
                disabled={number > step}
                onClick={() => {
                  onStepChange(number);
                }}
              >
                <span
                  className={`${styles.stepBubble} ${isActive ? styles.stepBubbleActive : ''} ${isDone ? styles.stepBubbleDone : ''}`}
                >
                  {number}
                </span>
                <span className={styles.stepText}>
                  <span className={isActive ? styles.stepTitleActive : styles.stepTitle}>
                    {item.title}
                  </span>
                  {isActive && <span className={styles.stepDescription}>{item.text}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}
