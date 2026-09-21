import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../utils/api';
import {
  ACTIVE_NODE,
  ACTIVE_SERVER,
  ADMIN_RUNTIME,
  openServer,
  openFleet,
  selectNode,
  type ServerContext,
} from '../../utils/nodeContext';
import { nodesRequest } from '../../utils/nodesApi';
import { serverNumber, shortServerRoute, shortServerUrl } from '../../utils/serverLinks';
import {
  type AuthPermissions,
  type AuthUser,
  hasGlobalPermission,
  hasServerPermission,
  normalizeAuthPermissions,
} from '../../utils/permissions';

function emptyPermissions(): AuthPermissions {
  return { global: [], servers: [] };
}

export function useAuthSession() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [currentPermissions, setCurrentPermissions] = useState<AuthPermissions>(emptyPermissions);
  const [installPermissionsSyncing, setInstallPermissionsSyncing] = useState(false);

  const applyProfile = useCallback(async (profile: any) => {
    const user = profile?.user ?? null;
    const shortRoute = shortServerRoute();
    if (location.pathname.startsWith('/s/') && !shortRoute) {
      openFleet();
      return;
    }
    const requestedServer =
      shortRoute?.number || new URLSearchParams(location.search).get('server') || ACTIVE_SERVER?.id;
    const requestedNode =
      /^#\/nodes\/(local|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/servers\/[1-9]\d*\//.exec(
        location.hash
      )?.[1];
    if (
      !requestedServer &&
      requestedNode &&
      user?.isRoot &&
      (!ADMIN_RUNTIME || requestedNode !== ACTIVE_NODE)
    ) {
      selectNode(requestedNode, true);
      return;
    }
    if (requestedServer) {
      try {
        const context = await nodesRequest<ServerContext>(
          `/api/fleet/${encodeURIComponent(requestedServer)}/context`
        );
        if (
          !ACTIVE_SERVER ||
          context.id !== ACTIVE_SERVER.id ||
          context.displayId !== ACTIVE_SERVER.displayId ||
          context.nodeId !== ACTIVE_NODE ||
          context.runtimeId !== ACTIVE_SERVER.runtimeId ||
          context.placementRevision !== ACTIVE_SERVER.placementRevision
        ) {
          openServer(context);
          return;
        }
        profile = {
          ...profile,
          permissions: {
            global: [],
            servers: [{ serverId: context.runtimeId, permissions: context.permissions }],
          },
        };
        const number = serverNumber(context.displayId);
        if (number) {
          const legacyTab = location.hash.startsWith(
            `#/nodes/${context.nodeId}/servers/${context.runtimeId}/`
          )
            ? location.hash.split('/').pop()
            : undefined;
          const canonical = shortServerUrl(number, shortRoute?.tab || legacyTab || 'console');
          history.replaceState(null, '', canonical);
        }
      } catch {
        openFleet();
        return;
      }
    } else if (user && !user.isRoot && ADMIN_RUNTIME) {
      openFleet();
      return;
    }
    setCurrentUser(user);
    setCurrentPermissions(normalizeAuthPermissions(profile?.permissions));
    setCurrentUserId(typeof user?.id === 'number' ? user.id : null);
  }, []);

  const clearProfile = useCallback(() => {
    setCurrentUser(null);
    setCurrentPermissions(emptyPermissions());
    setCurrentUserId(null);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !ACTIVE_SERVER) return;
    let cancelled = false;
    let busy = false;
    const refreshContext = async () => {
      if (busy) return;
      busy = true;
      try {
        const context = await nodesRequest<ServerContext>(
          `/api/fleet/${ACTIVE_SERVER!.id}/context`
        );
        if (cancelled) return;
        if (
          context.nodeId !== ACTIVE_NODE ||
          context.runtimeId !== ACTIVE_SERVER!.runtimeId ||
          context.displayId !== ACTIVE_SERVER!.displayId ||
          context.placementRevision !== ACTIVE_SERVER!.placementRevision
        ) {
          openServer(context);
          return;
        }
        setCurrentPermissions(
          normalizeAuthPermissions({
            global: [],
            servers: [{ serverId: context.runtimeId, permissions: context.permissions }],
          })
        );
      } catch (error) {
        if (!cancelled && [401, 403, 404].includes(Number((error as { status?: number }).status)))
          openFleet();
        // A transient network/node outage must not discard open forms or switch runtime.
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => void refreshContext(), 15000);
    const onFocus = () => void refreshContext();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [isAuthenticated]);

  const loadCurrentUser = useCallback(async () => {
    try {
      const profile = await apiClient.getCurrentUser();
      await applyProfile(profile);
    } catch {
      clearProfile();
    }
  }, [applyProfile, clearProfile]);

  const refreshInstallPermissions = useCallback(async () => {
    setInstallPermissionsSyncing(true);
    try {
      await loadCurrentUser();
    } finally {
      setInstallPermissionsSyncing(false);
    }
  }, [loadCurrentUser]);

  useEffect(() => {
    let cancelled = false;

    const verifyToken = async () => {
      try {
        const token = apiClient.getAuthToken();
        if (!token) {
          if (!cancelled) {
            setIsAuthenticated(false);
            clearProfile();
          }
          return;
        }

        const profile = await apiClient.getCurrentUser();
        if (!cancelled) {
          await applyProfile(profile);
          setIsAuthenticated(true);
        }
      } catch (error: any) {
        if (!cancelled) {
          if (error?.response?.status === 401) {
            apiClient.clearAuth();
          }
          setIsAuthenticated(false);
          clearProfile();
        }
      } finally {
        if (!cancelled) {
          setAuthChecking(false);
          setAuthReady(true);
        }
      }
    };

    void verifyToken();

    return () => {
      cancelled = true;
    };
  }, [applyProfile, clearProfile]);

  const canManageUsers = useMemo(
    () => hasGlobalPermission(currentUser, currentPermissions, 'users.manage'),
    [currentUser, currentPermissions]
  );

  const canInstallServers = useMemo(
    () => hasGlobalPermission(currentUser, currentPermissions, 'server.install'),
    [currentUser, currentPermissions]
  );

  const canAccessServer = useCallback(
    (serverId: string | number, permission: string) =>
      hasServerPermission(currentUser, currentPermissions, Number(serverId), permission),
    [currentUser, currentPermissions]
  );

  const serverPermissionsById = useMemo(() => {
    const map: Record<string, string[]> = {};
    currentPermissions.servers.forEach((entry) => {
      map[String(entry.serverId)] = entry.permissions || [];
    });
    return map;
  }, [currentPermissions]);

  const resetSession = useCallback(() => {
    setIsAuthenticated(false);
    clearProfile();
  }, [clearProfile]);

  const markAuthenticated = useCallback(() => {
    setIsAuthenticated(true);
    setAuthChecking(false);
    setAuthReady(true);
  }, []);

  return {
    isAuthenticated,
    setIsAuthenticated,
    authChecking,
    authReady,
    currentUserId,
    currentUser,
    canManageUsers,
    canInstallServers,
    canAccessServer,
    serverPermissionsById,
    installPermissionsSyncing,
    loadCurrentUser,
    refreshInstallPermissions,
    resetSession,
    markAuthenticated,
  };
}
