import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiTokensModal } from '../components/ApiTokensModal';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '@ovhcloud/ods-themes/default/fonts';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';
function Fixture() {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Open tokens</button>{open && <ApiTokensModal onClose={() => setOpen(false)} />}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
