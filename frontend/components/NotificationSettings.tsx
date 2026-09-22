import { useEffect, useState } from 'react';
import { Bell, Save, Send } from 'lucide-react';
import { AppButton, AppToggle } from '../src/ui/components';
import { apiClient } from '../utils/api';
type Settings = { revision: number; enabled: boolean; webhookConfigured: boolean; categories: string[]; recent: Array<{ id: string; title: string; created_at: number; state: string; result: string | null }> };
const categories = [['game', 'Game outages and recovery'], ['node', 'Node connection'], ['backup', 'Backup and restore failures'], ['schedule', 'Failed or interrupted schedules'], ['recovery', 'Automatic restart attempts']];
export function NotificationSettings() {
    const [data,setData] = useState<Settings|null>(null), [webhook,setWebhook] = useState(''), [dirty,setDirty] = useState(false);
    const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('');
    useEffect(() => { let active=true; apiClient.getNotifications().then(v=>{if(active)setData(v);}).catch(()=>{if(active)setError('Could not load notification settings');}); return ()=>{active=false;}; },[]);
    const save = async () => {
        if (!data) return; setBusy(true);setError('');setNotice('');
        try { setData(await apiClient.saveNotifications({ revision:data.revision,enabled:data.enabled,categories:data.categories,...(webhook ? {webhook} : {}) }));setWebhook('');setDirty(false);setNotice('Notification settings saved.'); }
        catch(e:any) {setError(e.response?.data?.error || 'Could not save notification settings');} finally {setBusy(false);}
    };
    const test = async () => {
        setBusy(true);setError('');setNotice('');
        try {await apiClient.testNotifications();setNotice('Test queued. Refresh delivery history to check the result.');}
        catch(e:any){setError(e.response?.data?.error || 'Could not queue test notification');} finally {setBusy(false);}
    };
    return <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-[#111827]" aria-label="Discord notifications">
        <div className="flex items-center gap-3"><Bell size={22}/><h2 className="text-lg font-semibold">Discord notifications</h2></div>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">One notification per incident and recovery. Delivery history stays here, including unconfirmed results.</p>
        {!data&&!error&&<p role="status">Loading notifications…</p>}
        {data&&<div className="mt-5 space-y-4">
            <AppToggle label="Enable Discord notifications" checked={data.enabled} disabled={busy} onChange={enabled=>{setData({...data,enabled});setDirty(true);setNotice('');}}/>
            <label className="block text-sm">Discord webhook URL<input aria-label="Discord webhook URL" type="password" autoComplete="new-password" value={webhook} disabled={busy} onChange={e=>{setWebhook(e.target.value);setDirty(true);setNotice('');}} placeholder={data.webhookConfigured ? 'Webhook saved · leave blank to keep it' : 'https://discord.com/api/webhooks/…'} className="mt-2 w-full rounded-lg border border-gray-300 bg-transparent p-3 dark:border-gray-600"/></label>
            <p className="text-sm text-gray-500">The saved address is hidden. Disable notifications to stop sending; enter a new address to replace the destination.</p>
            <div className="grid gap-3 sm:grid-cols-2">{categories.map(([id,label])=><label key={id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.categories.includes(id)} disabled={busy} onChange={e=>{setData({...data,categories:e.target.checked?[...data.categories,id]:data.categories.filter(c=>c!==id)});setDirty(true);setNotice('');}}/>{label}</label>)}</div>
            <div className="flex flex-wrap gap-2"><AppButton onClick={()=>void save()} disabled={busy||!dirty}><Save size={16}/>Save notifications</AppButton><AppButton onClick={()=>void test()} disabled={busy||dirty||!data.enabled||!data.webhookConfigured}><Send size={16}/>Send test</AppButton><AppButton disabled={busy||dirty} onClick={()=>{setBusy(true);apiClient.getNotifications().then(setData).catch(()=>setError('Could not refresh delivery history')).finally(()=>setBusy(false));}}>Refresh history</AppButton></div>
            <div className="space-y-2"><h3 className="font-medium">Recent deliveries</h3>{!data.recent.length&&<p className="text-sm text-gray-500">No notifications yet.</p>}{data.recent.map(r=><div key={r.id} className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-700"><div className="flex flex-wrap justify-between gap-2"><span>{r.title}</span><span>{r.state}</span></div><p className="mt-1 text-gray-500 dark:text-gray-400">{new Date(r.created_at).toLocaleString()}{r.result?` · ${r.result}`:''}</p></div>)}</div>
        </div>}
        {notice&&<p className="mt-3 text-sm text-emerald-500" role="status">{notice}</p>}{error&&<p className="mt-3 text-sm text-red-400" role="alert">{error}</p>}
    </section>;
}
