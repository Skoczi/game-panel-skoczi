import { useEffect, useRef, useState } from 'react';
import { InstallGameServer } from './InstallGameServer';
import { AppSelect } from '../src/ui/components';
import { useNodeScope } from '../contexts/NodeScopeContext';
import { nodesRequest } from '../utils/nodesApi';
import { getStoredToken } from '../utils/api/runtime';
import { fleetContext } from '../utils/fleetRuntime';
import { openServer, runtimeUrl } from '../utils/nodeContext';
import type { InstallGameHandlerPayload } from './app/appActionHandlers';
import type { InstallInteraction, InstallStep } from '../types/gameServer';

export function ClassicFleetInstaller({ mode, initialNodeId, onClose }: { mode: 'linuxgsm' | 'custom'; initialNodeId?: string; onClose: () => void }) {
  const { nodes } = useNodeScope();
  const [nodeId, setNodeId] = useState(initialNodeId || 'local');
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [serverId, setServerId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('pending');
  const [plan, setPlan] = useState<InstallStep[]>([]);
  const [interaction, setInteraction] = useState<InstallInteraction | null>(null);
  const attempted = useRef(false);
  const base = nodeId === 'local' ? '' : `/api/nodes/${nodeId}/runtime`;
  useEffect(() => { if (!open && !attempted.current) onClose(); }, [open, onClose]);
  useEffect(() => {
    if (!serverId) return;
    let disposed = false, socket: WebSocket;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const url = new URL(nodeId === 'local' ? '/api' : `/api/nodes/${nodeId}/ws`, location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(url);
      socket.onopen = () => socket.send(JSON.stringify({ type: 'auth', token: getStoredToken() }));
      socket.onmessage = event => {
        if (disposed) return;
        let message: any;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'auth:success' || message.type === 'auth:ok') {
          setWarning(''); socket.send(JSON.stringify({ type: 'subscribe:install', serverId })); return;
        }
        if (message.type === 'error') { setWarning(message.error || 'Cannot read installation status'); return; }
        if (message.serverId !== serverId) return;
        if (message.type === 'install:plan') setPlan(message.steps || []);
        if (message.type === 'install:interaction') setInteraction(message.status === 'pending' ? message : null);
        if (message.type === 'install:progress') {
          setProgress(message.progress); setStatus(message.status); setError(message.errorMessage || '');
          if (['completed', 'failed'].includes(message.status)) setBusy(false);
        }
      };
      socket.onclose = () => { if (!disposed) { setWarning('Reconnecting to installation…'); retry = setTimeout(connect, 3000); } };
    };
    connect();
    return () => { disposed = true; clearTimeout(retry); socket?.close(); };
  }, [serverId, nodeId]);
  const install = async (payload: InstallGameHandlerPayload) => {
    attempted.current = true; setBusy(true); setError(''); setStatus('pending'); setProgress(0); setServerId(null);
    try {
      const result = await nodesRequest<{ server?: { id: number }; id?: number }>(`${base}/api/servers/install`, payload);
      const id = result.server?.id ?? result.id;
      if (!Number.isSafeInteger(id) || !id || id < 1) throw new Error('Installation was not confirmed. Check the server list before retrying.');
      setServerId(id);
    } catch (e) {
      setBusy(false); setStatus('failed');
      setError(e instanceof Error ? e.message : 'Installation failed');
    }
  };
  const openConsole = async () => {
    try {
      await nodesRequest('/api/fleet/refresh', {});
      const { servers } = await nodesRequest<{ servers: Array<{ id: string; node: { id: string }; runtimeId?: number }> }>('/api/fleet');
      for (const server of servers.filter(s => s.node.id === nodeId)) {
        const context = await fleetContext(server.id);
        if (context.runtimeId === serverId) { openServer(context); return; }
      }
      setWarning('Server is still being added to the list. Try again shortly.');
    } catch { setWarning('Cannot open the console yet. Try again shortly.'); }
  };
  return <InstallGameServer key={nodeId} isOpen={open} catalogMode={mode} targetNodeId={nodeId}
    nodeSelector={<div className="mt-3 min-w-48"><AppSelect controlLabel="Execution node" value={nodeId}
      disabled={attempted.current} options={nodes.length ? nodes.map(n => ({ value: n.id, label: n.name, disabled: n.status !== 'online' })) : [{ value: nodeId, label: nodeId === 'local' ? 'FR1' : nodeId }]}
      onChange={setNodeId} /></div>}
    onClose={() => setOpen(false)} onInstall={install} installing={busy} installError={error}
    installServerId={serverId} installProgressPercent={progress} installStatus={status} installPlan={plan}
    installInteraction={interaction} connectionWarning={warning} canOpenInstallLog={Boolean(serverId)}
    onRespondToInteraction={async (id, response) => { await nodesRequest(runtimeUrl(`/api/servers/${serverId}/install/interactions/${id}/respond`, nodeId), response); }}
    onOpenConsole={() => void openConsole()} onProgressClose={onClose} onReopen={() => setOpen(true)} />;
}
