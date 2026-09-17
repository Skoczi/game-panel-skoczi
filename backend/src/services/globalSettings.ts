import { getDatabase } from '../database/init.js';
import { configuredBindAddresses, setManagedBindAddresses } from '../utils/bindAddresses.js';
import { configuredPortPolicy, setManagedPortPolicy } from '../utils/portPolicy.js';
import { allocationPolicy, DEFAULT_APPEARANCE, GlobalSettingsStore, type GlobalSettings } from './globalSettingsStore.js';

let store: GlobalSettingsStore;
export function globalSettings(): GlobalSettingsStore {
    if (!store) throw new Error('Panel settings are not initialized');
    return store;
}
export async function initializeGlobalSettings(): Promise<void> {
    const db = await getDatabase();
    // Saved settings take precedence. Environment values seed the first startup only.
    const exists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='panel_settings'");
    const saved = exists && await db.get('SELECT id FROM panel_settings WHERE id=1');
    let seed: GlobalSettings = { appearance: { ...DEFAULT_APPEARANCE }, network: { restrictPorts: false, allocations: [] } };
    if (!saved) {
        const policy = configuredPortPolicy();
        const format = (ranges: Array<{ from: number; to: number }>) => ranges.map(({ from, to }) => from === to ? `${from}` : `${from}-${to}`).join(',');
        seed.network = { restrictPorts: policy !== null, allocations: configuredBindAddresses().map((ip) => ({ ip, alias: '', tcp: format(policy?.[ip].tcp ?? []), udp: format(policy?.[ip].udp ?? []) })) };
    }
    store = new GlobalSettingsStore(db, (settings) => {
        setManagedPortPolicy(allocationPolicy(settings.network));
        setManagedBindAddresses(settings.network.allocations.map(({ ip }) => ip));
    });
    await store.initialize(seed);
}
