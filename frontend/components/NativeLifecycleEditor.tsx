import type { GameTemplate } from '../utils/gameTemplates';

const field = 'mt-1 w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 dark:border-slate-600';
const button = 'rounded-xl border border-slate-300 px-4 py-2 text-sm dark:border-slate-600';
export function NativeLifecycleEditor({ draft, change }: { draft: GameTemplate; change: (patch: Partial<GameTemplate>) => void }) {
  const lifecycle = draft.lifecycle;
  if (!lifecycle) return <div className="space-y-4">
    <p>This template delegates installation and startup to its provider image. Native mode stores both recipes in the panel and executes them on the selected node.</p>
    <p className="text-sm text-slate-500">Existing servers are not migrated. Choose a reviewed runtime image and define its commands before publishing.</p>
    <button className={button} onClick={() => change({
      schemaVersion: 2,
      runtime: { ...draft.runtime, provider: 'external', image: '', catalogId: '', gameServerName: '', identity: { user: '1000', uid: 1000, gid: 1000 } },
      ports: draft.ports.map(p => ({ ...p, linuxgsmKey: '' })),
      lifecycle: { startup: ['/data/server'], install: [], update: [], workdir: draft.mounts[0]?.containerPath || '/data', stopSignal: 'SIGTERM', stopTimeoutSeconds: 30 },
    })}>Use Native Runtime in this draft</button>
  </div>;
  const update = (patch: Partial<typeof lifecycle>) => change({ lifecycle: { ...lifecycle, ...patch } });
  return <div className="space-y-6">
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm">
      Native Runtime · Schema 2. Commands run as the configured non-root user in containers, never on the host.
      The node must already have the runtime image. Start and restart never run the install or update steps.
    </div>
    <label className="block text-sm font-medium">Startup arguments (one per line)
      <textarea aria-label="Startup arguments" className={`${field} font-mono`} rows={7} value={lifecycle.startup.join('\n')} onChange={e => update({ startup: e.target.value.split('\n') })} />
    </label>
    <p className="text-sm text-slate-500">First line: absolute executable path. Use {'{{VARIABLE}}'} for declared variables or managed port variables. Arguments are passed directly, without a shell. Do not add quoting around values.</p>
    <div className="grid gap-4 md:grid-cols-3">
      <label className="text-sm">Working directory<input className={field} value={lifecycle.workdir} onChange={e => update({ workdir: e.target.value })} /></label>
      <label className="text-sm">Stop timeout (seconds)<input className={field} type="number" min={1} max={120} value={lifecycle.stopTimeoutSeconds} onChange={e => update({ stopTimeoutSeconds: Number(e.target.value) })} /></label>
      <fieldset className="text-sm"><legend>Stop signal</legend><div className="mt-3 flex gap-4">{(['SIGTERM', 'SIGINT'] as const).map(signal => <label key={signal}><input type="radio" name="native-stop-signal" checked={lifecycle.stopSignal === signal} onChange={() => update({ stopSignal: signal })} /> {signal}</label>)}</div></fieldset>
    </div>
    {(['install', 'update'] as const).map(phase => <section key={phase} className="space-y-3 border-t border-slate-300 pt-5 dark:border-slate-700">
      <h3 className="font-semibold">{phase === 'install' ? 'Installation' : 'Explicit update'} steps</h3>
      {lifecycle[phase].map((step, index) => {
        const edit = (patch: Partial<typeof step>) => update({ [phase]: lifecycle[phase].map((value, i) => i === index ? { ...value, ...patch } : value) });
        return <div key={index} className="space-y-3 rounded-xl border border-slate-300 p-4 dark:border-slate-700">
          <label className="block text-sm">Step name<input className={field} value={step.name} onChange={e => edit({ name: e.target.value })} /></label>
          <label className="block text-sm">Command arguments (one per line)<textarea className={`${field} font-mono`} rows={4} value={step.argv.join('\n')} onChange={e => edit({ argv: e.target.value.split('\n') })} /></label>
          <label className="block text-sm">Timeout (1–3600 seconds)<input className={field} type="number" min={1} max={3600} value={step.timeoutSeconds} onChange={e => edit({ timeoutSeconds: Number(e.target.value) })} /></label>
          <button className={button} onClick={() => update({ [phase]: lifecycle[phase].filter((_, i) => i !== index) })}>Remove step</button>
        </div>;
      })}
      <button className={button} disabled={lifecycle[phase].length >= 8} onClick={() => update({ [phase]: [...lifecycle[phase], { name: 'New step', argv: ['/usr/local/lib/gamepanel/install'], timeoutSeconds: 1800 }] })}>Add {phase} step</button>
    </section>)}
    <p className="text-sm text-amber-600 dark:text-amber-400">Publish only reviewed recipes. A command can modify all files mounted into its server. Keep installer scripts inside your reviewed runtime image; avoid download-and-execute commands.</p>
  </div>;
}
