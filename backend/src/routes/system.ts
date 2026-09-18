// Modified by Skoczi: expose the configured IPv4 allowlist to authenticated UI clients.
import { configuredBindAddresses } from '../utils/bindAddresses.js';
import { configuredPortPolicy } from '../utils/portPolicy.js';
import { globalSettings } from '../services/globalSettings.js';
import { Router } from 'express';
import { rootOnly, type AuthenticatedRequest } from '../middleware/auth.js';
import { checkPanelUpdate, getPanelUpdateStatus, startPanelUpdate } from '../services/panelUpdates.js';
import { requireBodyObject } from '../utils/httpValidation.js';
import { sendRouteError } from '../utils/routeErrors.js';
import { nowIso } from '../utils/time.js';
import { isAgent } from '../agent/identity.js';

const router = Router();

// Appearance only: authenticated users do not receive global allocations or server names.
router.get('/appearance', (_req, res) => res.json(globalSettings().snapshot().appearance));

router.get('/settings', rootOnly, async (_req, res) => {
  try { res.json({ ...globalSettings().snapshot(), assignments: await globalSettings().assignments() }); }
  catch (error) { return sendRouteError(res, error, { route: 'SETTINGS:GET', fallbackMessage: 'Cannot load settings' }); }
});

router.put('/settings', rootOnly, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some((key) => !['revision', 'network', 'appearance'].includes(key))) {
      return res.status(400).json({ error: 'Invalid settings payload' });
    }
    const { revision, network, appearance } = req.body;
    if (!isAgent() && JSON.stringify(network) !== JSON.stringify(globalSettings().snapshot().network))
      return res.status(409).json({ error: 'IP allocations belong to a node. Open Nodes → Node settings to change them.' });
    res.json(await globalSettings().save({ network, appearance }, revision));
  } catch (error) { return sendRouteError(res, error, { route: 'SETTINGS:PUT', fallbackMessage: 'Cannot save settings' }); }
});

router.get('/bind-addresses', (_req, res) => {
  try {
    const portsByIp = configuredPortPolicy();
    res.json({ addresses: configuredBindAddresses(), requireExplicitIp: portsByIp !== null, portsByIp });
  } catch (error) {
    return sendRouteError(res, error, { route: 'ROUTE:SYSTEM:BIND_ADDRESSES', fallbackMessage: 'Invalid host IP configuration' });
  }
});

// GET /api/system/health
router.get('/health', (_req, res) => {
  res.json({ status: 'healthy', timestamp: nowIso() });
});

// GET /api/system/update/check
router.get('/update/check', rootOnly, async (_req: AuthenticatedRequest, res) => {
  try {
    const result = await checkPanelUpdate();
    return res.json(result);
  } catch (error) {
    return sendRouteError(res, error, {
      route: 'ROUTE:SYSTEM:UPDATE_CHECK',
      fallbackMessage: 'System update request failed',
    });
  }
});

// GET /api/system/update/status
router.get('/update/status', rootOnly, async (_req: AuthenticatedRequest, res) => {
  try {
    const result = await getPanelUpdateStatus();
    return res.json(result);
  } catch (error) {
    return sendRouteError(res, error, {
      route: 'ROUTE:SYSTEM:UPDATE_STATUS',
      fallbackMessage: 'System update request failed',
    });
  }
});

// POST /api/system/update
router.post('/update', rootOnly, async (req: AuthenticatedRequest, res) => {
  try {
    const body = requireBodyObject(req.body);
    const result = await startPanelUpdate({
      version: body.version,
      startedBy: req.user?.username ?? null,
    });

    return res.status(202).json(result);
  } catch (error) {
    return sendRouteError(res, error, {
      route: 'ROUTE:SYSTEM:UPDATE_START',
      fallbackMessage: 'System update request failed',
    });
  }
});

export default router;
