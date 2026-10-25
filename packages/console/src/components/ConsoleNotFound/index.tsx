import { joinPath } from '@silverhand/essentials';
import { Navigate, useLocation, useParams } from 'react-router-dom';

import NotFound from '@/pages/NotFound';

type Props = {
  /** The console pages that exist under the tenant root. */
  readonly pagePaths: readonly string[];
};

/**
 * The console falls back to the not-found page when no route matches the path.
 *
 * A path that starts with a page that does exist is nearly always a stale link: an older build
 * resolved a relative link against the page that was open, so the path piled up
 * (`/dashboard/leads/landing-page`). Such a path goes to the page it starts with instead of a dead
 * end. Any other unknown path still renders the not-found page.
 */
function ConsoleNotFound({ pagePaths }: Props) {
  const { tenantId } = useParams();
  const location = useLocation();

  // The path under the tenant root, e.g. `dashboard/leads/landing-page`.
  const relativePath = location.pathname
    .split('/')
    .slice(tenantId ? 2 : 1)
    .join('/');
  const [firstSegment] = relativePath.split('/');

  if (tenantId && firstSegment && pagePaths.includes(firstSegment)) {
    const target = joinPath(tenantId, firstSegment);

    // The path is the page itself, so there is nothing to recover from.
    if (target !== location.pathname) {
      return <Navigate replace to={target} />;
    }
  }

  return <NotFound />;
}

export default ConsoleNotFound;
