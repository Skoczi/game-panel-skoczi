import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, Clock3, FileCode2, LockKeyhole, RefreshCw, Save, SlidersHorizontal } from 'lucide-react';
import type { GameConfigDefinition, GameTemplate } from '../../../backend/src/templates/types';
import { parseValveConfig, updateValveConfig, validateConfigValue } from '../../../backend/src/templates/gameConfig';
import { apiClient } from '../../utils/api';
import { AppButton } from '../../src/ui/components';

export function NativeConfigEditor({ serverId, definition, template, active, canWrite, onOpen, onDirtyChange }: {
  serverId: number; definition: GameConfigDefinition; template: GameTemplate;
  active: boolean; canWrite: boolean; onOpen: (path: string, root: string) => void; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [snapshot, setSnapshot] = useState<{ content: string; version?: string; path: string }>();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  const [review, setReview] = useState(false);
  const [reloadRequired, setReloadRequired] = useState(false);
  const parsed = useMemo(() => parseValveConfig(snapshot?.content || ''), [snapshot]);
  const fields = definition.sections.flatMap(s => s.fields);
  const changes = Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== parsed.values[key]));
  const changed = Object.keys(changes).length;
  const invalid = fields.some(f => changes[f.key] !== undefined && validateConfigValue(f, changes[f.key]));
  const startup = template.lifecycle?.startup.join(' ') || '';
  const ownedByStartup = (key: string) => new RegExp(`\\+${key}(?:\\s|$)`, 'i').test(startup);
  const complex = (key: string) => parsed.lines.some(line => line.key === key && line.value === undefined);
  const readOnly = !canWrite || !snapshot?.version || Boolean(parsed.issue);
  const current = useRef({ snapshot, changed, busy });
  current.current = { snapshot, changed, busy };
  useEffect(() => { onDirtyChange?.(changed > 0 || busy); }, [changed, busy, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!changed && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [changed, busy]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setMessage(''); setSnapshot(undefined); setDraft({}); setReview(false); setReloadRequired(false);
    void (async () => {
      const resolved = await apiClient.getNativeGameConfig(serverId).catch(e => { if (e?.response?.status === 404) throw new Error('Update this node to use the configuration form. Configuration files are still available.'); throw e; });
      if (!resolved.definition) throw new Error('No configuration form is available. Update this node or choose a profile in the template.');
      if (resolved.definition.root !== definition.root) throw new Error('The configuration profile changed. Reopen Game Config.');
      const path = resolved.definition.path;
      const file = await apiClient.readServerFileSnapshot(serverId, path, definition.root);
      if (file.bytes.byteLength > 1024 * 1024) throw new Error('This file is too large for the configurator. Use the file editor.');
      const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes);
      if (content.includes('\0')) throw new Error('This is not a text configuration file. Use the file manager.');
      if (!cancelled) setSnapshot({ content, version: file.version, path });
    })().catch(e => { if (!cancelled) setError(e?.response?.status === 404 ? 'Configuration file not found. Create it in the file editor or check the template path.' : e?.response?.data?.error || e.message || 'Could not load configuration.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [serverId, definition, template, reload]);
  useEffect(() => {
    if (!active || loading) return;
    let stopped = false, running = false;
    const refresh = async () => {
      const before = current.current;
      if (stopped || running || document.hidden || before.changed || before.busy || !before.snapshot) return;
      running = true;
      try {
        const file = await apiClient.readServerFileSnapshot(serverId, before.snapshot.path, definition.root);
        if (stopped || current.current.changed || current.current.busy || current.current.snapshot !== before.snapshot || file.version === before.snapshot.version) return;
        if (file.bytes.byteLength > 1024 * 1024) return;
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(file.bytes);
        if (content.includes('\0')) return;
        setSnapshot({ ...before.snapshot, content, version: file.version });
        setDraft({}); setReview(false); setMessage('Configuration refreshed from the file.');
      } catch { /* Keep the last snapshot. A save still requires its original version. */ }
      finally { running = false; }
    };
    const timer = window.setInterval(() => void refresh(), 20000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => { stopped = true; clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [serverId, definition.root, active, loading]);
  const save = async () => {
    if (!snapshot || readOnly || invalid || !changed || busy || reloadRequired) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const content = updateValveConfig(snapshot.content, definition, changes);
      const result = await apiClient.updateServerFile(serverId, snapshot.path, content, definition.root, snapshot.version);
      setSnapshot({ ...snapshot, content, version: result.version }); setDraft({}); setReview(false);
      setMessage('Configuration saved. The game has not been restarted. Changes take effect when this file is loaded again.' + (result.historyWarning ? ` ${result.historyWarning}` : ''));
    } catch (e: any) {
      const conflict = e?.response?.status === 409 || e?.response?.status === 412;
      const unknown = !e?.response || e.response.status >= 500;
      setReloadRequired(conflict || unknown);
      setError(conflict ? 'The file changed since you opened it. Your edits are still here. Reload the file before making a new save.' : unknown ? 'The save result could not be confirmed. Reload the file to check its contents before trying again.' : e?.response?.data?.error || e.message || 'Could not save configuration.');
    } finally { setBusy(false); }
  };
  const edit = (key: string, value: string) => { current.current.changed = 1; setDraft(d => ({ ...d, [key]: value })); setReview(false); setMessage(''); };
  const displayValue = (key: string, value?: string) => fields.find(f => f.key === key)?.type === 'password' && value ? '••••••••' : value === undefined ? 'Not set in file' : value === '' ? '(empty)' : value;
  return <div className="gp-config-editor">
    <div className="gp-config-overview">
      <span className="gp-config-overview-icon"><SlidersHorizontal size={24} /></span>
      <div><h4>Server configuration</h4><p>Name, match rules and player access.</p><code>{snapshot?.path || definition.path}</code></div>
      <span className="gp-config-profile-badge">{fields.length} settings</span>
    </div>
    <div className="gp-config-editor-toolbar">
      <span><Clock3 size={15} /> Saved to file · applied when configuration reloads</span>
      <AppButton tone="ghost" disabled={busy || loading} onClick={() => { if (!changed || window.confirm('Discard your unsaved configuration changes and reload the file?')) setReload(r => r + 1); }}><RefreshCw size={15} />{reloadRequired ? 'Reload changed file' : 'Reload'}</AppButton>
    </div>
    {loading && <div className="gp-config-loading" role="status"><RefreshCw className="animate-spin" size={22} /><div><strong>Reading your configuration</strong><p>Preparing settings and the current file version…</p></div></div>}
    {error && <div className="gp-config-notice is-error" role="alert">{error}</div>}
    {message && <div className="gp-config-notice is-success" role="status"><Check size={18} />{message}</div>}
    {!loading && snapshot && <>
      {readOnly && <div className="gp-config-notice">{!canWrite ? 'Read-only access. File write permission is required to save changes.' : parsed.issue || 'This agent did not provide a file version. Update it before using the configurator.'}</div>}
      <div className="gp-config-section-grid">
        {definition.sections.map((section, index) => <section className="gp-config-section" key={section.id}>
          <header><span className="gp-config-section-number">{String(index + 1).padStart(2, '0')}</span><div><h4>{section.label}</h4><p>{section.description}</p></div></header>
          <div className="gp-config-fields">{section.fields.map(field => {
            const value = draft[field.key] ?? parsed.values[field.key];
            const modified = changes[field.key] !== undefined;
            const validation = modified ? validateConfigValue(field, changes[field.key]) : null;
            const locked = ownedByStartup(field.key) || complex(field.key);
            const disabled = readOnly || locked || busy;
            const id = `game-config-${field.key}`;
            return <div key={field.key} className={`gp-config-field${modified ? ' is-modified' : ''}`}>
              <div className="gp-config-field-label"><label htmlFor={id}>{field.label}</label>{modified && <span>Modified</span>}{locked && <LockKeyhole size={13} aria-label="Managed setting" />}</div>
              <p id={`${id}-help`}>{ownedByStartup(field.key) ? 'Controlled by the startup configuration. Edit it in server Settings.' : complex(field.key) ? 'This command uses complex syntax. Use the file editor.' : field.description}</p>
              {field.type === 'boolean' || field.type === 'select' ? <select id={id} value={value ?? '__unset__'} disabled={disabled} aria-describedby={`${id}-help`} onChange={e => edit(field.key, e.target.value)}>
                <option value="__unset__" disabled>Not set in file</option>
                {field.type === 'boolean' ? <><option value="1">On</option><option value="0">Off</option></> : field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                {value !== undefined && !(field.type === 'boolean' ? ['0', '1'] : field.options?.map(o => o.value) || []).includes(value) && <option value={value}>Current: {value}</option>}
              </select> : <input id={id} type={field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'} autoComplete="off" value={value ?? ''} placeholder="Not set in file" min={field.min} max={field.max} step={field.step ?? 'any'} maxLength={256} disabled={disabled} aria-invalid={Boolean(validation)} aria-describedby={`${id}-help`} onChange={e => edit(field.key, e.target.value)} />}
              <div className="gp-config-field-meta"><code>{field.key}</code><span>{field.apply === 'restart' ? 'Next restart' : 'Next map / config reload'}</span></div>
              {validation && <p className="gp-config-validation" role="alert">{validation}</p>}
            </div>;
          })}</div>
        </section>)}
      </div>
      {review && <section className="gp-config-review" aria-label="Review configuration changes"><h4>Review changes <span>{changed}</span></h4>
        {Object.entries(changes).map(([key, value]) => <div className="gp-config-diff" key={key}><strong>{fields.find(f => f.key === key)?.label}</strong><code>{displayValue(key, parsed.values[key])}</code><ArrowRight size={15} /><code>{displayValue(key, value)}</code></div>)}
        <p>Only these settings will change. Comments and other commands stay in the file. Plugins or other config files can override them when the game runs.</p>
      </section>}
      <footer className="gp-config-savebar"><div><strong>{changed ? `${changed} unsaved ${changed === 1 ? 'change' : 'changes'}` : 'Configuration up to date'}</strong><span>{changed ? 'Review your changes before saving.' : 'Values reflect the file, not live console overrides.'}</span></div>
        <div><AppButton tone="ghost" disabled={busy} onClick={() => onOpen(snapshot.path, definition.root)}><FileCode2 size={16} />File editor</AppButton>
          {canWrite && <AppButton tone="primary" disabled={readOnly || !changed || invalid || busy || reloadRequired} onClick={() => review ? void save() : setReview(true)}><Save size={16} />{busy ? 'Saving…' : review ? 'Save changes' : 'Review changes'}</AppButton>}</div>
      </footer>
    </>}
  </div>;
}
