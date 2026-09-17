import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowUpRight,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Server,
  Users,
  GripVertical,
} from 'lucide-react';
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
import { nodesRequest } from '../utils/nodesApi';
import { openServer, type ServerContext } from '../utils/nodeContext';
import {
  AppModal,
  AppModalContent,
  AppModalHeader,
  AppModalTitle,
  AppModalDescription,
  AppModalBody,
} from '../src/ui/components';
import './fleet.css';

type FleetServer = {
  id: string;
  name: string;
  provider: string;
  catalogId?: string | null;
  status: string;
  available: boolean;
  observedAt: number;
  node: { name: string; location: string };
};
type Member = { userId: number; username: string; permissions: string[] };
type User = { id: number; username: string; isRoot: boolean; isEnabled: boolean };
const button = 'gp-fleet-button';

export function FleetWorkspace({
  administrator,
  onNodes,
  userId,
  gameNames = {},
}: {
  administrator: boolean;
  onNodes: () => void;
  userId: number;
  gameNames?: Record<string, string>;
}) {
  const [layout, setLayout] = useState(() => readFleetLayout(userId));
  const [storageError, setStorageError] = useState(false);
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
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [members, setMembers] = useState<FleetServer | null>(null);
  const load = async () => {
    try {
      const data = await nodesRequest<{ servers: FleetServer[] }>('/api/fleet');
      setServers(data.servers);
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
      value(a).localeCompare(value(b)) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
    );
  });
  const filtered = ordered.filter(
    (s) =>
      (!layout.type || game(s).key === layout.type) &&
      (!layout.status || s.status === layout.status) &&
      `${s.name} ${s.node.name} ${s.node.location} ${game(s).label}`
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
  return (
    <section className="gp-fleet" aria-label="Game servers workspace">
      <header className="gp-fleet-heading">
        <div>
          <p className="gp-fleet-eyebrow">Your workspace</p>
          <h1>Game Servers</h1>
          <p className="gp-fleet-muted">Your servers, across every location.</p>
        </div>
        <div className="gp-fleet-actions">
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
            <button className={`${button} gp-fleet-primary`} onClick={onNodes}>
              <Server size={16} />
              Manage nodes
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
        <span className="gp-fleet-muted">
          {filtered.length} / {servers.length} servers ·{' '}
          {new Set(servers.map((s) => s.node.location)).size} locations
        </span>
      </div>
      <div className="gp-fleet-view-controls">
        <label>
          Game / type
          <select
            aria-label="Filter by game type"
            value={layout.type}
            onChange={(e) => changeLayout({ ...layout, type: e.target.value })}
          >
            <option value="">All types</option>
            {layout.type && !types.some(([key]) => key === layout.type) && (
              <option value={layout.type}>Unavailable type</option>
            )}
            {types.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            aria-label="Filter by status"
            value={layout.status}
            onChange={(e) => changeLayout({ ...layout, status: e.target.value })}
          >
            <option value="">All statuses</option>
            {[
              ...new Set([
                ...servers.map((s) => s.status),
                ...(layout.status ? [layout.status] : []),
              ]),
            ]
              .sort()
              .map((status) => (
                <option key={status}>{status}</option>
              ))}
          </select>
        </label>
        <label>
          Sort
          <select
            aria-label="Sort servers"
            value={layout.sort}
            onChange={(e) =>
              changeLayout({ ...layout, sort: e.target.value as FleetLayout['sort'] })
            }
          >
            <option value="custom">My order</option>
            <option value="name">Name A–Z</option>
            <option value="type">Game / type</option>
            <option value="location">Location</option>
            <option value="status">Status</option>
          </select>
        </label>
        <label>
          Group
          <select
            aria-label="Group servers"
            value={layout.group}
            onChange={(e) =>
              changeLayout({ ...layout, group: e.target.value as FleetLayout['group'] })
            }
          >
            <option value="none">No grouping</option>
            <option value="type">Game / type</option>
          </select>
        </label>
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
      <p className="gp-fleet-layout-hint">
        {layout.sort === 'custom'
          ? 'Drag the handle to reorder. Keyboard: Space, arrow keys, Space to drop. Grouped cards stay within their type.'
          : 'Choose My order to rearrange cards.'}{' '}
        View saved for your account in this browser.
      </p>
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
      ) : (
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
                      <div className="gp-fleet-card-top">
                        <span
                          className={`gp-fleet-status ${server.available ? (server.status === 'running' ? 'is-running' : '') : 'is-unknown'}`}
                        >
                          <i />
                          {server.status}
                        </span>
                        <span className="gp-fleet-provider">{game(server).label}</span>
                      </div>
                      <h3>{server.name}</h3>
                      <p className="gp-fleet-location">
                        <MapPin size={16} />
                        <span>
                          {server.node.location}
                          <small>{server.node.name}</small>
                        </span>
                      </p>
                      {!server.available && (
                        <p className="gp-fleet-notice">
                          Node unavailable. Last observed{' '}
                          {new Date(server.observedAt).toLocaleString()}. The game may still be
                          running.
                        </p>
                      )}
                      <div className="gp-fleet-card-footer">
                        <button
                          className={`${button} gp-fleet-primary`}
                          disabled={busy || !server.available}
                          onClick={() =>
                            void run(async () =>
                              openServer(
                                await nodesRequest<ServerContext>(`/api/fleet/${server.id}/context`)
                              )
                            )
                          }
                        >
                          Open server
                          <ArrowUpRight size={16} />
                        </button>
                        {administrator && (
                          <button
                            className={button}
                            onClick={() => setMembers(server)}
                            aria-label={`Access for ${server.name}`}
                          >
                            <Users size={16} />
                            Access
                          </button>
                        )}
                      </div>
                    </SortableCard>
                  ))}
                </div>
              </SortableContext>
            </section>
          ))}
        </DndContext>
      )}
      {members && <FleetAccess server={members} onClose={() => setMembers(null)} />}
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

function FleetAccess({ server, onClose }: { server: FleetServer; onClose: () => void }) {
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
  return (
    <AppModal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AppModalContent className="max-w-3xl">
        <AppModalHeader>
          <AppModalTitle>Server access</AppModalTitle>
          <AppModalDescription>
            {server.name} · {server.node.location}. Permissions apply only to this server.
          </AppModalDescription>
        </AppModalHeader>
        <AppModalBody>
          <div className="gp-fleet gp-fleet-access">
            {error && (
              <p role="alert" className="gp-fleet-error">
                {error}
              </p>
            )}
            <div className="gp-fleet-members">
              {members.length === 0 ? (
                <p className="gp-fleet-muted">No assigned users. Administrators retain access.</p>
              ) : (
                members.map((m) => (
                  <button
                    key={m.userId}
                    className={button}
                    onClick={() => changeUser(String(m.userId))}
                  >
                    <ShieldCheck size={15} />
                    {m.username}
                    <small>{m.permissions.length} permissions</small>
                  </button>
                ))
              )}
            </div>
            <label className="gp-fleet-field">
              User
              <select
                aria-label="User"
                value={userId}
                disabled={busy}
                onChange={(e) => changeUser(e.target.value)}
              >
                <option value="">Select a user…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.username}
                    {u.isEnabled ? '' : ' (disabled)'}
                  </option>
                ))}
              </select>
            </label>
            <p className="gp-fleet-muted">
              Assigned users can see status and metrics. Add the operations they should be allowed
              to perform.
            </p>
            <div className="gp-fleet-actions">
              {Object.entries(profiles).map(([name, values]) => (
                <button
                  key={name}
                  className={button}
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
                  <legend>{group}</legend>
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
                      <span>
                        {p
                          .slice(group.length + 1)
                          .split('.')
                          .join(' / ')}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
            <div className="gp-fleet-actions">
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
            </div>
          </div>
        </AppModalBody>
      </AppModalContent>
    </AppModal>
  );
}
