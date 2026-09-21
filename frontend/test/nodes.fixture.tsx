import React from 'react';
import { NodeScopeProvider } from '../contexts/NodeScopeContext';
import { createRoot } from 'react-dom/client';
import { Nodes } from '../components/Nodes';
import { NodeSelector } from '../components/NodeSelector';
import { ThemeProvider } from '../contexts/ThemeContext';
import { BrandingProvider } from '../contexts/BrandingContext';
import { apiClient } from '../utils/api';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '@ovhcloud/ods-themes/default/fonts';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';
createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <BrandingProvider>
      <NodeScopeProvider userId={2} >
      <main className="min-h-screen bg-slate-50 p-6 dark:bg-slate-950">
        <div className="mb-6 max-w-sm rounded-xl bg-blue-900 p-4">
          <NodeSelector />
        </div>
        <Nodes />
        <button onClick={() => void apiClient.getServer(1).catch(() => {})}>
          Test selected runtime
        </button>
      </main>
    </NodeScopeProvider>
    </BrandingProvider>
  </ThemeProvider>
);
