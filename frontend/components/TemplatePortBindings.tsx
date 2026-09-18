import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { AppSelect } from '../src/ui/components/AppSelect';
import { nodesRequest } from '../utils/nodesApi';
import type { GameTemplate } from '../utils/gameTemplates';

export type PublicBinding = { key: string; hostIp: string; host: number | 'auto' };
export const bindingSignature = (node: string, bindings: PublicBinding[], refresh: number) =>
  JSON.stringify([node, bindings, refresh]);
type Allocation = { ip: string; alias: string; tcp: string; udp: string };
const control =
  'mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 dark:border-slate-600';

export function TemplatePortBindings({
  nodeId,
  ports,
  allocations,
  bindings,
  onChange,
  refresh,
  onRefresh,
  onValidation,
}: {
  nodeId: string;
  ports: GameTemplate['ports'];
  allocations: Allocation[];
  bindings: PublicBinding[];
  onChange: (bindings: PublicBinding[]) => void;
  refresh: number;
  onRefresh: () => void;
  onValidation: (state: { signature: string; valid: boolean }) => void;
}) {
  const requests = [
    ...new Set(bindings.flatMap((b, i) => (b.hostIp ? [`${b.hostIp}/${ports[i].protocol}`] : []))),
  ];
  const queryKey = JSON.stringify([nodeId, requests, refresh]);
  const [loaded, setLoaded] = useState<{
    key: string;
    pools: Record<string, number[]>;
    error?: string;
  }>();
  const [search, setSearch] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const [node, requested] = JSON.parse(queryKey) as [string, string[], number];
    const base = node === 'local' ? '' : `/api/nodes/${node}/runtime`;
    Promise.all(
      requested.map(async (key) => {
        const [ip, protocol] = key.split('/');
        try {
          const value = await nodesRequest<{ ports: number[] }>(
            `${base}/api/servers/available-ports?ip=${encodeURIComponent(ip)}&protocol=${protocol}`
          );
          return [key, value.ports] as const;
        } catch (error) {
          if ((error as { status?: number }).status === 404)
            throw new Error('Update this node agent to use available port selection.');
          throw error;
        }
      })
    )
      .then((entries) => {
        if (active) setLoaded({ key: queryKey, pools: Object.fromEntries(entries) });
      })
      .catch((error) => {
        if (active)
          setLoaded({
            key: queryKey,
            pools: {},
            error: error instanceof Error ? error.message : 'Cannot verify available ports',
          });
      });
    return () => {
      active = false;
    };
  }, [queryKey]);
  const ready = loaded?.key === queryKey && !loaded.error;
  const pools = ready ? loaded.pools : {};
  // Match runtime assignment: protect explicit selections before allocating automatic ones.
  const chosen = bindings.map((b) => (typeof b.host === 'number' ? b.host : undefined));
  const freeFor = (index: number) => {
    const b = bindings[index];
    const busy = new Set(
      bindings.flatMap((other, j) =>
        j !== index &&
        other.hostIp === b.hostIp &&
        ports[j].protocol === ports[index].protocol &&
        chosen[j]
          ? [chosen[j]]
          : []
      )
    );
    return (pools[`${b.hostIp}/${ports[index].protocol}`] ?? []).filter((port) => !busy.has(port));
  };
  for (let i = 0; i < bindings.length; i++)
    if (bindings[i].host === 'auto') chosen[i] = freeFor(i)[0];
  const valid =
    !!ready && bindings.every((b, i) => b.hostIp && chosen[i] && freeFor(i).includes(chosen[i]!));
  const signature = bindingSignature(nodeId, bindings, refresh);
  useEffect(() => {
    onValidation({ signature, valid });
  }, [signature, valid, onValidation]);

  return (
    <section className="space-y-4" aria-label="Public network allocations">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Public connection</h3>
          <p className="text-sm text-slate-500">
            Choose an address and an available port on this node.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
        >
          <RefreshCw size={15} /> Refresh ports
        </button>
      </div>
      {loaded?.key === queryKey && loaded.error && (
        <p role="alert" className="text-sm text-red-500">
          {loaded.error}
        </p>
      )}
      {ports.map((p, i) => {
        const b = bindings[i];
        const free = freeFor(i);
        const filtered = free.filter((port) => String(port).includes(search[p.key] || ''));
        const visible = filtered.slice(0, 50);
        if (typeof b.host === 'number' && free.includes(b.host) && !visible.includes(b.host))
          visible.unshift(b.host);
        return (
          <div
            key={p.key}
            className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40"
          >
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-medium">{p.label}</h4>
              <span className="rounded-lg bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                {p.protocol.toUpperCase()}
              </span>
            </div>
            <div className="grid items-start gap-4 md:grid-cols-2">
              <div>
                <span className="mb-1 block text-sm font-medium">Public IP</span>
                <AppSelect
                  className="gp-resources-select"
                  controlLabel={`Public IP · ${p.label}`}
                  value={b.hostIp}
                  options={[
                    { value: '', label: 'Select an allocated address', disabled: true },
                    ...allocations
                      .filter((a) => !!a[p.protocol])
                      .map((a) => ({
                        value: a.ip,
                        label: a.alias && a.alias !== a.ip ? `${a.ip} · ${a.alias}` : a.ip,
                      })),
                  ]}
                  onChange={(hostIp) =>
                    onChange(
                      bindings.map((binding, n) =>
                        n === i ? { ...binding, hostIp, host: 'auto' } : binding
                      )
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <span className="block text-sm font-medium">Public port</span>
                <AppSelect
                  className="gp-resources-select"
                  controlLabel={`Public port · ${p.label}`}
                  disabled={!b.hostIp || !ready || free.length === 0}
                  value={String(b.host)}
                  options={[
                    {
                      value: 'auto',
                      label: !b.hostIp
                        ? 'Select an IP first'
                        : !ready
                          ? 'Checking availability…'
                          : !free.length
                            ? 'No available ports'
                            : 'Assign automatically',
                    },
                    ...visible.map((port) => ({ value: String(port), label: String(port) })),
                    ...(typeof b.host === 'number' && !free.includes(b.host)
                      ? [
                          {
                            value: String(b.host),
                            label: `${b.host} · unavailable`,
                            disabled: true,
                          },
                        ]
                      : []),
                  ]}
                  onChange={(host) =>
                    onChange(
                      bindings.map((binding, n) =>
                        n === i
                          ? { ...binding, host: host === 'auto' ? 'auto' : Number(host) }
                          : binding
                      )
                    )
                  }
                />
                {(free.length > 50 || search[p.key]) && (
                  <label className="block text-sm">
                    Find port · {p.label}
                    <input
                      className={control}
                      inputMode="numeric"
                      type="search"
                      value={search[p.key] || ''}
                      placeholder="Type a port number…"
                      onChange={(event) => setSearch({ ...search, [p.key]: event.target.value })}
                    />
                  </label>
                )}
                {b.hostIp && ready && (
                  <p className="text-xs text-slate-500">
                    {free.length} available
                    {filtered.length > 50
                      ? ' · Showing first 50 matches; type to find another port'
                      : ''}
                  </p>
                )}
              </div>
            </div>
            {b.hostIp && ready && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-500/20 dark:bg-blue-500/10">
                <span className="block text-xs font-medium text-slate-500">
                  Connection address{b.host === 'auto' ? ' · preview' : ''}
                </span>
                {chosen[i] && free.includes(chosen[i]!) ? (
                  <code className="break-all text-lg font-semibold text-blue-700 dark:text-blue-300">
                    {b.hostIp}:{chosen[i]}
                  </code>
                ) : (
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    {free.length
                      ? 'Selected port is no longer available. Choose another port.'
                      : 'No free ports in this pool. Choose another IP or update node allocations.'}
                  </p>
                )}
                {b.host === 'auto' && chosen[i] && (
                  <p className="mt-1 text-xs text-slate-500">
                    Final port is assigned when the server is created.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-slate-500">
        Excludes saved server reservations (including stopped servers) and Docker mappings. Other
        host services may still occupy a port. Availability is checked again on creation.
      </p>
    </section>
  );
}
