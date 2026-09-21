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
      The node must already have the runtime and installer images. Start and restart never run the install or update steps.
    </div>
    <label className="block text-sm font-medium">Installer image (optional)
      <input className={`${field} font-mono`} placeholder="Same as runtime image" value={lifecycle.installerImage ?? ''} onChange={e => {
        const next = { ...lifecycle };
        if (e.target.value) next.installerImage = e.target.value;
        else delete next.installerImage;
        change({ lifecycle: next });
      }} />
    </label>
    <p className="text-sm text-slate-500">Shared installation environment with Bash and download tools, independent of the game image in Runtime. Both images are pinned at installation. Changing this draft does not change existing servers.</p>
    <label className="block text-sm font-medium">Startup arguments (one per line)
      <textarea aria-label="Startup arguments" className={`${field} font-mono`} rows={7} value={lifecycle.startup.join('\n')} onChange={e => update({ startup: e.target.value.split('\n') })} />
    </label>
    <p className="text-sm text-slate-500">First line: absolute executable path. Use {'{{VARIABLE}}'} for declared variables or managed port variables. Arguments are passed directly, without a shell. Do not add quoting around values.</p>
    <label className="block text-sm font-medium">Stop command (optional)
      <input aria-label="Stop command" className={`${field} font-mono`} maxLength={1000} placeholder="For example: quit or stop" value={lifecycle.stopCommand ?? ''} onChange={e => {
        const next = { ...lifecycle };
        if (e.target.value) next.stopCommand = e.target.value;
        else delete next.stopCommand;
        change({ lifecycle: next });
      }} />
    </label>
    <p className="text-sm text-slate-500">Sent to the game console before stopping. The panel waits for the process to exit; the stop signal is a fallback if it does not respond. Leave empty to use the stop signal directly.</p>
    <div className="grid gap-4 md:grid-cols-3">
      <label className="text-sm">Working directory<input className={field} value={lifecycle.workdir} onChange={e => update({ workdir: e.target.value })} /></label>
      <label className="text-sm">Stop timeout (seconds)<input className={field} type="number" min={1} max={120} value={lifecycle.stopTimeoutSeconds} onChange={e => update({ stopTimeoutSeconds: Number(e.target.value) })} /></label>
      <fieldset className="text-sm"><legend>Stop signal</legend><div className="mt-3 flex gap-4">{(['SIGTERM', 'SIGINT'] as const).map(signal => <label key={signal}><input type="radio" name="native-stop-signal" checked={lifecycle.stopSignal === signal} onChange={() => update({ stopSignal: signal })} /> {signal}</label>)}</div></fieldset>
    </div>
    <section className="space-y-3 border-t border-slate-300 pt-5 dark:border-slate-700">
      <h3 className="font-semibold">Game configuration files</h3>
      <p className="text-sm text-slate-500">Expose exact configuration files in Server Settings. Paths are relative to the selected data mount, not the host filesystem.</p>
      {(draft.configFiles ?? []).map((file, index) => <div key={index} className="grid gap-2 md:grid-cols-4">
        <input aria-label={`Configuration label ${index + 1}`} className={field} value={file.label} placeholder="Label" onChange={e => change({ configFiles: draft.configFiles!.map((f, i) => i === index ? { ...f, label: e.target.value } : f) })} />
        <select aria-label={`Configuration root ${index + 1}`} className={field} value={file.root} onChange={e => change({ configFiles: draft.configFiles!.map((f, i) => i === index ? { ...f, root: e.target.value } : f) })}>{draft.mounts.map(m => <option key={m.key} value={m.key}>{m.containerPath}</option>)}</select>
        <input aria-label={`Configuration path ${index + 1}`} className={field} value={file.path} placeholder="/serverfiles/game/server.cfg" onChange={e => change({ configFiles: draft.configFiles!.map((f, i) => i === index ? { ...f, path: e.target.value } : f) })} />
        <button className={button} onClick={() => change({ configFiles: draft.configFiles!.filter((_, i) => i !== index) })}>Remove file</button>
      </div>)}
      <button className={button} disabled={!draft.mounts.length || (draft.configFiles?.length ?? 0) >= 32} onClick={() => change({ configFiles: [...(draft.configFiles ?? []), { root: draft.mounts[0].key, path: '/server.cfg', label: 'Server configuration' }] })}>Add configuration file</button>
    </section>
    {(['install', 'update'] as const).map(phase => <section key={phase} className="space-y-3 border-t border-slate-300 pt-5 dark:border-slate-700">
      <h3 className="font-semibold">{phase === 'install' ? 'Installation' : 'Explicit update'} steps</h3>
      {lifecycle[phase].map((step, index) => {
        const edit = (patch: { name?: string; timeoutSeconds?: number; script?: string; argv?: string[] }) => update({ [phase]: lifecycle[phase].map((value, i) => i === index ? { ...value, ...patch } as typeof step : value) });
        return <div key={index} className="space-y-3 rounded-xl border border-slate-300 p-4 dark:border-slate-700">
          <label className="block text-sm">Step name<input className={field} value={step.name} onChange={e => edit({ name: e.target.value })} /></label>
          {step.script !== undefined ? <>
            <label className="block text-sm">Bash script<textarea aria-label={`${phase} script ${index + 1}`} className={`${field} font-mono text-sm`} rows={14} spellCheck={false} maxLength={16384} value={step.script} onChange={e => edit({ script: e.target.value.replace(/\r\n?/g, '\n') })} /></label>
            <p className="text-sm text-slate-500">Stored in the versioned template. Bash runs with errexit, nounset and pipefail. Read variables as quoted environment values, e.g. {'"${MAP}"'} — no {'{{VARIABLE}}'} substitution in script source. Data directory: {lifecycle.workdir}. Maximum 16 KiB per script.</p>
          </> : <label className="block text-sm">Command arguments (one per line)<textarea className={`${field} font-mono`} rows={4} value={step.argv.join('\n')} onChange={e => edit({ argv: e.target.value.split('\n') })} /></label>}
          <label className="block text-sm">Timeout (1–3600 seconds)<input className={field} type="number" min={1} max={3600} value={step.timeoutSeconds} onChange={e => edit({ timeoutSeconds: Number(e.target.value) })} /></label>
          <button className={button} onClick={() => update({ [phase]: lifecycle[phase].filter((_, i) => i !== index) })}>Remove step</button>
        </div>;
      })}
      <button className={button} disabled={lifecycle[phase].length >= 8} onClick={() => update({ [phase]: [...lifecycle[phase], { name: 'New step', argv: ['/usr/local/lib/gamepanel/install'], timeoutSeconds: 1800 }] })}>Add {phase} step</button>
      <button className={`${button} ml-2`} disabled={lifecycle[phase].length >= 8} onClick={() => update({ [phase]: [...lifecycle[phase], { name: phase === 'install' ? 'Install game files' : 'Update game files', script: '#!/bin/bash\n# Add your reviewed recipe here. Runs only on explicit ' + phase + '.\nexit 1\n', timeoutSeconds: 1800 }] })}>Add {phase} script</button>
    </section>)}
    <p className="text-sm text-amber-600 dark:text-amber-400">Only administrators may publish scripts. They can modify the server’s mounted files and access the network. Use reviewed, pinned downloads; never embed credentials. Pterodactyl scripts need adapting: no root, no chmod 777, and use the declared data directory instead of assuming /mnt/server. Importing a template never runs its script.</p>
  </div>;
}
