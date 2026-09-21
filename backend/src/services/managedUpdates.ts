import fs from 'node:fs/promises';
import path from 'node:path';
import { nodes } from '../nodes/control.js';
import { isAgent } from '../agent/identity.js';
import { docker } from '../utils/docker/client.js';
import { getConfig } from '../config.js';

export async function managedUpdateCapability() {
  if (isAgent() || process.env.GAMEPANEL_MANAGED_UPDATES !== 'true') return { enabled: false, reason: 'This installation uses manual updates. Follow the deployment guide.' };
  if ((await nodes().list()).length) return { enabled: false, reason: 'Remote agents are configured. Update the panel and agents together using the deployment guide.' };
  const image = process.env.GAMEPANEL_PRO_UPDATER_IMAGE || '';
  if (!/^gamepanel-pro-updater:2\.0\.\d+$/.test(image)) return { enabled: false, reason: 'The Game Panel PRO updater is not configured.' };
  try { await docker.getImage(image).inspect(); }
  catch { return { enabled: false, reason: 'The local updater image is missing. Repair it from the release sources.' }; }
  return { enabled: true, reason: 'A snapshot is created before the panel restarts. Running games are not restarted.' };
}

export async function readManagedUpdateResult(jobId: number): Promise<{ status: 'completed' | 'failed'; message: string } | null> {
  try {
    const file = path.join(getConfig().gamepanelDataDir, 'panel-updater-status.json');
    if ((await fs.stat(file)).size > 4096) return null;
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (data.jobId !== jobId || !['completed', 'failed'].includes(data.status)) return null;
    return { status: data.status, message: typeof data.message === 'string' ? data.message.slice(0, 500) : 'Update finished' };
  } catch { return null; }
}
