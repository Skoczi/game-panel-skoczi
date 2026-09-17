import React from 'react';
import { createRoot } from 'react-dom/client';
import { GameTemplates } from '../components/GameTemplates';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '@ovhcloud/ods-themes/default/fonts';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';
createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-slate-50 p-5 dark:bg-slate-950">
    <GameTemplates />
  </main>
);
