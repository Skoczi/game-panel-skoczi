import { useEffect, useState } from 'react';
import { ArrowUpRight, MapPin, RefreshCw, Search, ShieldCheck, Server, Users } from 'lucide-react';
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
}: {
  administrator: boolean;
  onNodes: () => void;
}) {
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
  const filtered = servers.filter((s) =>
    `${s.name} ${s.node.name} ${s.node.location}`.toLowerCase().includes(search.toLowerCase())
  );
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
          {servers.length} servers · {new Set(servers.map((s) => s.node.name)).size} locations
        </span>
      </div>
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
          <h2>{search ? 'No matching servers' : 'No servers assigned yet'}</h2>
          <p>
            {search
              ? 'Try another name or location.'
              : administrator
                ? 'Open Nodes to create a server. It will appear here after the inventory refresh.'
                : 'Your administrator can assign a server and its permissions to your account.'}
          </p>
        </div>
      ) : (
        <div className="gp-fleet-grid">
          {filtered.map((server) => (
            <article key={server.id} className="gp-fleet-card">
              <div className="gp-fleet-card-top">
                <span
                  className={`gp-fleet-status ${server.available ? (server.status === 'running' ? 'is-running' : '') : 'is-unknown'}`}
                >
                  <i />
                  {server.status}
                </span>
                <span className="gp-fleet-provider">{server.provider}</span>
              </div>
              <h2>{server.name}</h2>
              <p className="gp-fleet-location">
                <MapPin size={16} />
                <span>
                  {server.node.location}
                  <small>{server.node.name}</small>
                </span>
              </p>
              {!server.available && (
                <p className="gp-fleet-notice">
                  Node unavailable. Last observed {new Date(server.observedAt).toLocaleString()}.
                  The game may still be running.
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
            </article>
          ))}
        </div>
      )}
      {members && <FleetAccess server={members} onClose={() => setMembers(null)} />}
    </section>
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
