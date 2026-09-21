import { withoutDeletedServers } from '../utils/deletedFleetServers';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw, Search, ShieldCheck, Server, Users, GripVertical } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  defaultFleetLayout,
  readFleetLayout,
  fleetLayoutKey,
  fleetGame,
  type FleetLayout,
} from '../utils/fleetLayout';
import { useNodeScope } from '../contexts/NodeScopeContext';
import { nodesRequest } from '../utils/nodesApi';
import { openServer } from '../utils/nodeContext';
import {
  AppModal,
  AppModalContent,
  AppModalHeader,
  AppModalTitle,
  AppModalDescription,
  AppModalBody,
  AppModalFooter,
  AppSelect,
} from '../src/ui/components';
import './fleet.css';
import './fleet-node-views.css';
import { FleetSelect } from './FleetSelect';
import {
  FleetAddress,
  FleetMetrics,
  FleetPower,
  FleetManagement,
  FleetStatus,
} from './FleetServerPresentation';
import { ArrowUpDown, Plus, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { ViewModeToggle } from './gameServersTable/ViewModeToggle';
import { FleetQuickConsole } from './FleetQuickConsole';
import { FleetMetricsModal, type FleetMetricType } from './FleetMetricsModal';
import { FleetHistoryModal } from './FleetHistoryModal';
import { FleetServerName } from './FleetServerName';
import { ConfirmationModal } from './ConfirmationModal';
import {
  loadFleetRuntime,
  fleetContext,
  fleetAllowed,
  fleetRequest,
  type FleetRuntime,
} from '../utils/fleetRuntime';

type FleetServer = {
  displayId?: string;
  id: string;
  name: string;
  provider: string;
  catalogId?: string | null;
  status: string;
  available: boolean;
  observedAt: number;
  node: { id?: string; name: string; location: string };
};
type Member = { userId: number; username: string; permissions: string[] };
type User = { id: number; username: string; isRoot: boolean; isEnabled: boolean };
const FleetInstaller = lazy(() => import('./FleetInstaller').then(module => ({ default: module.FleetInstaller })));
const button = 'gp-fleet-button';

export function FleetWorkspace({
  administrator,
  userId,
  gameNames = {},
}: {
  administrator: boolean;
  userId: number;
  gameNames?: Record<string, string>;
}) {
  const { scope } = useNodeScope();
  const [installOpen, setInstallOpen] = useState(false);
  const [layout, setLayout] = useState(() => readFleetLayout(userId));
  const [storageError, setStorageError] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const changeLayout = (next: FleetLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(fleetLayoutKey(userId), JSON.stringify(next));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  };
  const [servers, setServers] = useState<FleetServer[]>([]);
  // The fleet inventory refreshes asynchronously; do not flash the old name after a save.
  const renamed = useRef(new Map<string, { name: string; until: number }>());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [runtimes, setRuntimes] = useState<Record<string, FleetRuntime>>({});
  const [consoleTabs, setConsoleTabs] = useState<FleetServer[]>([]);
  const [activeConsole, setActiveConsole] = useState('');
  const [metricSelection, setMetricSelection] = useState<{
    server: FleetServer;
    metric: FleetMetricType;
  } | null>(null);
  const [historySelection, setHistorySelection] = useState<FleetServer | null>(null);
  const [power, setPower] = useState<{ server: FleetServer; action: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const availableIds = new Set(servers.filter((s) => s.available).map((s) => s.id));
    const queue = servers.filter((s) => s.available);
    setRuntimes((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([id]) => availableIds.has(id)))
    );
    const worker = async () => {
      while (!cancelled && queue.length) {
        const item = queue.shift()!;
        try {
          const runtime = await loadFleetRuntime(item.id);
          if (!cancelled) setRuntimes((previous) => ({ ...previous, [item.id]: runtime }));
        } catch {
          if (!cancelled)
            setRuntimes((previous) => {
              const next = { ...previous };
              delete next[item.id];
              return next;
            });
        }
      }
    };
    void Promise.all(Array.from({ length: 4 }, worker));
    return () => {
      cancelled = true;
    };
  }, [servers]);
  const openConsole = (server: FleetServer) => {
    setConsoleTabs((previous) =>
      previous.some((s) => s.id === server.id) ? previous : [...previous, server]
    );
    setActiveConsole(server.id);
  };
  const connection = (server: FleetServer) => (
    <FleetAddress runtime={runtimes[server.id]} name={server.name} />
  );
  const metrics = (server: FleetServer, compact = false) => (
    <FleetMetrics
      runtime={runtimes[server.id]}
      compact={compact}
      name={server.name}
      onOpen={(metric) => setMetricSelection({ server, metric })}
    />
  );
  const powerButtons = (server: FleetServer, compact = false) => (
    <FleetPower
      runtime={runtimes[server.id]}
      name={server.name}
      disabled={busy || !server.available}
      compact={compact}
      onAction={(action) => setPower({ server, action })}
    />
  );
  const management = (server: FleetServer) => (
    <FleetManagement
      runtime={runtimes[server.id]}
      disabled={busy || !server.available}
      onManage={() => void run(async () => openServer(await fleetContext(server.id)))}
      onConsole={() => openConsole(server)}
    />
  );
  const load = async () => {
    try {
      const data = await nodesRequest<{ servers: FleetServer[] }>('/api/fleet');
      setServers(
        withoutDeletedServers(data.servers).map((server) => {
          const pendingName = renamed.current.get(server.id);
          if (!pendingName) return server;
          if (server.name === pendingName.name || Date.now() > pendingName.until) {
            renamed.current.delete(server.id);
            return server;
          }
          return { ...server, name: pendingName.name };
        })
      );
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot load servers');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  };
  const game = (server: FleetServer) => fleetGame(server, gameNames);
  const types = [...new Map(servers.map((s) => [game(s).key, game(s).label])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1])
  );
  const ranks = new Map(layout.order.map((id, index) => [id, index]));
  const ordered = [...servers].sort((a, b) => {
    if (layout.sort === 'custom')
      return (
        (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)
      );
    const value = (s: FleetServer) =>
      layout.sort === 'type'
        ? game(s).label
        : layout.sort === 'location'
          ? s.node.location
          : layout.sort === 'status'
            ? s.status
            : s.name;
    return (
      (value(a).localeCompare(value(b)) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id)) * (layout.direction === 'desc' ? -1 : 1)
    );
  });
  const sortHeader = (sort: 'name' | 'type' | 'status', label: string) => (
    <th
      aria-sort={
        layout.sort === sort ? (layout.direction === 'desc' ? 'descending' : 'ascending') : 'none'
      }
    >
      <button
        onClick={() =>
          changeLayout({
            ...layout,
            sort,
            direction: layout.sort === sort && layout.direction !== 'desc' ? 'desc' : 'asc',
          })
        }
      >
        {label}{' '}
        {layout.sort === sort ? (
          <span aria-hidden="true">{layout.direction === 'desc' ? '↓' : '↑'}</span>
        ) : (
          <ArrowUpDown size={14} />
        )}
      </button>
    </th>
  );
  const serverName = (server: FleetServer) => (
    <FleetServerName
      id={server.id}
      name={server.name}
      editable={!!runtimes[server.id] && fleetAllowed(runtimes[server.id].context, 'server.edit')}
      onSaved={(name) => {
        renamed.current.set(server.id, { name, until: Date.now() + 60000 });
        setServers((previous) =>
          previous.map((item) => (item.id === server.id ? { ...item, name } : item))
        );
        setConsoleTabs((previous) =>
          previous.map((item) => (item.id === server.id ? { ...item, name } : item))
        );
      }}
    />
  );
  const filtered = ordered.filter(
    (s) =>
      (!administrator || scope === 'all' || s.node.id === scope) &&
      (!layout.type || game(s).key === layout.type) &&
      (!layout.status || s.status === layout.status) &&
      `${s.displayId || ''} ${s.name} ${s.node.name} ${s.node.location} ${game(s).label}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const groups =
    layout.group === 'none'
      ? [['', filtered] as const]
      : types
          .map(([key, label]) => [label, filtered.filter((s) => game(s).key === key)] as const)
          .filter(([, items]) => items.length);
  const reorder = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || layout.sort !== 'custom') return;
    const from = filtered.find((s) => s.id === active.id),
      to = filtered.find((s) => s.id === over.id);
    if (!from || !to || (layout.group === 'type' && game(from).key !== game(to).key)) return;
    const ids = ordered.map((s) => s.id);
    changeLayout({ ...layout, order: arrayMove(ids, ids.indexOf(from.id), ids.indexOf(to.id)) });
  };
  if (installOpen && administrator) return <Suspense fallback={<p role="status">Loading games…</p>}>
    <FleetInstaller initialNodeId={scope === 'all' ? undefined : scope} onClose={() => { setInstallOpen(false); void load(); }} />
  </Suspense>;
  return (
    <section className="gp-fleet gp-fleet-node-workspace" aria-label="Game servers workspace">
      <header className="gp-fleet-heading">
        <div className="fleet-node-title">
          <h1>Game Servers</h1>
          <span className="fleet-node-count">
            {filtered.length}/{servers.length} servers ·{' '}
            {new Set(filtered.map((s) => s.node.location)).size} locations
          </span>
        </div>
        <div className="gp-fleet-actions">
          <ViewModeToggle
            value={layout.view === 'table' ? 'list' : 'grid'}
            onChange={(view) =>
              changeLayout({ ...layout, view: view === 'list' ? 'table' : 'cards' })
            }
          />
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (administrator) await nodesRequest('/api/fleet/refresh', {});
                await load();
              })
            }
          >
            <RefreshCw size={16} />
            Refresh
          </button>
          {administrator && (
            <button className={`${button} gp-fleet-primary`} onClick={() => setInstallOpen(true)}>
              <Plus size={16} />
              Add Game Server
            </button>
          )}
        </div>
      </header>
      <div className="gp-fleet-toolbar">
        <label className="gp-fleet-search">
          <Search size={18} />
          <input
            aria-label="Search servers and locations"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search servers or locations…"
          />
        </label>
        <button
          className={button}
          aria-expanded={filtersOpen}
          aria-controls="fleet-filters"
          onClick={() => setFiltersOpen(!filtersOpen)}
        >
          <SlidersHorizontal size={16} />
          Filters{layout.type || layout.status ? ' · Active' : ''}
          <ChevronDown
            size={14}
            style={{ transform: filtersOpen ? 'rotate(180deg)' : undefined }}
          />
        </button>
      </div>
      <div id="fleet-filters" className="gp-fleet-view-controls" hidden={!filtersOpen}>
        <FleetSelect
          label="Game / type"
          ariaLabel="Filter by game type"
          value={layout.type}
          onChange={(type) => changeLayout({ ...layout, type })}
          options={[
            { value: '', label: 'All types' },
            ...(layout.type && !types.some(([key]) => key === layout.type)
              ? [{ value: layout.type, label: 'Unavailable type' }]
              : []),
            ...types.map(([value, label]) => ({ value, label })),
          ]}
        />
        <FleetSelect
          label="Status"
          ariaLabel="Filter by status"
          value={layout.status}
          onChange={(status) => changeLayout({ ...layout, status })}
          options={[
            { value: '', label: 'All statuses' },
            ...[
              ...new Set([
                ...servers.map((s) => s.status),
                ...(layout.status ? [layout.status] : []),
              ]),
            ]
              .sort()
              .map((status) => ({ value: status, label: status })),
          ]}
        />
        <FleetSelect
          label="Sort"
          ariaLabel="Sort servers"
          value={layout.sort}
          onChange={(sort) =>
            changeLayout({ ...layout, sort: sort as FleetLayout['sort'], direction: 'asc' })
          }
          options={[
            { value: 'custom', label: 'My order' },
            { value: 'name', label: 'Name A–Z' },
            { value: 'type', label: 'Game / type' },
            { value: 'location', label: 'Location' },
            { value: 'status', label: 'Status' },
          ]}
        />
        <FleetSelect
          label="Group"
          ariaLabel="Group servers"
          value={layout.group}
          onChange={(group) => changeLayout({ ...layout, group: group as FleetLayout['group'] })}
          options={[
            { value: 'none', label: 'No grouping' },
            { value: 'type', label: 'Game / type' },
          ]}
        />
        <button
          className={button}
          onClick={() => {
            changeLayout(defaultFleetLayout());
            setSearch('');
          }}
        >
          Reset view
        </button>
      </div>
      {storageError && (
        <p role="alert" className="gp-fleet-error">
          Browser storage is unavailable. This view will not survive a reload.
        </p>
      )}
      {error && (
        <p className="gp-fleet-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status" className="gp-fleet-empty">
          Loading your servers…
        </p>
      ) : filtered.length === 0 ? (
        <div className="gp-fleet-empty">
          <Server size={30} />
          <h2>{servers.length ? 'No matching servers' : 'No servers assigned yet'}</h2>
          <p>
            {servers.length
              ? 'Change the filters or reset the view.'
              : administrator
                ? 'Open Nodes to create a server. It will appear here after the inventory refresh.'
                : 'Your administrator can assign a server and its permissions to your account.'}
          </p>
        </div>
      ) : layout.view === 'table' ? (
        <div className="fleet-node-tables">
          {groups.map(([label, items]) => (
            <section key={label || 'all'} aria-label={label || 'All servers'}>
              {label && (
                <h2 className="gp-fleet-group-title">
                  {label}
                  <span>{items.length}</span>
                </h2>
              )}
              <div className="fleet-node-table-scroll">
                <table className="fleet-node-table">
                  <thead>
                    <tr>
                      {sortHeader('name', 'Server name')}
                      {sortHeader('type', 'Game')}
                      <th>Connection</th>
                      {sortHeader('status', 'Status')}
                      <th>Server metrics</th>
                      <th>Power</th>
                      <th>Management</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((server) => (
                      <tr key={server.id}>
                        <td>{serverName(server)}</td>
                        <td>{game(server).label}</td>
                        <td>{connection(server)}</td>
                        <td>
                          <FleetStatus
                            status={server.status}
                            available={server.available}
                            name={server.name}
                            onClick={() => setHistorySelection(server)}
                          />
                        </td>
                        <td>{metrics(server, true)}</td>
                        <td>{powerButtons(server, true)}</td>
                        <td>{management(server)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="fleet-node-cards">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={reorder}
            accessibility={{
              announcements: {
                onDragStart: ({ active }) =>
                  `Picked up ${servers.find((s) => s.id === active.id)?.name || 'server'}.`,
                onDragOver: ({ over }) =>
                  over
                    ? `Over server ${servers.find((s) => s.id === over.id)?.name || ''}.`
                    : 'Outside a reorder target.',
                onDragEnd: () => 'Reordering finished.',
                onDragCancel: () => 'Reordering cancelled.',
              },
            }}
          >
            {groups.map(([label, items]) => (
              <section
                key={layout.group === 'none' ? 'all' : game(items[0]).key}
                className="gp-fleet-group"
                aria-label={label ? `${label} servers` : 'All server cards'}
              >
                {label && (
                  <h2 className="gp-fleet-group-title">
                    {label}
                    <span>{items.length}</span>
                  </h2>
                )}
                <SortableContext items={items.map((s) => s.id)} strategy={rectSortingStrategy}>
                  <div className="gp-fleet-grid">
                    {items.map((server) => (
                      <SortableCard
                        key={server.id}
                        server={server}
                        disabled={layout.sort !== 'custom'}
                      >
                        <div className="fleet-node-card-heading">
                          <div>
                            <h3>
                              <i
                                className={
                                  server.status === 'running' && server.available
                                    ? 'is-running'
                                    : ''
                                }
                              />
                              {serverName(server)}
                            </h3>
                            <p>{game(server).label}</p>
                          </div>
                          <FleetStatus
                            status={server.status}
                            available={server.available}
                            name={server.name}
                            onClick={() => setHistorySelection(server)}
                          />
                        </div>
                        {connection(server)}
                        {metrics(server)}
                        {powerButtons(server)}
                        {management(server)}
                        {!server.available && (
                          <p className="gp-fleet-notice">
                            Node unavailable. Last observed{' '}
                            {new Date(server.observedAt).toLocaleString()}. The game may still be
                            running.
                          </p>
                        )}
                      </SortableCard>
                    ))}
                  </div>
                </SortableContext>
              </section>
            ))}
          </DndContext>
        </div>
      )}
      {metricSelection && (
        <FleetMetricsModal
          key={metricSelection.server.id}
          server={metricSelection.server}
          game={game(metricSelection.server).label}
          initialMetric={metricSelection.metric}
          onClose={() => setMetricSelection(null)}
        />
      )}
      {historySelection && (
        <FleetHistoryModal
          key={historySelection.id}
          server={historySelection}
          onClose={() => setHistorySelection(null)}
        />
      )}
      {consoleTabs.length > 0 && (
        <FleetQuickConsole
          tabs={consoleTabs}
          active={activeConsole}
          onActive={setActiveConsole}
          onClose={(id) => {
            const next = consoleTabs.filter((s) => s.id !== id);
            setConsoleTabs(next);
            if (activeConsole === id) setActiveConsole(next[0]?.id || '');
          }}
        />
      )}
      {power && (
        <ConfirmationModal
          isOpen
          title={`${power.action} ${power.server.name}?`}
          message={`This will ${power.action} ${power.server.displayId || power.server.name}. Connected players may be disconnected.`}
          confirmText={power.action}
          onClose={() => setPower(null)}
          onConfirm={async () => {
            const context = await fleetContext(power.server.id);
            if (!fleetAllowed(context, 'server.power')) throw new Error('Power access denied');
            await fleetRequest(context, `/${power.action}`, {});
            setPower(null);
            await load();
          }}
        />
      )}
    </section>
  );
}

function SortableCard({
  server,
  disabled,
  children,
}: {
  server: FleetServer;
  disabled: boolean;
  children: ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: server.id, disabled });
  return (
    <article
      ref={setNodeRef}
      className={`gp-fleet-card ${isDragging ? 'is-dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        className="gp-fleet-drag"
        disabled={disabled}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${server.name}`}
        title={disabled ? 'Choose My order to rearrange' : 'Drag or use Space and arrow keys'}
      >
        <GripVertical size={18} />
      </button>
      {children}
    </article>
  );
}

export function FleetAccess({
  server,
  onClose,
}: {
  server: { id: string; name: string; node: { location: string } };
  onClose: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [userId, setUserId] = useState('');
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = async () => {
    const [grants, accounts] = await Promise.all([
      nodesRequest<{ members: Member[]; permissions: string[] }>(`/api/fleet/${server.id}/members`),
      nodesRequest<{ users: User[] }>('/api/users'),
    ]);
    setMembers(grants.members);
    setAvailable(grants.permissions);
    setUsers(accounts.users.filter((u) => !u.isRoot));
  };
  useEffect(() => {
    void load()
      .catch((e) => setError(String(e.message)))
      .finally(() => setBusy(false));
  }, [server.id]);
  const changeUser = (id: string) => {
    setUserId(id);
    setPermissions(members.find((m) => m.userId === Number(id))?.permissions || []);
  };
  const save = async (remove = false) => {
    setBusy(true);
    setError('');
    try {
      await nodesRequest(
        `/api/fleet/${server.id}/members/${userId}`,
        remove ? undefined : { permissions },
        remove ? 'DELETE' : 'PUT'
      );
      await load();
      if (remove) {
        setUserId('');
        setPermissions([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot save access');
    } finally {
      setBusy(false);
    }
  };
  const profiles: Record<string, string[]> = {
    Viewer: [],
    Operator: ['server.power', 'server.command.send', 'container.logs.read'],
    'File manager': ['fs.read', 'fs.write', 'container.logs.read'],
  };
  const groups = available.reduce<Record<string, string[]>>((result, permission) => {
    (result[permission.split('.')[0]] ??= []).push(permission);
    return result;
  }, {});
  const groupNames: Record<string, string> = {
    server: 'Server management',
    scheduledtasks: 'Scheduled tasks',
    container: 'Console & terminal',
    fs: 'Files',
    backups: 'Backups',
  };
  const permissionNames: Record<string, string> = {
    'server.edit': 'Edit server',
    'server.power': 'Start, restart & stop',
    'server.delete': 'Delete server',
    'server.command.send': 'Send console commands',
    'server.env': 'Edit startup variables',
    'server.wipe.soft': 'Soft wipe',
    'server.wipe.hard': 'Full wipe',
    'container.terminal': 'Use terminal',
    'container.logs.read': 'View console logs',
    'fs.read': 'Browse & read files',
    'fs.write': 'Create, edit & delete files',
    'scheduledtasks.read': 'View schedules',
    'scheduledtasks.write': 'Manage schedules',
  };
  return (
    <AppModal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AppModalContent className="gp-fleet gp-fleet-access-modal">
        <AppModalHeader>
          <div className="gp-fleet-access-heading">
            <ShieldCheck size={23} />
            <AppModalTitle>Server access</AppModalTitle>
          </div>
          <AppModalDescription>
            {server.name} · {server.node.location}
          </AppModalDescription>
        </AppModalHeader>
        <AppModalBody>
          <div className="gp-fleet-access" aria-busy={busy}>
            {error && (
              <p role="alert" className="gp-fleet-error">
                {error}
              </p>
            )}
            <div className="gp-fleet-members">
              {members.length === 0 ? (
                <p className="gp-fleet-muted">
                  <Users size={18} /> No assigned users. Administrators retain access.
                </p>
              ) : (
                members.map((m) => (
                  <button
                    key={m.userId}
                    className={`${button} ${userId === String(m.userId) ? 'is-selected' : ''}`}
                    disabled={busy}
                    onClick={() => changeUser(String(m.userId))}
                  >
                    <ShieldCheck size={15} />
                    {m.username}
                    <small>{m.permissions.length} permissions</small>
                  </button>
                ))
              )}
            </div>
            <div className="gp-fleet-field">
              <span>User</span>
              <AppSelect
                className="gp-resources-select gp-fleet-dropdown"
                controlLabel="User"
                placeholder="Select a user…"
                value={userId}
                disabled={busy}
                onChange={changeUser}
                options={users.map((u) => ({
                  value: String(u.id),
                  label: `${u.username}${u.isEnabled ? '' : ' (disabled)'}`,
                }))}
              />
            </div>
            <p className="gp-fleet-muted">
              Permissions apply only to this server. Assigned users can see status and metrics.
            </p>
            <div className="gp-fleet-actions">
              {Object.entries(profiles).map(([name, values]) => (
                <button
                  key={name}
                  className={button}
                  aria-pressed={
                    Boolean(userId) &&
                    permissions.length === values.filter((p) => available.includes(p)).length &&
                    permissions.every((p) => values.includes(p))
                  }
                  disabled={!userId || busy}
                  onClick={() => setPermissions(values.filter((p) => available.includes(p)))}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="gp-fleet-permissions">
              {Object.entries(groups).map(([group, values]) => (
                <fieldset key={group}>
                  <legend>{groupNames[group] || group}</legend>
                  {values.map((p) => (
                    <label key={p}>
                      <input
                        type="checkbox"
                        checked={permissions.includes(p)}
                        disabled={!userId || busy}
                        onChange={(e) =>
                          setPermissions((previous) =>
                            e.target.checked
                              ? [...previous, p]
                              : previous.filter((value) => value !== p)
                          )
                        }
                      />
                      <span title={p}>
                        {permissionNames[p] ||
                          p
                            .slice(group.length + 1)
                            .split('.')
                            .join(' / ')}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </div>
        </AppModalBody>
        <AppModalFooter className="gp-fleet-actions">
          <button
            className={`${button} gp-fleet-primary`}
            disabled={!userId || busy}
            onClick={() => void save()}
          >
            Save access
          </button>
          {members.some((m) => m.userId === Number(userId)) && (
            <button className={button} disabled={busy} onClick={() => void save(true)}>
              Revoke access
            </button>
          )}
          <button className={button} disabled={busy} onClick={onClose}>
            Close
          </button>
        </AppModalFooter>
      </AppModalContent>
    </AppModal>
  );
}
