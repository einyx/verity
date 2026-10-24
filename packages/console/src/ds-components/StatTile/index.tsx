import { conditionalString } from '@silverhand/essentials';
import classNames from 'classnames';
import type { ReactNode } from 'react';

import ArrowDown from '@/assets/icons/arrow-down.svg?react';
import ArrowUp from '@/assets/icons/arrow-up.svg?react';
import Tip from '@/assets/icons/tip.svg?react';
import Card from '@/ds-components/Card';
import IconButton from '@/ds-components/IconButton';
import { ToggleTip } from '@/ds-components/Tip';
import type { Props as ToggleTipProps } from '@/ds-components/Tip/ToggleTip';
import { formatNumberWithComma } from '@/utils/number';

import styles from './index.module.scss';

type Props = {
  readonly title: ReactNode;
  readonly count: number;
  readonly delta?: number;
  readonly tip?: ToggleTipProps['content'];
  readonly variant?: 'default' | 'bordered' | 'plain';
  /** The Dashboard treatment by default; Leads uses the mono eyebrow label. */
  readonly appearance?: 'default' | 'eyebrow';
  readonly className?: string;
};

export default function StatTile({
  variant = 'default',
  appearance = 'default',
  count,
  delta,
  title,
  tip,
  className,
}: Props) {
  const deltaLabel = delta !== undefined && `${conditionalString(delta >= 0 && '+')}${delta}`;

  return (
    <Card
      className={classNames(
        styles.block,
        styles[variant],
        appearance === 'eyebrow' && styles.eyebrow,
        className
      )}
    >
      <div className={styles.title}>
        {title}
        {tip && (
          <ToggleTip anchorClassName={styles.toggleTipButton} content={tip}>
            <IconButton size="small">
              <Tip />
            </IconButton>
          </ToggleTip>
        )}
      </div>
      <div className={styles.content}>
        <div className={styles.number}>{formatNumberWithComma(count)}</div>
        {delta !== undefined && (
          <div className={classNames(styles.delta, delta < 0 && styles.down)}>
            <span>({deltaLabel})</span>
            {delta > 0 && <ArrowUp />}
            {delta < 0 && <ArrowDown />}
          </div>
        )}
      </div>
    </Card>
  );
}
