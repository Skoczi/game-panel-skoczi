import { AppButton, AppInput, AppSelect, AppToggle } from '../src/ui/components';
import { cs16GameConfig } from '../../backend/src/templates/gameConfig';
import type { GameConfigDefinition, GameConfigField } from '../../backend/src/templates/types';
import type { GameTemplate } from '../utils/gameTemplates';

export function TemplateGameConfigEditor({ draft, change }: { draft: GameTemplate; change: (patch: Partial<GameTemplate>) => void }) {
  const config = draft.gameConfig;
  const update = (patch: Partial<GameConfigDefinition>) => config && change({ gameConfig: { ...config, ...patch } });
  const fieldUpdate = (section: number, field: number, patch: Partial<GameConfigField>) => config && update({ sections: config.sections.map((s, si) => si === section ? { ...s, fields: s.fields.map((f, fi) => fi === field ? { ...f, ...patch } : f) } : s) });
  const preset = () => {
    const file = draft.configFiles?.find(f => /\/cstrike\/server\.cfg$/i.test(f.path));
    const definition = cs16GameConfig(file?.path, file?.root);
    change({ gameConfig: definition, configFiles: file ? draft.configFiles : [...(draft.configFiles || []), { root: definition.root, path: definition.path, label: 'Server settings' }] });
  };
  if (draft.schemaVersion !== 2) return <p>Form-based Game Config is available for native templates.</p>;
  return <div className="space-y-5">
    <div><h3 className="text-lg font-semibold">Game Config</h3><p className="text-sm text-slate-500">Define the settings shown above configuration files. Values are read from the server file; the form never executes commands.</p></div>
    <AppToggle label="Enable configuration form" checked={Boolean(config)} onChange={enabled => enabled ? preset() : change({ gameConfig: false })} />
    {config === undefined && <p className="text-sm text-slate-500">Installed CS 1.6 / ReHLDS templates with a declared cstrike/server.cfg use the built-in compatibility profile. Published snapshots remain unchanged.</p>}
    {config === false && <p className="text-sm text-slate-500">Only configuration file links will be shown for this template.</p>}
    {config && <>
      <div className="flex flex-wrap gap-3 items-center"><span className="text-sm">Valve CFG · GoldSrc / Source</span><AppButton tone="ghost" onClick={() => { if (window.confirm('Replace the current form with the CS 1.6 preset?')) preset(); }}>Use CS 1.6 preset</AppButton></div>
      <div className="grid gap-4 md:grid-cols-2">
        <label>Data root<AppSelect controlLabel="Game Config root" value={config.root} options={draft.mounts.map(m => ({ value: m.key, label: m.key }))} onChange={root => {
          change({ gameConfig: { ...config, root }, configFiles: (draft.configFiles || []).map(f => f.root === config.root && f.path === config.path ? { ...f, root } : f) });
        }} /></label>
        <label>Configuration path<AppInput aria-label="Game Config path" value={config.path} onChange={e => {
          const path = e.target.value;
          change({ gameConfig: { ...config, path }, configFiles: (draft.configFiles || []).map(f => f.root === config.root && f.path === config.path ? { ...f, path } : f) });
        }} /></label>
      </div>
      <p className="text-sm text-slate-500">Choose the actual file loaded by the game. Hostname is read from this file. Starting map and player slots remain in server Settings.</p>
      {config.sections.map((section, si) => <section className="rounded-xl border border-slate-500/30 p-4 space-y-4" key={si}>
        <div className="grid gap-3 md:grid-cols-3">
          <label>Section ID<AppInput aria-label={`Section ${si + 1} ID`} value={section.id} onChange={e => update({ sections: config.sections.map((s, i) => i === si ? { ...s, id: e.target.value } : s) })} /></label>
          <label>Section name<AppInput aria-label={`Section ${si + 1} name`} value={section.label} onChange={e => update({ sections: config.sections.map((s, i) => i === si ? { ...s, label: e.target.value } : s) })} /></label>
          <label>Description<AppInput aria-label={`Section ${si + 1} description`} value={section.description} onChange={e => update({ sections: config.sections.map((s, i) => i === si ? { ...s, description: e.target.value } : s) })} /></label>
        </div>
        {section.fields.map((field, fi) => <details key={fi} className="rounded-lg border border-slate-500/20 p-3">
          <summary className="cursor-pointer text-sm font-semibold">{field.label || 'New setting'} <code className="ml-2 opacity-50">{field.key}</code></summary>
          <div className="grid gap-3 md:grid-cols-2 mt-4 text-sm">
            <label>Console variable<AppInput value={field.key} onChange={e => fieldUpdate(si, fi, { key: e.target.value })} /></label>
            <label>Label<AppInput value={field.label} onChange={e => fieldUpdate(si, fi, { label: e.target.value })} /></label>
            <label>Description<AppInput value={field.description} onChange={e => fieldUpdate(si, fi, { description: e.target.value })} /></label>
            <label>Control<AppSelect controlLabel={`${field.key} control`} value={field.type} options={['text', 'password', 'number', 'boolean', 'select'].map(value => ({ value, label: value }))} onChange={value => fieldUpdate(si, fi, { type: value as GameConfigField['type'], min: undefined, max: undefined, step: undefined, options: value === 'select' ? [{ value: '0', label: 'Option' }] : undefined })} /></label>
            <label>Applied on<AppSelect controlLabel={`${field.key} applies on`} value={field.apply} options={[{ value: 'map-change', label: 'Map / config reload' }, { value: 'restart', label: 'Restart' }]} onChange={apply => fieldUpdate(si, fi, { apply: apply as GameConfigField['apply'] })} /></label>
            {field.type === 'number' && <div className="flex gap-2">{(['min', 'max', 'step'] as const).map(key => <label className="min-w-0" key={key}>{key}<AppInput type="number" value={field[key] ?? ''} onChange={e => fieldUpdate(si, fi, { [key]: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>)}</div>}
            {field.type === 'select' && <div className="space-y-2"><span>Options</span>{field.options?.map((option, oi) => <div className="flex gap-2" key={oi}><AppInput aria-label="Option value" value={option.value} onChange={e => fieldUpdate(si, fi, { options: field.options!.map((o, i) => i === oi ? { ...o, value: e.target.value } : o) })} /><AppInput aria-label="Option label" value={option.label} onChange={e => fieldUpdate(si, fi, { options: field.options!.map((o, i) => i === oi ? { ...o, label: e.target.value } : o) })} /><AppButton tone="ghost" onClick={() => fieldUpdate(si, fi, { options: field.options!.filter((_, i) => i !== oi) })}>Remove</AppButton></div>)}<AppButton tone="ghost" onClick={() => fieldUpdate(si, fi, { options: [...(field.options || []), { value: String(field.options?.length || 0), label: 'Option' }] })}>Add option</AppButton></div>}
          </div>
          <AppButton tone="ghost" onClick={() => update({ sections: config.sections.map((s, i) => i === si ? { ...s, fields: s.fields.filter((_, f) => f !== fi) } : s) })}>Remove setting</AppButton>
        </details>)}
        <div className="flex gap-3"><AppButton tone="ghost" onClick={() => update({ sections: config.sections.map((s, i) => i === si ? { ...s, fields: [...s.fields, { key: '', label: 'New setting', description: '', type: 'text', apply: 'map-change' }] } : s) })}>Add setting</AppButton><AppButton tone="ghost" onClick={() => update({ sections: config.sections.filter((_, i) => i !== si) })}>Remove section</AppButton></div>
      </section>)}
      <AppButton tone="ghost" onClick={() => update({ sections: [...config.sections, { id: `section${config.sections.length + 1}`, label: 'New section', description: '', fields: [] }] })}>Add section</AppButton>
    </>}
  </div>;
}
