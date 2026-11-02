import { Theme } from '@logto/schemas';
import { useEffect, useRef } from 'react';

import RequestDataError from '@/components/RequestDataError';
import useTheme from '@/hooks/use-theme';

import { useKuboAccess } from '../KuboAccess';
import useKuboResource from '../use-kubo-resource';

import { mountKshows } from './kshows/app.js';
import markup from './kshows/markup.html?raw';
import style from './kshows/style.css?inline';
import tokens from './kshows/tokens.css?inline';

function Capacity() {
  const { operator, scope } = useKuboAccess();
  const snapshot = useKuboResource<unknown>(operator ? 'api/kubo/kshows' : undefined, scope, {
    refreshInterval: 10_000,
  });
  const container = useRef<HTMLDivElement>(null);
  const renderer = useRef<((data: unknown) => void) | undefined>(undefined);
  const theme = useTheme();
  useEffect(() => {
    const host = container.current;
    if (!host || !operator) {
      return;
    }
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Trusted static markup owned by this context's imperative renderer.
    host.innerHTML = markup;
    const mounted = mountKshows(host);
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Renderer handle is local to this mounted authorized root.
    renderer.current = mounted.apply;
    return () => {
      mounted.dispose();
      // eslint-disable-next-line @silverhand/fp/no-mutation -- Drop the old root's renderer before another context can mount.
      renderer.current = undefined;
    };
  }, [operator, snapshot.error]);
  useEffect(() => {
    if (snapshot.data && !snapshot.error) {
      renderer.current?.(snapshot.data);
    }
  }, [snapshot.data, snapshot.error]);
  useEffect(() => {
    const host = container.current;
    if (host) {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- The renderer uses a DOM theme attribute.
      host.dataset.theme = theme === Theme.Dark ? 'dark' : 'light';
    }
  }, [theme, operator, snapshot.error]);

  if (!operator) {
    return null;
  }
  if (snapshot.error) {
    return <RequestDataError error={snapshot.error} />;
  }
  return (
    <>
      <style>{tokens + style}</style>
      <div ref={container} className="kshows" role="region" aria-label="Cluster capacity" />
    </>
  );
}

export default Capacity;
