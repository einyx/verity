import type { Nullable } from '@silverhand/essentials';
import type { RefObject } from 'react';

export type AppContentOutletContext = {
  scrollableContent: RefObject<Nullable<HTMLDivElement>>;
};
