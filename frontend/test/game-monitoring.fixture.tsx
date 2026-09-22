import React from 'react';
import { createRoot } from 'react-dom/client';
import { GameMonitoringCard } from '../components/serverSettings/GameMonitoringCard';
import { GameMonitoringStatus } from '../components/GameMonitoringStatus';
import { TemplateMonitoringEditor } from '../components/TemplateMonitoringEditor';
import { ThemeProvider } from '../contexts/ThemeContext';
import { emptyTemplate } from '../utils/gameTemplates';
import '@ovhcloud/ods-react/normalize-css';
import '@ovhcloud/ods-themes/default/css';
import '@ovhcloud/ods-themes/default/fonts';
import '../src/ui/theme/ods-dark.css';
import '../src/ui/theme/ods-light.css';
import '../styles/globals.css';
import '../components/serverSettings/container-settings.css';
function Fixture() {
    const [draft, setDraft] = React.useState({ ...emptyTemplate(), ports: [{ key: 'game', label: 'Game / Query', protocol: 'udp' as const, container: 27015, suggested: 27015, env: '', linuxgsmKey: '' }] });
    const summary = { enabled: true, state: 'online' as const, checkedAt: new Date().toISOString(), lastSuccessAt: new Date().toISOString(), failures: 0, incidentStartedAt: null, error: null, latencyMs: 5, runtimeKey: 'one', staleAfterSeconds: 10, info: { name: 'Test', map: 'de_dust2', players: 0, maxPlayers: 16, bots: 0 } };
    return <ThemeProvider><main className="gp-settings" style={{ maxWidth: 920, margin: '24px auto', padding: 16 }}>
        {location.search.includes('template') ? <TemplateMonitoringEditor draft={draft} change={patch => setDraft(previous => ({ ...previous, ...patch }))} />
            : location.search.includes('status') ? <GameMonitoringStatus summary={summary} detailed /> : <GameMonitoringCard serverId={7} />}
    </main></ThemeProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
