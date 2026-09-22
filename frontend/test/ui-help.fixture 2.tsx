import React from 'react';
import { createRoot } from 'react-dom/client';
import { InfoTip } from '../src/ui/components/InfoTip';
import '../styles/globals.css';
createRoot(document.getElementById('root')!).render(<>
  <div style={{ position: 'fixed', right: 4, bottom: 4 }}><InfoTip text="Backup files remain on this node. Download an archive to keep a separate copy." /></div>
  <button>Next control</button>
</>);
