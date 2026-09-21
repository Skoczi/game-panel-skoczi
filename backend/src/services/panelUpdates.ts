import { managedUpdateCapability, readManagedUpdateResult } from './managedUpdates.js';
import { panelUpdateJobRepository } from '../database/index.js';
import { getAppVersion } from '../utils/appInfo.js';
import { docker } from '../utils/docker/client.js';
import { getConfig } from '../config.js';
import { logError } from '../utils/logger.js';
import { toIsoTimestamp, toIsoTimestampOrNull } from '../utils/time.js';

// Game Panel PRO releases only; never fall back to the upstream repository.
const GITHUB_RELEASES_URL = 'https://api.github.com/repos/Skoczi/game-panel-skoczi/releases?per_page=100';
const RELEASES_CACHE_TTL_MS = 10 * 60 * 1000;
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

type ParsedVersion = {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

type GitHubRelease = {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  draft?: unknown;
  prerelease?: unknown;
};

export type PanelReleaseNotes = {
  version: string;
  name: string | null;
  body: string | null;
  htmlUrl: string | null;
  publishedAt: string | null;
  prerelease: boolean;
};

export type PanelUpdateCheck = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  currentRelease: PanelReleaseNotes | null;
  newerReleases: PanelReleaseNotes[];
  managedUpdates: { enabled: boolean; reason: string };
};

export type PanelUpdateStartResult = {
  started: true;
  jobId: number;
  targetVersion: string;
};

function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_RE.exec(value.trim());
  if (!match) return null;

  return {
    raw: value.trim(),
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) {
    const a = left[i];
    const b = right[i];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;

    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);

    if (aNumeric && bNumeric) return Number(a) - Number(b);
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    return a.localeCompare(b);
  }

  return 0;
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  return comparePrerelease(left.prerelease, right.prerelease);
}

function normalizeApiVersion(value: unknown): string {
  if (typeof value !== 'string') {
    throw Object.assign(new Error('version must be a string'), { statusCode: 400 });
  }

  const version = value.trim();
  if (!parseVersion(version)) {
    throw Object.assign(new Error('version must use the format 1.2.3 or 1.2.3-beta.1'), { statusCode: 400 });
  }

  return version;
}

function tagForVersion(version: string): string {
  return `v${version}`;
}

function versionFromTag(tag: string): string | null {
  if (!tag.startsWith('v')) return null;
  const version = tag.slice(1);
  return parseVersion(version) ? version : null;
}

let releasesCache: { fetchedAt: number; releases: PanelReleaseNotes[] } | null = null;

async function fetchReleaseNotes(): Promise<PanelReleaseNotes[]> {
  const now = Date.now();
  if (releasesCache && now - releasesCache.fetchedAt < RELEASES_CACHE_TTL_MS) {
    return releasesCache.releases;
  }

  const response = await fetch(GITHUB_RELEASES_URL, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Game-Panel-PRO',
    },
  });

  if (!response.ok) {
    throw Object.assign(new Error(`Unable to fetch GitHub releases (${response.status})`), { statusCode: 502 });
  }

  const body = await response.json();
  const entries: GitHubRelease[] = Array.isArray(body) ? body : [];
  const releases: PanelReleaseNotes[] = [];

  for (const entry of entries) {
    if (!entry || entry.draft === true) continue;
    const tagName = typeof entry.tag_name === 'string' ? entry.tag_name : null;
    const version = tagName ? versionFromTag(tagName) : null;
    if (!version) continue;

    releases.push({
      version,
      name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : null,
      body: typeof entry.body === 'string' && entry.body.trim() ? entry.body : null,
      htmlUrl: typeof entry.html_url === 'string' ? entry.html_url : null,
      publishedAt: typeof entry.published_at === 'string' ? entry.published_at : null,
      prerelease: entry.prerelease === true,
    });
  }

  releases.sort((a, b) => {
    const parsedA = parseVersion(a.version);
    const parsedB = parseVersion(b.version);
    if (!parsedA || !parsedB) return 0;
    return compareVersions(parsedB, parsedA);
  });

  releasesCache = { fetchedAt: now, releases };
  return releases;
}

export async function checkPanelUpdate(): Promise<PanelUpdateCheck> {
  const currentVersion = getAppVersion();
  const current = parseVersion(currentVersion);
  const releases = await fetchReleaseNotes();

  const latestVersion = releases.find(release => !release.prerelease && !parseVersion(release.version)?.prerelease.length)?.version ?? null;
  const latest = latestVersion ? parseVersion(latestVersion) : null;

  const currentRelease = releases.find((release) => release.version === currentVersion) ?? null;
  const newerReleases = current
    ? releases.filter((release) => {
        const parsed = parseVersion(release.version);
        return parsed && !release.prerelease && !parsed.prerelease.length ? compareVersions(parsed, current) > 0 : false;
      })
    : [];

  return {
    currentVersion,
    latestVersion,
    updateAvailable: Boolean(current && latest && compareVersions(latest, current) > 0),
    currentRelease,
    newerReleases,
    managedUpdates: await managedUpdateCapability(),
  };
}

const STALE_PENDING_GRACE_MS = 5 * 60 * 1000;

export async function reconcileStalePanelUpdate(): Promise<void> {
  const job = await panelUpdateJobRepository.getRunning();
  if (!job) return;
  const reconcileResult = async () => {
    const result = await readManagedUpdateResult(job.id);
    if (!result) return false;
    if (result.status === 'completed') await panelUpdateJobRepository.markCompleted(job.id, result.message);
    else await panelUpdateJobRepository.markFailed(job.id, result.message);
    return true;
  };
  if (await reconcileResult()) return;

  if (job.container_id) {
    try {
      const state = await docker.getContainer(job.container_id).inspect();
      if (state.State.Running) return;
      if (await reconcileResult()) return;
      await panelUpdateJobRepository.markFailed(job.id, 'Updater stopped without reporting completion. Inspect the host snapshot before retrying.');
      return;
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 404) {
        logError('PANEL_UPDATE:RECONCILE', error, { jobId: job.id });
        return;
      }
    }

    if (await reconcileResult()) return;
    await panelUpdateJobRepository.markFailed(
      job.id,
      'Updater container is no longer running; the update never reported completion.'
    );
    return;
  }

  const referenceTime = Date.parse(job.started_at ?? job.created_at);
  if (Number.isFinite(referenceTime) && Date.now() - referenceTime < STALE_PENDING_GRACE_MS) {
    return;
  }

  await panelUpdateJobRepository.markFailed(job.id, 'Updater container was never started.');
}

export async function getPanelUpdateStatus() {
  await reconcileStalePanelUpdate();
  const job = await panelUpdateJobRepository.getLatest();
  if (!job) {
    return {
      running: false,
      job: null,
    };
  }

  return {
    running: job.status === 'pending' || job.status === 'running',
    job: {
      id: job.id,
      targetVersion: job.target_version,
      status: job.status,
      phase: job.phase,
      message: job.message,
      errorMessage: job.error_message,
      backupPath: job.backup_path,
      startedBy: job.started_by,
      startedAt: toIsoTimestampOrNull(job.started_at),
      finishedAt: toIsoTimestampOrNull(job.finished_at),
      updatedAt: toIsoTimestamp(job.updated_at),
    },
  };
}

export async function startPanelUpdate(input: {
  version: unknown;
  startedBy: string | null;
}): Promise<PanelUpdateStartResult> {
  const capability = await managedUpdateCapability();
  if (!capability.enabled) throw Object.assign(new Error(capability.reason), { statusCode: 409 });
  const targetVersion = normalizeApiVersion(input.version);
  const currentVersion = getAppVersion();
  const target = parseVersion(targetVersion);
  const current = parseVersion(currentVersion);

  if (!target || !current) {
    throw Object.assign(new Error('Invalid local or target version'), { statusCode: 400 });
  }

  if (compareVersions(target, current) <= 0) {
    throw Object.assign(new Error('Choose a newer release'), { statusCode: 400 });
  }

  const available = await fetchReleaseNotes();
  if (!/^2\.0\.\d+$/.test(targetVersion) || !available.some(release => release.version === targetVersion && !release.prerelease)) {
    throw Object.assign(new Error(`Unknown update version: ${targetVersion}`), { statusCode: 400 });
  }

  await reconcileStalePanelUpdate();

  const targetTag = tagForVersion(targetVersion);
  const jobId = await panelUpdateJobRepository.createIfNoneActive({
    targetVersion,
    targetTag,
    startedBy: input.startedBy,
  });
  if (jobId === null) {
    throw Object.assign(new Error('A panel update is already running'), { statusCode: 409 });
  }

  try {
    const config = getConfig();
    const updaterImage = process.env.GAMEPANEL_PRO_UPDATER_IMAGE!;

    const container = await docker.createContainer({
      Image: updaterImage,
      name: `gamepanel-updater-${jobId}`,
      Env: [
        `GP_UPDATE_JOB_ID=${jobId}`,
        `GP_UPDATE_VERSION=${targetVersion}`,
        `GP_UPDATE_FROM_VERSION=${currentVersion}`,
        `GP_UPDATE_TAG=${targetTag}`,

        `GP_APP_ROOT=${config.gamepanelAppRoot}`,
        `GP_COMPOSE_PROJECT_NAME=${config.composeProjectName}`,

      ],
      Labels: {
        'gamepanel.managed': 'true',
        'gamepanel.oneshot': 'true',
        'gamepanel.role': 'updater',
        'gamepanel.update.job_id': String(jobId),
      },
      HostConfig: {
        AutoRemove: true,
        Binds: [
          `${config.gamepanelAppRoot}:${config.gamepanelAppRoot}`,
          `${config.dockerSocket}:/var/run/docker.sock`,
        ],
      },
    });

    await container.start();
    await panelUpdateJobRepository.markRunning(jobId, container.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start updater container';
    await panelUpdateJobRepository.markFailed(jobId, message);
    logError('PANEL_UPDATE:START_CONTAINER', error, { jobId, targetVersion });
    throw Object.assign(new Error(message), { statusCode: 500 });
  }

  return {
    started: true,
    jobId,
    targetVersion,
  };
}
