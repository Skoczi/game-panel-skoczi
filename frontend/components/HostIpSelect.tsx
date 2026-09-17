// Skoczi fork: operator-managed host IPv4 selection; never silently replace a saved IP.
import { useEffect, useState } from 'react';
import { apiClient } from '../utils/api';

export function HostIpSelect({ value = '', onChange, disabled = false }: {
  value?: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    apiClient.getBindAddresses().then((result) => { if (active) setAddresses(result.addresses); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return (
    <label className="block min-w-0 text-xs text-gray-500 dark:text-gray-400">
      Host IPv4
      <select aria-label="Host IPv4" value={value} disabled={disabled || loading || error}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#0f1723] text-gray-900 dark:text-white px-2 py-1.5 disabled:opacity-50">
        <option value="">Docker default (usually all interfaces)</option>
        {value && !addresses.includes(value) && <option value={value}>{value} — {loading ? 'loading' : 'not configured'}</option>}
        {addresses.map((address) => <option key={address} value={address}>{address}</option>)}
      </select>
      {error && <span role="alert">Cannot load allowed IPs. Reload before changing bindings.</span>}
      {!loading && !error && addresses.length === 0 && <span>Configure GAMEPANEL_BIND_IPS to select a specific IPv4.</span>}
    </label>
  );
}
