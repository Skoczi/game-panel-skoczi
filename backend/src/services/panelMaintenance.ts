import { existsSync } from 'node:fs';
export const isPanelMaintenance = () => existsSync('/data/.panel-upgrade');
let mutations = 0;
export const activePanelRequests = () => mutations;
export function trackPanelMutation() { mutations++; let done = false; return () => { if (!done) { done = true; mutations--; } }; }
