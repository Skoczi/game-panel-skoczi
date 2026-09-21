// Skoczi fork: operator-managed host IPv4 selection; never silently replace a saved IP.
import { useEffect, useState } from 'react';
import { apiClient } from '../utils/api';
import { AppSelect } from '../src/ui/components';

export function HostIpSelect({ value = '', onChange, disabled = false, protocol = 'tcp', hostPort = '' }: {
  value?: string; onChange: (value: string) => void; disabled?: boolean;
  protocol?: 'tcp' | 'udp'; hostPort?: string;
}) {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [policy, setPolicy] = useState<Awaited<ReturnType<typeof apiClient.getBindAddresses>> | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
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
    <div className="block min-w-0 text-xs text-gray-500 dark:text-gray-400"
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          const trigger = event.currentTarget.querySelector<HTMLButtonElement>('button[role="combobox"]');
          requestAnimationFrame(() => trigger?.focus());
        }
      }}>
      <span>Host IPv4</span>
      <AppSelect controlLabel="Host IPv4" className="gp-resources-select mt-1"
        createPortal open={open} onOpenChange={({ open }) => setOpen(open)}
        value={value || '__docker_default__'} disabled={disabled || loading || error}
        onChange={(next) => onChange(next === '__docker_default__' ? '' : next)}
        options={[
          { value: '__docker_default__', label: restricted ? 'Choose IP' : 'Docker default (usually all interfaces)', disabled: restricted },
          ...(value && !addresses.includes(value) ? [{ value, label: `${value} — ${loading ? 'loading' : 'not configured'}`, disabled: true }] : []),
          ...addresses.map(address => ({ value: address, label: address })),
        ]} />
      {error && <span role="alert">Cannot load allowed IPs. Reload before changing bindings.</span>}
      {restricted && value && <span className="block">Allowed {protocol.toUpperCase()}: {ranges.length ? ranges.map(({ from, to }) => from === to ? String(from) : `${from}–${to}`).join(', ') : 'none'}</span>}
      {restricted && (!value || (hostPort !== '' && !portAllowed)) && <span className="block" role="alert">{!value ? 'Select an IP for this port.' : 'Host port is outside the allowed ranges.'}</span>}
      {!loading && !error && addresses.length === 0 && <span>{restricted ? 'No IPs are available for publishing ports.' : 'Configure GAMEPANEL_BIND_IPS or GAMEPANEL_IP_PORTS to select an IPv4.'}</span>}
    </div>
  );
}
