import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../components/ErrorBoundary';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
let broken = true;
function Section({ name }: { name: string }) {
  if (name === 'Files' && broken) throw new Error('Fixture render failure');
  return <p>{name} ready</p>;
}
function Fixture() {
  const [section, setSection] = useState('Files');
  return <>
    <nav><button onClick={() => setSection('Nodes')}>Nodes</button><button onClick={() => setSection('Files')}>Files</button></nav>
    <button onClick={() => { broken = false; }}>Repair fixture</button>
    <ErrorBoundary section key={section}><Section name={section} /></ErrorBoundary>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
