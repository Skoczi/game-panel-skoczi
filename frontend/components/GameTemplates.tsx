import { confirmDialog } from '../utils/confirmDialog';
import { useEffect, useState } from 'react';
import {
  Layers,
  Plus,
  Search,
  ArrowLeft,
  Download,
  Copy,
  Upload,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { AppSelect } from '../src/ui/components/AppSelect';
import { nodesRequest, type ExecutionNode, type LocalNode } from '../utils/nodesApi';
import { emptyTemplate, type GameTemplate, type TemplateVersion } from '../utils/gameTemplates';
import { getLinuxGsmGames, type LinuxGsmGame } from '../utils/linuxGsmCatalog';
import { OVHCLOUD_IMAGES } from '../utils/ovhcloudCatalog';
import { selectNode } from '../utils/nodeContext';
import { NativeLifecycleEditor } from './NativeLifecycleEditor';
import { TemplatePortBindings, bindingSignature, type PublicBinding } from './TemplatePortBindings';
import { InstallationProgressModal } from './InstallationProgressModal';
import type { InstallStep } from '../types/gameServer';

const card =
  'rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-[#111827]';
const button =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800';
const primary = `${button} border-transparent bg-blue-600 text-white hover:bg-blue-700 dark:hover:bg-blue-700`;
const input =
  'mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-slate-600';
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <AppSelect
        className="gp-resources-select"
        controlLabel={label}
        value={value}
        options={options}
        onChange={onChange}
      />
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        className={input}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
    </label>
  );
}
export function GameTemplates() {
  const [rows, setRows] = useState<TemplateVersion[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState<TemplateVersion | null>(null);
  const [draft, setDraft] = useState<GameTemplate | null>(null);
  const [tab, setTab] = useState('general');
  const [json, setJson] = useState('');
  const [games, setGames] = useState<LinuxGsmGame[]>([]);
  const [installing, setInstalling] = useState<TemplateVersion | null>(null);
  const [comparison, setComparison] = useState<TemplateVersion | null>(null);
  async function refresh() {
    const data = await nodesRequest<{ templates: TemplateVersion[] }>('/api/game-templates');
    setRows(data.templates);
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(refresh);
  }, []);
  const latest = rows.filter(
    (r) => !rows.some((other) => other.id === r.id && other.version > r.version)
  );
  function edit(row: TemplateVersion | null, doc = row?.document ?? emptyTemplate()) {
    setSelected(row);
    setDraft(structuredClone(doc));
    setJson(JSON.stringify(doc, null, 2));
    setTab('general');
    setError('');
    setNotice('');
    setComparison(null);
  }
  async function save() {
    if (!draft) return;
    const document = tab === 'json' ? JSON.parse(json) : draft;
    const saved = await nodesRequest<TemplateVersion>(
      selected ? `/api/game-templates/${selected.id}/versions` : '/api/game-templates',
      {
        document,
        ...(selected ? { baseVersion: selected.version } : {}),
      }
    );
    await refresh();
    setSelected(saved);
    setDraft(saved.document);
    setJson(JSON.stringify(saved.document, null, 2));
    setNotice(`Draft v${saved.version} saved. Review and publish it before installing.`);
  }
  async function status(row: TemplateVersion, value: string) {
    if (
      !await confirmDialog(
        value === 'published'
          ? `Publish ${row.document.name} v${row.version}? Its Docker image will run on selected nodes.`
          : `Disable v${row.version} for new installations? Existing servers will not change.`
      )
    )
      return;
    const saved = await nodesRequest<TemplateVersion>(
      `/api/game-templates/${row.id}/${row.version}/status`,
      { status: value }
    );
    await refresh();
    if (selected?.id === row.id && selected.version === row.version) setSelected(saved);
    setNotice(
      value === 'published'
        ? 'Version published. Existing servers are unchanged.'
        : 'Version disabled for new installations.'
    );
  }
  async function exportRow(row: TemplateVersion) {
    const document = await nodesRequest<GameTemplate>(
      `/api/game-templates/${row.id}/${row.version}/export`
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
    );
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `game-template-v${row.version}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  const dirty =
    draft && (selected ? JSON.stringify(draft) !== JSON.stringify(selected.document) : true);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || (draft && json !== JSON.stringify(draft, null, 2))) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, draft, json]);
  const change = (patch: Partial<GameTemplate>) => setDraft(draft ? { ...draft, ...patch } : null);
  return (
    <section className="space-y-6 text-slate-900 dark:text-slate-100">
      <header className={`${card} flex flex-wrap items-center justify-between gap-4`}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-600 dark:text-cyan-400">
            Administration · Installation catalog
          </p>
          <h1 className="mt-2 flex items-center gap-3 text-3xl font-semibold">
            <Layers size={28} />
            Game Templates
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Versioned definitions. One catalog for every node.
          </p>
        </div>
        {!draft && !installing && (
          <div className="flex flex-wrap gap-2">
            <label className={`${button} cursor-pointer`}>
              <Upload size={16} />
              Import JSON
              <input
                aria-label="Import template JSON"
                className="sr-only"
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void run(async () => {
                      if (file.size > 32768) throw new Error('Maximum file size: 32 KiB');
                      const row = await nodesRequest<TemplateVersion>('/api/game-templates', {
                        document: JSON.parse(await file.text()),
                      });
                      await refresh();
                      edit(row);
                    });
                  e.target.value = '';
                }}
              />
            </label>
            <button className={primary} onClick={() => edit(null)}>
              <Plus size={16} />
              New template
            </button>
          </div>
        )}
      </header>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-400/40 bg-red-500/10 p-4 text-red-600 dark:text-red-300"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4"
        >
          {notice}
        </div>
      )}
      {installing ? (
        <TemplateInstall row={installing} onClose={() => setInstalling(null)} />
      ) : draft ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              className={button}
              onClick={async () => {
                if (
                  !(dirty || (tab === 'json' && json !== JSON.stringify(draft, null, 2))) ||
                  await confirmDialog('Discard unsaved changes?')
                ) {
                  setDraft(null);
                  setSelected(null);
                }
              }}
            >
              <ArrowLeft size={16} />
              Catalog
            </button>
            <div className="flex flex-wrap gap-2">
              {selected && (
                <button
                  disabled={busy}
                  className={button}
                  onClick={() => void run(() => exportRow(selected))}
                >
                  <Download size={16} />
                  Export saved version
                </button>
              )}
              {selected?.status === 'draft' && (
                <button
                  disabled={
                    busy || !!dirty || (tab === 'json' && json !== JSON.stringify(draft, null, 2))
                  }
                  className={button}
                  onClick={() => void run(() => status(selected, 'published'))}
                >
                  <ShieldCheck size={16} />
                  Publish v{selected.version}
                </button>
              )}
              <button disabled={busy} className={primary} onClick={() => void run(save)}>
                Save new draft version
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Template sections">
            {[
              'general',
              'runtime',
              'lifecycle',
              'network',
              'variables',
              'storage',
              'versions',
              'json',
            ].map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                className={tab === t ? primary : button}
                onClick={async () => {
                  if (tab === 'json' && t !== 'json') {
                    void run(async () => {
                      const result = await nodesRequest<{ document: GameTemplate }>(
                        '/api/game-templates/validate',
                        { document: JSON.parse(json) }
                      );
                      setDraft(result.document);
                      setJson(JSON.stringify(result.document, null, 2));
                      setTab(t);
                    });
                    return;
                  } else if (t === 'json') setJson(JSON.stringify(draft, null, 2));
                  setTab(t);
                }}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className={`${card} space-y-5`}>
            <p className="text-xs text-slate-500">
              {selected
                ? `Based on v${selected.version} · ${selected.status} · ${selected.hash.slice(0, 12)}`
                : 'New template'}{' '}
              · Saving creates an immutable draft. Running servers are never changed.
            </p>
            {tab === 'general' && (
              <>
                <Field label="Name" value={draft.name} onChange={(name) => change({ name })} />
                <Field
                  label="Author / maintainer"
                  value={draft.author}
                  onChange={(author) => change({ author })}
                />
                <Field
                  label="Source / attribution"
                  value={draft.source}
                  onChange={(source) => change({ source })}
                />
                <label className="block text-sm">
                  Description
                  <textarea
                    className={input}
                    rows={3}
                    value={draft.description}
                    onChange={(e) => change({ description: e.target.value })}
                  />
                </label>
              </>
            )}
            {tab === 'runtime' && (
              <>
                <Choice
                  label="Provider"
                  value={draft.runtime.provider}
                  options={(draft.schemaVersion === 2
                    ? ['external']
                    : ['linuxgsm', 'ovhcloud', 'external']
                  ).map((value) => ({
                    value,
                    label: draft.schemaVersion === 2 ? 'Native Runtime (local image)' : value,
                  }))}
                  onChange={(provider) =>
                    change({
                      runtime: {
                        ...draft.runtime,
                        provider: provider as GameTemplate['runtime']['provider'],
                      },
                    })
                  }
                />
                {draft.runtime.provider === 'linuxgsm' && (
                  <>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() => void run(async () => setGames(await getLinuxGsmGames()))}
                    >
                      Load LinuxGSM games
                    </button>
                    {games.length > 0 && (
                      <Choice
                        label="Use LinuxGSM game"
                        value={draft.runtime.catalogId}
                        options={games.map((g) => ({ value: g.shortname, label: g.gamename }))}
                        onChange={(id) => {
                          const g = games.find((v) => v.shortname === id)!;
                          change({
                            name: g.gamename,
                            source: 'LinuxGSM / GameServerManagers',
                            runtime: {
                              ...draft.runtime,
                              catalogId: id,
                              gameServerName: g.gameservername,
                              image: g.dockerImage,
                            },
                          });
                        }}
                      />
                    )}
                  </>
                )}
                {draft.runtime.provider === 'ovhcloud' && (
                  <Choice
                    label="Use OVH image defaults"
                    value={draft.runtime.catalogId}
                    options={OVHCLOUD_IMAGES.map((g) => ({
                      value: g.imageId,
                      label: `${g.name} · ${g.imageId}`,
                    }))}
                    onChange={(id) => {
                      const g = OVHCLOUD_IMAGES.find((v) => v.imageId === id)!;
                      change({
                        name: g.name,
                        source: 'OVHcloud Game Panel',
                        runtime: {
                          ...draft.runtime,
                          catalogId: id,
                          gameServerName: '',
                          image: g.dockerImage,
                        },
                        ports: [
                          ...g.defaultTcpPorts.map((p, i) => ({
                            key: `tcp${i}`,
                            label: p.label,
                            protocol: 'tcp' as const,
                            container: p.port,
                            suggested: p.port,
                            env: '',
                            linuxgsmKey: '',
                          })),
                          ...g.defaultUdpPorts.map((p, i) => ({
                            key: `udp${i}`,
                            label: p.label,
                            protocol: 'udp' as const,
                            container: p.port,
                            suggested: p.port,
                            env: '',
                            linuxgsmKey: '',
                          })),
                        ],
                        variables: Object.entries(g.defaultEnv).map(([key, value]) => ({
                          key,
                          label: key,
                          type: 'string',
                          required: g.requiredEnvKeys.includes(key),
                          secret: /password|secret|token|credential|api_?key/i.test(key),
                          default: /password|secret|token|credential|api_?key/i.test(key)
                            ? ''
                            : value,
                        })),
                      });
                    }}
                  />
                )}
                <Field
                  label="Docker image (tag or digest)"
                  value={draft.runtime.image}
                  onChange={(image) => change({ runtime: { ...draft.runtime, image } })}
                />
                <Field
                  label="Catalog ID / LinuxGSM shortname"
                  value={draft.runtime.catalogId}
                  onChange={(catalogId) => change({ runtime: { ...draft.runtime, catalogId } })}
                />
                {draft.runtime.provider === 'external' && (
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field
                      label="Runtime user (must exist in image)"
                      value={draft.runtime.identity?.user ?? ''}
                      onChange={(user) =>
                        change({
                          runtime: {
                            ...draft.runtime,
                            identity: {
                              user,
                              uid: draft.runtime.identity?.uid ?? 1000,
                              gid: draft.runtime.identity?.gid ?? 1000,
                            },
                          },
                        })
                      }
                    />
                    <Field
                      label="Volume UID"
                      type="number"
                      value={draft.runtime.identity?.uid ?? 1000}
                      onChange={(uid) =>
                        change({
                          runtime: {
                            ...draft.runtime,
                            identity: {
                              user: draft.runtime.identity?.user ?? '1000',
                              uid: Number(uid),
                              gid: draft.runtime.identity?.gid ?? 1000,
                            },
                          },
                        })
                      }
                    />
                    <Field
                      label="Volume GID"
                      type="number"
                      value={draft.runtime.identity?.gid ?? 1000}
                      onChange={(gid) =>
                        change({
                          runtime: {
                            ...draft.runtime,
                            identity: {
                              user: draft.runtime.identity?.user ?? '1000',
                              uid: draft.runtime.identity?.uid ?? 1000,
                              gid: Number(gid),
                            },
                          },
                        })
                      }
                    />
                  </div>
                )}
                {draft.runtime.provider === 'linuxgsm' && (
                  <Field
                    label="LinuxGSM script name (e.g. csserver)"
                    value={draft.runtime.gameServerName}
                    onChange={(gameServerName) =>
                      change({ runtime: { ...draft.runtime, gameServerName } })
                    }
                  />
                )}
                <div className="flex gap-5">
                  {(['x64', 'arm64'] as const).map((a) => (
                    <label key={a} className="flex gap-2">
                      <input
                        type="checkbox"
                        checked={draft.runtime.architectures.includes(a)}
                        onChange={(e) =>
                          change({
                            runtime: {
                              ...draft.runtime,
                              architectures: e.target.checked
                                ? [...draft.runtime.architectures, a]
                                : draft.runtime.architectures.filter((x) => x !== a),
                            },
                          })
                        }
                      />
                      {a}
                    </label>
                  ))}
                </div>
                <p className="text-sm text-slate-500">
                  {draft.schemaVersion === 2
                    ? 'Installation and startup use the commands in Lifecycle. The node must have the reviewed image loaded locally; its exact image ID is pinned at installation.'
                    : 'Installation, start and stop use the selected provider/image. Use the Lifecycle tab to create a native recipe instead.'}
                </p>
              </>
            )}
            {tab === 'lifecycle' && <NativeLifecycleEditor draft={draft} change={change} />}
            {tab === 'network' && (
              <>
                <p className="text-sm text-slate-500">
                  One row per container port/protocol. IP addresses belong to nodes, not templates.
                  Labels can combine roles such as Game / Query / RCON.
                </p>
                {draft.ports.map((p, i) => {
                  const patch = (v: Partial<typeof p>) =>
                    change({ ports: draft.ports.map((x, n) => (n === i ? { ...x, ...v } : x)) });
                  return (
                    <div
                      key={i}
                      className="grid gap-4 rounded-xl border border-slate-300 p-4 dark:border-slate-700 md:grid-cols-3"
                    >
                      <Field label="Port key" value={p.key} onChange={(key) => patch({ key })} />
                      <Field label="Label" value={p.label} onChange={(label) => patch({ label })} />
                      <Choice
                        label="Protocol"
                        value={p.protocol}
                        options={['tcp', 'udp'].map((value) => ({
                          value,
                          label: value.toUpperCase(),
                        }))}
                        onChange={(protocol) => patch({ protocol: protocol as 'tcp' | 'udp' })}
                      />
                      <Field
                        type="number"
                        label="Container port"
                        value={p.container}
                        onChange={(v) => patch({ container: Number(v) })}
                      />
                      <Field
                        type="number"
                        label="Suggested host port"
                        value={p.suggested}
                        onChange={(v) => patch({ suggested: Number(v) })}
                      />
                      <Field
                        label="Port environment key (optional)"
                        value={p.env}
                        onChange={(env) => patch({ env })}
                      />
                      {draft.runtime.provider === 'linuxgsm' && (
                        <Field
                          label="LinuxGSM port setting (optional)"
                          value={p.linuxgsmKey}
                          onChange={(linuxgsmKey) => patch({ linuxgsmKey })}
                        />
                      )}
                      <button
                        className={button}
                        onClick={() => change({ ports: draft.ports.filter((_, n) => n !== i) })}
                      >
                        Remove port
                      </button>
                    </div>
                  );
                })}
                <button
                  className={button}
                  onClick={() =>
                    change({
                      ports: [
                        ...draft.ports,
                        {
                          key: `port${draft.ports.length + 1}`,
                          label: 'Game',
                          protocol: 'udp',
                          container: 27015,
                          suggested: 27015,
                          env: '',
                          linuxgsmKey: '',
                        },
                      ],
                    })
                  }
                >
                  Add port
                </button>
              </>
            )}
            {tab === 'variables' && (
              <>
                {draft.variables.map((v, i) => {
                  const patch = (p: Partial<typeof v>) =>
                    change({
                      variables: draft.variables.map((x, n) => (n === i ? { ...x, ...p } : x)),
                    });
                  return (
                    <div
                      key={i}
                      className="grid gap-4 rounded-xl border border-slate-300 p-4 dark:border-slate-700 md:grid-cols-2"
                    >
                      <Field
                        label="Environment key"
                        value={v.key}
                        onChange={(key) => patch({ key })}
                      />
                      <Field label="Label" value={v.label} onChange={(label) => patch({ label })} />
                      <Choice
                        label="Value type"
                        value={v.type}
                        options={['string', 'integer', 'boolean'].map((value) => ({
                          value,
                          label: value,
                        }))}
                        onChange={(type) => patch({ type: type as typeof v.type })}
                      />
                      {!v.secret && (
                        <Field
                          label="Default value (public, exported)"
                          value={v.default}
                          onChange={(value) => patch({ default: value })}
                        />
                      )}
                      <label className="flex gap-2">
                        <input
                          type="checkbox"
                          checked={v.required}
                          onChange={(e) => patch({ required: e.target.checked })}
                        />
                        Required
                      </label>
                      <label className="flex gap-2">
                        <input
                          type="checkbox"
                          checked={v.secret}
                          onChange={(e) =>
                            patch({
                              secret: e.target.checked,
                              ...(e.target.checked ? { default: '' } : {}),
                            })
                          }
                        />
                        Secret — no saved default
                      </label>
                      <button
                        className={button}
                        onClick={() =>
                          change({ variables: draft.variables.filter((_, n) => n !== i) })
                        }
                      >
                        Remove variable
                      </button>
                    </div>
                  );
                })}
                <button
                  className={button}
                  onClick={() =>
                    change({
                      variables: [
                        ...draft.variables,
                        {
                          key: `VARIABLE_${draft.variables.length + 1}`,
                          label: 'Variable',
                          type: 'string',
                          default: '',
                          required: false,
                          secret: false,
                        },
                      ],
                    })
                  }
                >
                  Add variable
                </button>
              </>
            )}
            {tab === 'storage' && (
              <>
                <p className="text-sm text-slate-500">
                  Named server-owned directories only. No host paths or Docker socket mounts. OVH
                  adapters may supply their own required mounts.
                </p>
                {draft.mounts.map((m, i) => (
                  <div key={i} className="grid gap-4 md:grid-cols-3">
                    <Field
                      label="Directory key"
                      value={m.key}
                      onChange={(key) =>
                        change({
                          mounts: draft.mounts.map((x, n) => (n === i ? { ...x, key } : x)),
                        })
                      }
                    />
                    <Field
                      label="Container path"
                      value={m.containerPath}
                      onChange={(containerPath) =>
                        change({
                          mounts: draft.mounts.map((x, n) =>
                            n === i ? { ...x, containerPath } : x
                          ),
                        })
                      }
                    />
                    <button
                      className={button}
                      onClick={() => change({ mounts: draft.mounts.filter((_, n) => n !== i) })}
                    >
                      Remove directory
                    </button>
                  </div>
                ))}
                <button
                  className={button}
                  onClick={() =>
                    change({
                      mounts: [
                        ...draft.mounts,
                        { key: `directory${draft.mounts.length}`, containerPath: '/data' },
                      ],
                    })
                  }
                >
                  Add directory
                </button>
              </>
            )}
            {tab === 'versions' && (
              <>
                <p className="text-sm text-slate-500">
                  Select a version to inspect its definition. Older published versions remain
                  available until disabled.
                </p>
                {rows
                  .filter((r) => r.id === selected?.id)
                  .map((r) => (
                    <div
                      key={r.version}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-300 py-3 dark:border-slate-700"
                    >
                      <div>
                        v{r.version} · {r.status}
                        <p className="text-xs text-slate-500">
                          {r.actor} · {r.created_at} · {r.hash.slice(0, 12)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button className={button} onClick={() => edit(r)}>
                          Inspect
                        </button>
                        <button className={button} onClick={() => setComparison(r)}>
                          Compare
                        </button>
                        {r.status === 'published' && (
                          <button
                            className={button}
                            onClick={async () => {
                              setDraft(null);
                              setInstalling(r);
                            }}
                          >
                            Install v{r.version}
                          </button>
                        )}
                        {r.status === 'published' && (
                          <button
                            disabled={busy}
                            className={button}
                            onClick={() => void run(() => status(r, 'disabled'))}
                          >
                            Disable
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </>
            )}
            {tab === 'versions' && comparison && (
              <div className="space-y-3">
                <h3 className="font-semibold">v{comparison.version} → current editor</h3>
                {(Object.keys(draft) as Array<keyof GameTemplate>)
                  .filter(
                    (k) => JSON.stringify(comparison.document[k]) !== JSON.stringify(draft[k])
                  )
                  .map((k) => (
                    <details
                      key={k}
                      className="rounded-xl border border-slate-300 p-3 dark:border-slate-700"
                    >
                      <summary className="cursor-pointer">{k}</summary>
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
                          {JSON.stringify(comparison.document[k], null, 2)}
                        </pre>
                        <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
                          {JSON.stringify(draft[k], null, 2)}
                        </pre>
                      </div>
                    </details>
                  ))}
                {JSON.stringify(comparison.document) === JSON.stringify(draft) && (
                  <p>No definition changes.</p>
                )}
              </div>
            )}
            {tab === 'json' && (
              <>
                <p className="text-sm text-slate-500">
                  Game Templates schema v1/v2. Imported documents are validated and saved as drafts.
                  Do not put infrastructure addresses or credentials in descriptions/default values.
                </p>
                <textarea
                  aria-label="Template JSON"
                  className={`${input} font-mono text-xs`}
                  rows={24}
                  value={json}
                  onChange={(e) => setJson(e.target.value)}
                  spellCheck={false}
                />
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className={`${card} grid items-end gap-4 md:grid-cols-[1fr_240px]`}>
            <label className="flex items-center gap-3">
              <Search size={20} />
              <input
                className="w-full bg-transparent py-2 outline-none"
                aria-label="Search templates"
                placeholder="Search by name, provider or author…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Choice
              label="Status"
              value={filter}
              options={['all', 'draft', 'published', 'disabled'].map((value) => ({
                value,
                label: value === 'all' ? 'All statuses' : value,
              }))}
              onChange={setFilter}
            />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {latest
              .filter(
                (r) =>
                  (filter === 'all' || r.status === filter) &&
                  `${r.document.name} ${r.document.schemaVersion === 2 ? 'native runtime' : r.document.runtime.provider} ${r.document.author}`
                    .toLowerCase()
                    .includes(query.toLowerCase())
              )
              .map((r) => (
                <article key={r.id} className={`${card} flex flex-col gap-4`}>
                  <div className="flex justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-semibold">{r.document.name}</h2>
                      <p className="mt-1 text-xs uppercase tracking-wider text-slate-500">
                        {r.document.schemaVersion === 2 ? 'Native Runtime' : r.document.runtime.provider} · v{r.version} · {r.document.author}
                      </p>
                    </div>
                    <span className="h-fit rounded-full bg-blue-500/10 px-3 py-1 text-xs">
                      {r.status}
                    </span>
                  </div>
                  <p className="flex-1 text-sm text-slate-500">{r.document.description}</p>
                  <p className="break-all font-mono text-xs text-slate-500">
                    {r.document.runtime.image}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button className={button} onClick={() => edit(r)}>
                      Manage
                    </button>
                    <button
                      className={button}
                      onClick={() => edit(null, { ...r.document, name: `${r.document.name} copy` })}
                    >
                      <Copy size={15} />
                      Duplicate
                    </button>
                    <button
                      disabled={busy || r.status !== 'published'}
                      className={primary}
                      onClick={() => setInstalling(r)}
                    >
                      <Play size={15} />
                      Install server
                    </button>
                    <button
                      disabled={busy}
                      className={`${button} text-red-500`}
                      onClick={async () => {
                        if (!await confirmDialog(`Remove "${r.document.name}" and all its versions from the catalog? Existing servers and their files will not be changed.`)) return;
                        void run(async () => {
                          await nodesRequest(`/api/game-templates/${r.id}`, { method: 'DELETE' });
                          await refresh();
                          setNotice('Template removed. Existing servers are unchanged.');
                        });
                      }}
                    >
                      Remove template
                    </button>
                  </div>
                </article>
              ))}
          </div>
          {!busy && !latest.length && (
            <p className={card}>
              No templates yet. Create a definition or import a reviewed JSON document.
            </p>
          )}
          <p className="text-sm text-slate-500">
            Legacy installation remains available. Adding or publishing templates does not migrate
            existing servers.
          </p>
        </>
      )}
    </section>
  );
}

export function TemplateInstall({ row, onClose, fixedNodeId, onInstallationStarted, onDismiss, resumePreviousInstallation = true }: { row: TemplateVersion; onClose: () => void; fixedNodeId?: string; onInstallationStarted?: () => void; onDismiss?: () => void; resumePreviousInstallation?: boolean }) {
  const installStorageKey = `template-install-${row.id}${fixedNodeId ? `-${fixedNodeId}` : ''}`;
  const [nodes, setNodes] = useState<ExecutionNode[]>([]);
  const [localNode, setLocalNode] = useState<LocalNode>();
  const [nodeId, setNodeId] = useState(fixedNodeId || 'local');
  const [allocations, setAllocations] = useState<
    Array<{ ip: string; alias: string; tcp: string; udp: string }>
  >([]);
  const [bindings, setBindings] = useState<PublicBinding[]>(
    row.document.ports.map((p) => ({ key: p.key, hostIp: '', host: 'auto' }))
  );
  const [portRefresh, setPortRefresh] = useState(0);
  const [portValidation, setPortValidation] = useState({ signature: '', valid: false });
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [name, setName] = useState(row.document.name);
  const [memory, setMemory] = useState('1024');
  const [cpu, setCpu] = useState('1');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [installedServer, setInstalledServer] = useState<{ id: number; nodeId: string } | null>(() => {
    if (!resumePreviousInstallation) return null;
    try {
      const value = JSON.parse(sessionStorage.getItem(installStorageKey) || 'null');
      return Number.isSafeInteger(value?.id) && value.id > 0 && /^(local|[0-9a-f-]{36})$/.test(value.nodeId) ? value : null;
    } catch { return null; }
  });
  const [showProgress, setShowProgress] = useState(Boolean(installedServer));
  useEffect(() => {
    if (installedServer) onInstallationStarted?.();
  }, [installedServer, onInstallationStarted]);
  const [progress, setProgress] = useState<{ progress: number; status: string; errorMessage?: string }>({ progress: 0, status: 'pending' });
  const [progressError, setProgressError] = useState('');
  const installPlan: InstallStep[] = [
    { key: 'pulling_image', optional: false, label: row.document.schemaVersion === 2 ? 'Checking local runtime and installer images' : undefined },
    { key: 'preparing_files', optional: false },
    ...(row.document.lifecycle?.install || []).map((step, i) => ({ key: `native_step_${i}`, label: step.name, optional: false })),
    { key: 'creating_container', optional: false },
    { key: 'starting_container', optional: false },
  ];
  useEffect(() => {
    if (!installedServer) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const base = installedServer.nodeId === 'local' ? '' : `/api/nodes/${installedServer.nodeId}/runtime`;
        const value = await nodesRequest<{ server: { installProgress?: typeof progress } }>(`${base}/api/servers/${installedServer.id}`);
        if (cancelled) return;
        setProgressError('');
        if (value.server.installProgress) {
          setProgress(value.server.installProgress);
          if (['completed', 'failed'].includes(value.server.installProgress.status)) {
            // Only an in-flight operation can be resumed; never reuse its result
            // as the state of a new installation (or erase a newer operation).
            try {
              const saved = JSON.parse(sessionStorage.getItem(installStorageKey) || 'null');
              if (saved?.id === installedServer.id && saved?.nodeId === installedServer.nodeId)
                sessionStorage.removeItem(installStorageKey);
            } catch { /* Browser storage is optional. */ }
            return;
          }
        }
      } catch {
        if (cancelled) return;
        setProgressError('Connection to installation status lost. Retrying; do not submit another installation.');
      }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };
    void poll();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [installedServer, installStorageKey]);
  useEffect(() => {
    nodesRequest<{ nodes: ExecutionNode[]; local?: LocalNode }>('/api/nodes')
      .then((v) => { setNodes(v.nodes); setLocalNode(v.local); })
      .catch(() => setError('Cannot load execution nodes'));
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setAllocations([]);
    setBindings(row.document.ports.map((p) => ({ key: p.key, hostIp: '', host: 'auto' })));
    nodesRequest<{ network: { allocations: typeof allocations } }>(
      `/api/nodes/${nodeId}/allocations`
    )
      .then((value) => {
        if (active) setAllocations(value.network.allocations);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [nodeId, row]);
  async function install() {
    setBusy(true);
    setError('');
    let dispatched = false;
    try {
      const base = nodeId === 'local' ? '' : `/api/nodes/${nodeId}/runtime`;
      const health = await nodesRequest<{
        templatesProtocol?: number;
        nativeRuntimeProtocol?: number;
        templateScriptsProtocol?: number;
        nativeSettingsProtocol?: number;
      }>(`${base}/api/health`);
      if (health.templatesProtocol !== 1)
        throw new Error(
          'Update this node agent before using Game Templates. No installation was sent.'
        );
      if (row.document.schemaVersion === 2 && health.nativeRuntimeProtocol !== 1)
        throw new Error(
          'This node does not support Native Runtime. Update its agent first. No installation was sent.'
        );
      const lifecycle = row.document.lifecycle;
      if (row.document.configFiles !== undefined && health.nativeSettingsProtocol !== 1)
        throw new Error('This node needs the native settings update before using template configuration links. No installation was sent.');
      if (lifecycle && (lifecycle.installerImage || [...lifecycle.install, ...lifecycle.update].some(step => step.script !== undefined)) && health.templateScriptsProtocol !== 1)
        throw new Error('This node does not support template scripts and installer images. Update its agent first. No installation was sent.');
      const { ticket } = await nodesRequest<{ ticket: string }>(
        `/api/game-templates/${row.id}/${row.version}/prepare`,
        { nodeId }
      );
      dispatched = true;
      const response = await nodesRequest<{
        server: {
          id: number;
          ports?: {
            tcp: Array<{ hostIp?: string; host: number }>;
            udp: Array<{ hostIp?: string; host: number }>;
          };
        };
      }>(`${base}/api/servers/install`, {
        templateTicket: ticket,
        name,
        bindings,
        variables,
        resourceLimits: {
          ...(memory ? { memoryMb: Number(memory) } : {}),
          ...(cpu ? { cpu: Number(cpu) } : {}),
        },
      });
      setVariables({});
      const target = { id: response.server.id, nodeId };
      if (resumePreviousInstallation) {
        try { sessionStorage.setItem(installStorageKey, JSON.stringify(target)); }
        catch { /* A storage failure must not hide a successfully created server. */ }
      }
      setInstalledServer(target);
      setProgress({ progress: 0, status: 'pending' });
      setShowProgress(true);
      const assigned = response.server.ports
        ? [
            ...new Set(
              [...response.server.ports.tcp, ...response.server.ports.udp].map(
                (p) => `${p.hostIp}:${p.host}`
              )
            ),
          ].join(', ')
        : '';
      setResult(
        `Server #${response.server.id} created.${assigned ? ` Connection: ${assigned}.` : ''} Installation is running on ${nodeId === 'local' ? 'Local' : nodes.find((n) => n.id === nodeId)?.name}. Check its logs for completion.`
      );
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 409) setPortRefresh((v) => v + 1);
      if (dispatched && (!status || status >= 500)) setUncertain(true);
      setError(e instanceof Error ? e.message : 'Installation failed');
    } finally {
      setBusy(false);
    }
  }
  const progressModal = installedServer && <InstallationProgressModal
          isOpen={showProgress} gameName={name} serverId={installedServer.id}
          progressPercent={progress.progress} status={progress.status} installError={progress.errorMessage}
          connectionWarning={progressError}
          installPlan={installPlan} nativeRuntime={row.document.schemaVersion === 2}
          canOpenConsole
          onOpenConsole={() => {
            sessionStorage.setItem('native-install-open-console', JSON.stringify(installedServer));
            selectNode(installedServer.nodeId);
          }}
          onClose={() => { setShowProgress(false); onDismiss?.(); }}
        />;
  if (installedServer && onDismiss) return progressModal;
  return (
    <div className={`${card} space-y-5`}>
      {installedServer && <>
        <button className={button} onClick={() => setShowProgress(true)}>Installation status · server #{installedServer.id}</button>
        {progressError && <p role="alert">{progressError}</p>}
        {progressModal}
      </>}
      <button className={button} disabled={busy} onClick={onClose}>
        <ArrowLeft size={16} />
        Catalog
      </button>
      <h2 className="text-2xl font-semibold">
        Install {row.document.name} · v{row.version}
      </h2>
      {error && (
        <p role="alert" className="text-red-500">
          {error}
        </p>
      )}
      {result || installedServer ? (
        <>
          <p role="status">{result || `Server #${installedServer?.id} · ${progress.status}`}</p>
          <button className={primary} onClick={() => selectNode(installedServer?.nodeId || nodeId)}>
            Open node servers
          </button>
          {['completed', 'failed'].includes(progress.status) && <button className={button} onClick={async () => {
            sessionStorage.removeItem(installStorageKey);
            setInstalledServer(null); setResult(''); setShowProgress(false);
          }}>Create another server</button>}
        </>
      ) : (
        <fieldset disabled={busy || uncertain} className="space-y-5">
          <div>
            <Field label="Panel server name" value={name} onChange={setName} />
            <p className="mt-1 text-xs text-slate-500">Name used to identify this server in the panel.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Memory limit (MiB; empty = unlimited)"
              type="number"
              value={memory}
              onChange={setMemory}
            />
            <Field
              label="CPU limit (cores; empty = unlimited)"
              type="number"
              value={cpu}
              onChange={setCpu}
            />
          </div>
          {fixedNodeId ? <p className="text-sm">Execution node: <strong>{nodeId === 'local' ? localNode?.name || 'Local' : nodes.find(n => n.id === nodeId)?.name || nodeId}</strong></p> : <Choice
            label="Execution node"
            value={nodeId}
            onChange={setNodeId}
            options={[
              { value: 'local', label: localNode?.name || 'Local' },
              ...nodes.map((n) => ({
                value: n.id,
                label: `${n.name} · ${n.location || n.status}`,
                disabled: n.status !== 'online',
              })),
            ]}
          />}
          {loading ? (
            <p>Loading node allocations…</p>
          ) : (
            <TemplatePortBindings
              nodeId={nodeId}
              ports={row.document.ports}
              allocations={allocations}
              bindings={bindings}
              onChange={setBindings}
              refresh={portRefresh}
              onRefresh={() => setPortRefresh((v) => v + 1)}
              onValidation={setPortValidation}
            />
          )}
          {!loading && row.document.ports.length > 0 && allocations.length === 0 && (
            <p>Add IP allocations in this node’s settings before installing.</p>
          )}
          {row.document.variables.map((v) => (
            <Field
              key={v.key}
              label={`${v.key === 'SERVER_NAME' && /^server name$/i.test(v.label.trim()) ? 'In-game server name (visible to players)' : v.label}${v.required ? ' *' : ''}${v.secret ? ' (secret)' : ''}`}
              type={v.secret ? 'password' : v.type === 'integer' ? 'number' : 'text'}
              value={variables[v.key] ?? v.default}
              onChange={(value) => setVariables({ ...variables, [v.key]: value })}
            />
          ))}
          <button
            className={primary}
            disabled={
              busy ||
              loading ||
              !portValidation.valid ||
              portValidation.signature !== bindingSignature(nodeId, bindings, portRefresh) ||
              !name.trim()
            }
            onClick={() => void install()}
          >
            {busy ? 'Submitting…' : 'Create server'}
          </button>
        </fieldset>
      )}
      {uncertain && (
        <div role="alert" className="space-y-3">
          <p>
            The response was not confirmed. Check this node’s server list before retrying to avoid
            duplicate installations.
          </p>
          <button className={button} onClick={() => selectNode(nodeId)}>
            Check node servers
          </button>
        </div>
      )}
    </div>
  );
}
