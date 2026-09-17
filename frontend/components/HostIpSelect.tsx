// Skoczi fork: operator-managed host IPv4 selection; never silently replace a saved IP.
import { useEffect, useState } from 'react';
import { apiClient } from '../utils/api';

export function HostIpSelect({ value = '', onChange, disabled = false, protocol = 'tcp', hostPort = '' }: {
  value?: string; onChange: (value: string) => void; disabled?: boolean;
  protocol?: 'tcp' | 'udp'; hostPort?: string;
}) {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [policy, setPolicy] = useState<Awaited<ReturnType<typeof apiClient.getBindAddresses>> | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    apiClient.getBindAddresses().then((result) => { if (active) { setAddresses(result.addresses); setPolicy(result); } })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const restricted = policy?.requireExplicitIp === true;
  const ranges = policy?.portsByIp?.[value]?.[protocol] ?? [];
  const portAllowed = /^\d+$/.test(hostPort) && ranges.some(({ from, to }) => Number(hostPort) >= from && Number(hostPort) <= to);
  return (
    <label className="block min-w-0 text-xs text-gray-500 dark:text-gray-400">
      Host IPv4
      <select aria-label="Host IPv4" value={value} disabled={disabled || loading || error}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 block w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-[#0f1723] text-gray-900 dark:text-white px-2 py-1.5 disabled:opacity-50">
        <option value="" disabled={restricted}>{restricted ? 'Choose IP' : 'Docker default (usually all interfaces)'}</option>
        {value && !addresses.includes(value) && <option value={value}>{value} — {loading ? 'loading' : 'not configured'}</option>}
        {addresses.map((address) => <option key={address} value={address}>{address}</option>)}
      </select>
      {error && <span role="alert">Cannot load allowed IPs. Reload before changing bindings.</span>}
      {restricted && value && <span className="block">Allowed {protocol.toUpperCase()}: {ranges.length ? ranges.map(({ from, to }) => from === to ? String(from) : `${from}–${to}`).join(', ') : 'none'}</span>}
      {restricted && (!value || (hostPort !== '' && !portAllowed)) && <span className="block" role="alert">{!value ? 'Select an IP for this port.' : 'Host port is outside the allowed ranges.'}</span>}
      {!loading && !error && addresses.length === 0 && <span>{restricted ? 'No IPs are available for publishing ports.' : 'Configure GAMEPANEL_BIND_IPS or GAMEPANEL_IP_PORTS to select an IPv4.'}</span>}
    </label>
  );
}
