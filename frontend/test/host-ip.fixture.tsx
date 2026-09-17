// Development-only fixture: Vite's production build does not include this entry.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HostIpSelect } from '../components/HostIpSelect';

function Fixture() {
  const [value, setValue] = useState('');
  const [port, setPort] = useState('27015');
  return <main style={{ padding: 24, maxWidth: 480 }}>
    <h1>Host IPv4</h1>
    <label>Host port<input aria-label="Host port" value={port} onChange={(event) => setPort(event.target.value)} /></label>
    <HostIpSelect value={value} hostPort={port} protocol="tcp" onChange={setValue} />
    <output data-testid="selected">{value || 'default'}</output>
    <h2>Saved address removed from the allowlist</h2>
    <HostIpSelect value="192.0.2.99" onChange={() => {}} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
