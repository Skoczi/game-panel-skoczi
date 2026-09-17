import { readFileSync, lstatSync } from 'node:fs';
import { NODE_ID, nodeOrigin } from '../nodes/protocol.js';

export type AgentIdentity = { nodeId: string; key: string; panel: string; origin: string; protocol: number };
export const isAgent = () => Boolean(process.env.GAMEPANEL_AGENT_CONFIG);
let cached: AgentIdentity | undefined;
export function agentIdentity(): AgentIdentity {
    if (cached) return cached;
    const filename = process.env.GAMEPANEL_AGENT_CONFIG;
    if (!filename) throw new Error('Agent identity is missing');
    const st = lstatSync(filename);
    if (!st.isFile() || (st.mode & 0o077)) throw new Error('Agent identity must be a private 0600 file');
    const value = JSON.parse(readFileSync(filename, 'utf8'));
    const loopback = process.env.GAMEPANEL_TEST_LOOPBACK_NODES === '1';
    if (!NODE_ID.test(value.nodeId) || !/^[A-Za-z0-9_-]{43}$/.test(value.key) || value.protocol !== 1) throw new Error('Invalid agent identity');
    if (process.env.GAMEPANEL_NODE_ID && process.env.GAMEPANEL_NODE_ID !== value.nodeId) throw new Error('Agent node identity mismatch');
    process.env.GAMEPANEL_NODE_ID = value.nodeId;
    cached = { ...value, panel: nodeOrigin(value.panel, loopback), origin: nodeOrigin(value.origin, loopback) };
    return cached!;
}
