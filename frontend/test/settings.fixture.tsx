// Development fixture only; never included in the production entry points.
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GlobalSettings } from '../components/GlobalSettings';
import { Sidebar } from '../components/Sidebar';
import { ThemeProvider } from '../contexts/ThemeContext';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '@ovhcloud/ods-themes/default/fonts';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';

function Fixture() {
  const [tab, setTab] = useState('settings');
  const isRoot = !new URLSearchParams(location.search).has('nonroot');
  return <ThemeProvider><div className="min-h-screen bg-gray-50 dark:bg-[#0b111b] md:pl-52">
    <div className="hidden md:block"><Sidebar activeTab={tab} onTabChange={setTab} currentUser={{ id: 1, username: 'Admin', isRoot } as any} /></div>
    <main className="min-w-0 p-4 md:p-6">{isRoot && tab === 'settings' ? <GlobalSettings /> : <p>Game Servers</p>}</main>
  </div></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
