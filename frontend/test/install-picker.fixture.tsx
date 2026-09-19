import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InstallGameServer } from '../components/InstallGameServer';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';
function Fixture() {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Add Game Server</button><InstallGameServer isOpen={open} onClose={() => setOpen(false)} onInstall={async () => {}} /></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
