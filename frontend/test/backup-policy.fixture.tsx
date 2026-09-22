import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeBackupPolicyCard } from '../components/serverSettings/NativeBackupPolicyCard';
import { ThemeProvider } from '../contexts/ThemeContext';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';
function Fixture() {
  const [imports, setImports] = useState(0);
  const readOnly = new URLSearchParams(location.search).has('readonly');
  return <ThemeProvider><main className="p-4 max-w-4xl mx-auto"><NativeBackupPolicyCard serverId={8} canEdit={!readOnly} canImport={!readOnly} busy={false} localNames={[]} onImported={() => setImports(n => n + 1)} /><output hidden aria-label="Imports refreshed">{imports}</output></main></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
