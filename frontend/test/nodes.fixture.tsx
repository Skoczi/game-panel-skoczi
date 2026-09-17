import React from 'react';
import { createRoot } from 'react-dom/client';
import { Nodes } from '../components/Nodes';
import { NodeSelector } from '../components/NodeSelector';
import { ThemeProvider } from '../contexts/ThemeContext';
import { BrandingProvider } from '../contexts/BrandingContext';
import { apiClient } from '../utils/api';
import '../styles/globals.css';
createRoot(document.getElementById('root')!).render(<ThemeProvider><BrandingProvider><main className="min-h-screen bg-slate-50 p-6 dark:bg-slate-950"><div className="mb-6 max-w-sm rounded-xl bg-blue-900 p-4"><NodeSelector /></div><Nodes/><button onClick={()=>void apiClient.getServer(1).catch(()=>{})}>Test selected runtime</button></main></BrandingProvider></ThemeProvider>);
