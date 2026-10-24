import type { AdminConsoleKey } from '@logto/phrases';

import DynamicT from '@/ds-components/DynamicT';
import StatTile from '@/ds-components/StatTile';
import type { Props as ToggleTipProps } from '@/ds-components/Tip/ToggleTip';

type Props = {
  readonly count: number;
  readonly delta?: number;
  readonly title: AdminConsoleKey;
  readonly tip?: ToggleTipProps['content'];
  readonly variant?: 'bordered' | 'default' | 'plain';
};

function Block({ variant = 'default', count, delta, title, tip }: Props) {
  return (
    <StatTile
      title={<DynamicT forKey={title} />}
      count={count}
      delta={delta}
      tip={tip}
      variant={variant}
    />
  );
}

export default Block;
