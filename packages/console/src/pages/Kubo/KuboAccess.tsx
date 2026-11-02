import { useLogto } from '@logto/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import RequestDataError from '@/components/RequestDataError';
import { TenantsContext } from '@/contexts/TenantsProvider';
import Checkbox from '@/ds-components/Checkbox';

import useKuboResource, {
  KuboSessionContext,
  scopedKuboPath,
  type KuboScope,
} from './use-kubo-resource';

type Capabilities = {
  canViewAll: boolean;
  operator: boolean;
  tenantScoped: boolean;
  tenantMutationsEnabled: boolean;
  canMutate: boolean;
};

const validCapabilities = (value: Capabilities | undefined, scope: KuboScope) =>
  value &&
  Object.keys(value).length === 5 &&
  typeof value.canViewAll === 'boolean' &&
  typeof value.operator === 'boolean' &&
  typeof value.tenantScoped === 'boolean' &&
  typeof value.tenantMutationsEnabled === 'boolean' &&
  typeof value.canMutate === 'boolean' &&
  value.operator === (scope === 'all') &&
  value.tenantScoped === (scope === 'tenant') &&
  (scope !== 'all' || value.canViewAll);

type AccessContext = {
  scope: KuboScope;
  tenantId: string;
  canMutate: boolean;
  operator: boolean;
  path: (path: string) => string;
  refresh: () => Promise<boolean>;
  onDenied: (error: unknown) => Promise<void>;
  isCurrent: () => boolean;
};
const KuboAccessContext = createContext<AccessContext>({
  scope: 'tenant',
  tenantId: '',
  canMutate: false,
  operator: false,
  path: (path: string) => scopedKuboPath(path, 'tenant'),
  refresh: async () => false,
  onDenied: async (_error: unknown) => {
    await Promise.resolve();
  },
  isCurrent: () => false,
});

export const useKuboAccess = () => useContext(KuboAccessContext);

/** New create/upload flows start disabled until their own fresh discovery completes. */
export const useKuboMutationAccess = () => {
  const access = useKuboAccess();
  const [ready, setReady] = useState(false);
  const { refresh } = access;
  useEffect(() => {
    const lifecycle = new AbortController();
    const check = async () => {
      try {
        const allowed = await refresh();
        if (!lifecycle.signal.aborted) {
          setReady(allowed);
        }
      } catch {
        if (!lifecycle.signal.aborted) {
          setReady(false);
        }
      }
    };
    void check();
    return () => {
      lifecycle.abort();
    };
  }, [refresh]);
  return { ...access, canMutate: access.canMutate && ready };
};

function AccessView({ children }: { readonly children: ReactNode }) {
  const { tenantId } = useContext(KuboSessionContext);
  const [scope, setScope] = useState<KuboScope>('tenant');
  const [denial, setDenial] = useState<number>();
  const discovery = useKuboResource<Capabilities>('api/kubo/access', 'tenant');
  const selected = useKuboResource<Capabilities>(
    scope === 'all' ? 'api/kubo/access' : undefined,
    'all'
  );
  const access = scope === 'all' ? selected : discovery;
  const { mutate } = access;
  const verified = !access.error && validCapabilities(access.data, scope);
  const canViewAll =
    !discovery.error && validCapabilities(discovery.data, 'tenant') && discovery.data?.canViewAll;
  const operator = Boolean(verified && scope === 'all' && canViewAll);
  const canMutate = Boolean(verified && access.data?.canMutate && (scope === 'tenant' || operator));
  const active = useRef(true);
  const selection = useMemo(() => ({ scope, operator, canMutate }), [scope, operator, canMutate]);
  const currentSelection = useRef(selection);
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Render-time context epoch invalidates old async action closures immediately.
  currentSelection.current = selection;
  const isCurrent = useCallback(
    () => active.current && currentSelection.current === selection,
    [selection]
  );
  useEffect(() => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- Lifecycle ref protects unmounted action flows, including StrictMode setup/cleanup.
    active.current = true;
    return () => {
      // eslint-disable-next-line @silverhand/fp/no-mutation -- Invalidate pending action callbacks on unmount.
      active.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const result = await mutate();
    return Boolean(isCurrent() && validCapabilities(result, scope) && result?.canMutate);
  }, [mutate, isCurrent, scope]);
  const onDenied = useCallback(
    async (error: unknown) => {
      const status =
        error &&
        typeof error === 'object' &&
        'response' in error &&
        error.response &&
        typeof error.response === 'object' &&
        'status' in error.response
          ? error.response.status
          : error && typeof error === 'object' && 'status' in error
            ? error.status
            : undefined;
      if ([401, 403, 503].includes(Number(status))) {
        if (!isCurrent()) {
          return;
        }
        setDenial(Number(status));
        await mutate(undefined, { revalidate: false });
        try {
          await mutate();
        } catch {
          // The resource retains its discovery error and cleared data; preserve the original mutation error.
        }
      }
    },
    [mutate, isCurrent]
  );
  const context = useMemo(
    () => ({
      scope,
      tenantId,
      canMutate,
      operator,
      path: (path: string) => scopedKuboPath(path, scope),
      refresh,
      onDenied,
      isCurrent,
    }),
    [scope, tenantId, canMutate, operator, refresh, onDenied, isCurrent]
  );

  return (
    <>
      {canViewAll && (
        <Checkbox
          label="All workspaces (operator view)"
          checked={scope === 'all'}
          onChange={(checked) => {
            setDenial(undefined);
            setScope(checked ? 'all' : 'tenant');
          }}
        />
      )}
      {access.error && <RequestDataError error={access.error} />}
      {denial && (
        <p role="alert">
          Kubo action denied ({denial}). Access must be rechecked before another action.
        </p>
      )}
      <KuboAccessContext.Provider value={context}>
        <div key={`${scope}:${operator}`}>{scope === 'tenant' || operator ? children : null}</div>
      </KuboAccessContext.Provider>
    </>
  );
}

/** Authenticated session boundary: claims identify cache entries, never grant privileges. */
export default function KuboAccess({ children }: { readonly children: ReactNode }) {
  const { isAuthenticated, getIdTokenClaims } = useLogto();
  const { currentTenantId } = useContext(TenantsContext);
  const instance = useId();
  const [session, setSession] = useState<{ reader: typeof getIdTokenClaims; identity: string }>();
  useEffect(() => {
    const lifecycle = new AbortController();
    setSession(undefined);
    if (isAuthenticated) {
      const resolveIdentity = async () => {
        try {
          const claims = await getIdTokenClaims();
          if (!lifecycle.signal.aborted && claims?.sub) {
            setSession({
              reader: getIdTokenClaims,
              identity: `${instance}:${claims.sub}:${claims.iat}`,
            });
          }
        } catch {
          /* Unknown identity stays disabled. */
        }
      };
      void resolveIdentity();
    }
    return () => {
      lifecycle.abort();
    };
  }, [getIdTokenClaims, instance, isAuthenticated]);
  const identity =
    isAuthenticated && session?.reader === getIdTokenClaims ? session.identity : undefined;
  const context = useMemo(
    () => ({ identity, tenantId: currentTenantId }),
    [identity, currentTenantId]
  );
  return (
    <KuboSessionContext.Provider value={context}>
      {identity && <AccessView key={`${identity}:${currentTenantId}`}>{children}</AccessView>}
    </KuboSessionContext.Provider>
  );
}
