import { useEffect, useState } from 'react';
import { Network, Pencil, Plus, Save, Settings2, Trash2 } from 'lucide-react';
import { apiClient } from '../utils/api';
import type { Allocation, Assignment, GlobalSettings as Settings } from '../types/globalSettings';
import { PanelBrand } from './PanelBrand';

const blank: Allocation = { ip: '', alias: '', tcp: '', udp: '' };
const field = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-[#0f1723] dark:text-white';
const card = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-[#111827]';
const button = 'rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800';

export function GlobalSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState<Allocation>(blank);
  const [editing, setEditing] = useState<number | null>(null);

  async function load() {
    setBusy(true); setError('');
    try {
      const { assignments: used, ...value } = await apiClient.getGlobalSettings();
      setSettings(value); setAssignments(used); setDirty(false); setDraft(blank); setEditing(null);
    } catch { setError('Cannot load settings. Root administrator access is required.'); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);

  function update(value: Settings) { setSettings(value); setDirty(true); setNotice(''); }
  async function uploadLogo(file?: File) {
    if (!file || !settings) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 256 * 1024) {
      setError('Choose a PNG, JPEG or WebP image up to 256 KiB.'); return;
    }
    setBusy(true);
    try {
      const logo = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file);
      });
      setSettings((current) => current ? { ...current, appearance: { ...current.appearance, logo } } : current);
      setDirty(true); setNotice(''); setError('');
    } catch { setError('Cannot read this image.'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!settings) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await apiClient.saveGlobalSettings(settings);
      setSettings(saved); setDirty(false); setNotice('Settings saved. Changes are active.');
      window.dispatchEvent(new Event('panel-settings-changed'));
    } catch (reason) {
      const message = (reason as { response?: { data?: { error?: string } } }).response?.data?.error;
      setError(message || 'Cannot save settings. Your changes remain in the form.');
    } finally { setBusy(false); }
  }

  function addAllocation(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    const row = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, value.trim()])) as Allocation;
    if (settings.network.allocations.some((item, index) => item.ip === row.ip && index !== editing)) { setError('This IP is already listed. Edit its ranges instead.'); return; }
    const allocations = [...settings.network.allocations];
    if (editing === null) allocations.push(row); else allocations[editing] = row;
    update({ ...settings, network: { ...settings.network, allocations } });
    setDraft(blank); setEditing(null); setError('');
  }

  return <div className="space-y-6 text-gray-900 dark:text-gray-100">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">Settings</h1><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Host allocations and panel appearance</p></div>
      <div className="flex items-center gap-2">
        {dirty && <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>}
        <button className={button} disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard unsaved changes and reload?')) { setNotice(''); void load(); } }}>Reload</button>
        <button className="flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50" disabled={busy || !dirty} onClick={() => void save()}><Save size={16} />{busy ? 'Working…' : 'Save changes'}</button>
      </div>
    </header>
    {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</div>}
    {notice && <div role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">{notice}</div>}
    {!settings && !error && <p>Loading settings…</p>}
    {settings && <fieldset disabled={busy} className="min-w-0 space-y-6">
      <section className={card}>
        <h2 className="flex items-center gap-2 text-lg font-semibold"><Settings2 size={20} />Appearance</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Visibility for all users. Disabling announcements also stops their browser requests. Legal notices remain available.</p>
        <div className="mt-4 flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.appearance.showFollowUs} onChange={(event) => update({ ...settings, appearance: { ...settings.appearance, showFollowUs: event.target.checked } })} />Show Follow Us</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.appearance.showTrustpilot} onChange={(event) => update({ ...settings, appearance: { ...settings.appearance, showTrustpilot: event.target.checked } })} />Show Trustpilot</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.appearance.showNews} onChange={(event) => update({ ...settings, appearance: { ...settings.appearance, showNews: event.target.checked } })} />Show announcements</label>
        </div>
      </section>
      <section className={card}>
        <h2 className="text-lg font-semibold">Branding &amp; login page</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">These fields are public, including before sign-in. Do not enter secrets. Text is displayed as plain text, not HTML.</p>
        <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
            {(['siteName', 'siteSubtitle', 'loginDescription', 'loginFooter'] as const).map((key) => <label className="block text-sm" key={key}>
              {{ siteName: 'Site name', siteSubtitle: 'Subtitle (optional)', loginDescription: 'Login description (optional)', loginFooter: 'Login footer text' }[key]}
              <input className={`${field} mt-1`} value={settings.appearance[key]} maxLength={key === 'siteName' ? 80 : key === 'siteSubtitle' ? 120 : 240} onChange={(event) => update({ ...settings, appearance: { ...settings.appearance, [key]: event.target.value } })} />
            </label>)}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.appearance.showLoginFooter} onChange={(event) => update({ ...settings, appearance: { ...settings.appearance, showLoginFooter: event.target.checked } })} />Show login footer</label>
            <label className="block text-sm">Logo HTTPS URL<input type="url" placeholder="https://example.com/logo.png" className={`${field} mt-1`} maxLength={2048} value={settings.appearance.logo.startsWith('data:') ? '' : settings.appearance.logo} onChange={(event) => update({ ...settings, appearance: { ...settings.appearance, logo: event.target.value } })} /></label>
            <label className="block text-sm">Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" className="mt-2 block w-full text-sm" onChange={(event) => { void uploadLogo(event.target.files?.[0]); event.target.value = ''; }} /></label>
            <p className="text-xs text-gray-500">PNG, JPEG or WebP, up to 256 KiB. Uploads stay in the panel database. HTTPS images load directly in visitors’ browsers. One logo is used on login and in the sidebar.</p>
            {settings.appearance.logo && <button type="button" className={button} onClick={() => update({ ...settings, appearance: { ...settings.appearance, logo: '' } })}>Remove logo</button>}
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-sm font-medium">Login preview</p>
            <div className="rounded-xl px-6 py-8" style={{ background: 'linear-gradient(135deg, #000e9c, #002dbe)' }}>
              <PanelBrand appearance={settings.appearance} />
              {settings.appearance.loginDescription && <p className="mt-4 break-words text-center text-sm" style={{ color: '#fff' }}>{settings.appearance.loginDescription}</p>}
              <div className="mt-6 space-y-3 rounded-xl bg-white p-5" aria-hidden="true"><div className="h-9 rounded border border-gray-200 bg-gray-50" /><div className="h-9 rounded border border-gray-200 bg-gray-50" /><div className="rounded bg-blue-700 p-2 text-center text-sm" style={{ color: '#fff' }}>Sign In</div></div>
              {settings.appearance.showLoginFooter && <p className="mt-5 break-words text-center text-xs" style={{ color: '#fff' }}>{settings.appearance.loginFooter}</p>}
            </div>
            <p className="mt-3 text-xs text-gray-500">Site name also sets the browser tab title. Blank subtitle or description hides that line. Save changes to publish.</p>
          </div>
        </div>
      </section>
      <section className="space-y-4">
        <div><h2 className="flex items-center gap-2 text-lg font-semibold"><Network size={20} />IP allocations</h2><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">IPs must already exist on the host. Adding one here does not create an interface or firewall rule.</p></div>
        <div className={card}>
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={settings.network.restrictPorts} onChange={(event) => update({ ...settings, network: { ...settings.network, restrictPorts: event.target.checked } })} />Restrict published ports to these allocations</label>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">When enabled, every port needs an explicit IP. Empty TCP or UDP ranges deny that protocol. Existing server bindings must fit before saving.</p>
          {!settings.network.restrictPorts && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">Legacy mode: port ranges are not enforced and Docker default bindings remain available.</p>}
          {settings.network.restrictPorts && settings.network.allocations.length === 0 && <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">No allocations: publishing new ports will be denied.</p>}
        </div>
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className={`${card} min-w-0`}>
            <h3 className="mb-4 font-semibold">Configured addresses <span className="ml-2 text-sm font-normal text-gray-500">{settings.network.allocations.length}</span></h3>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-gray-500"><tr>{['IP / alias', 'TCP ports', 'UDP ports', 'Used by', 'Actions'].map((heading) => <th key={heading} className="border-b border-gray-200 px-2 py-3 dark:border-gray-700">{heading}</th>)}</tr></thead>
              <tbody>{settings.network.allocations.map((row, index) => <tr key={row.ip} className="border-b border-gray-100 dark:border-gray-800">
                <td className="px-2 py-3"><span className="whitespace-nowrap font-mono">{row.ip}</span><span className="block text-xs text-gray-500">{row.alias || 'No alias'}</span></td>
                <td className="max-w-48 break-words px-2 py-3 font-mono text-xs">{row.tcp || 'None'}</td><td className="max-w-48 break-words px-2 py-3 font-mono text-xs">{row.udp || 'None'}</td>
                <td className="px-2 py-3 text-xs">{[...new Set(assignments.filter((used) => used.ip === row.ip).map((used) => used.serverName))].join(', ') || 'Unassigned'}</td>
                <td className="px-2 py-3"><div className="flex gap-2"><button type="button" className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700" aria-label={`Edit ${row.ip}`} onClick={() => { setEditing(index); setDraft({ ...row }); }}><Pencil size={16} /></button>
                  <button type="button" className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30 dark:hover:bg-gray-700" aria-label={`Remove ${row.ip}`} disabled={assignments.some((used) => used.ip === row.ip)} title="Assigned IPs must be released by their servers first" onClick={() => { update({ ...settings, network: { ...settings.network, allocations: settings.network.allocations.filter((_, i) => i !== index) } }); setEditing(null); setDraft(blank); }}><Trash2 size={16} /></button></div></td>
              </tr>)}</tbody></table></div>
            {!settings.network.allocations.length && <p className="py-8 text-center text-sm text-gray-500">No IP allocations yet. Add an address and its allowed ports.</p>}
          </div>
          <form className={`${card} space-y-4`} onSubmit={addAllocation}>
            <h3 className="font-semibold">{editing === null ? 'Add allocation' : 'Edit allocation'}</h3>
            {(['ip', 'alias', 'tcp', 'udp'] as const).map((key) => <label key={key} className="block text-sm">{{ ip: 'IP address', alias: 'Alias (optional)', tcp: 'TCP ports', udp: 'UDP ports' }[key]}<input className={`${field} mt-1`} value={draft[key]} required={key === 'ip'} maxLength={key === 'ip' ? 15 : key === 'alias' ? 80 : 1024} placeholder={key === 'ip' ? '192.0.2.10' : key === 'alias' ? 'Game node' : '27015-27030,28015'} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
            <p className="text-xs text-gray-500">Comma-separated ports or inclusive ranges, 1025–65535. Alias is a label, not a DNS name.</p>
            <div className="flex gap-2"><button className={`${button} flex items-center gap-2`} type="submit"><Plus size={16} />{editing === null ? 'Add to list' : 'Update entry'}</button>{editing !== null && <button className={button} type="button" onClick={() => { setEditing(null); setDraft(blank); }}>Cancel</button>}</div>
            <p className="text-xs text-gray-500">Use Save changes to apply the list.</p>
          </form>
        </div>
      </section>
      <section className={card}>
        <h2 className="mb-4 text-lg font-semibold">Assigned ports</h2>
        <p className="mb-4 text-sm text-gray-500">Saved panel bindings, including stopped servers. Other host services are not listed.</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['IP', 'Protocol', 'Port', 'Server'].map((label) => <th className="border-b border-gray-200 px-3 py-2 dark:border-gray-700" key={label}>{label}</th>)}</tr></thead><tbody>{assignments.map((used, index) => <tr key={index}><td className="px-3 py-2 font-mono">{used.ip || 'Docker default'}</td><td className="px-3 py-2 uppercase">{used.protocol}</td><td className="px-3 py-2">{used.port}</td><td className="px-3 py-2">{used.serverName}</td></tr>)}</tbody></table></div>
        {!assignments.length && <p className="py-4 text-sm text-gray-500">No server ports assigned.</p>}
      </section>
    </fieldset>}
  </div>;
}
