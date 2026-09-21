import { clearEditorDrafts } from './editorDrafts';
import { mutationOutcomeUnknown } from './apiError';
import type { ResourceUsage } from './resourceMetrics';
// Modified by Skoczi: host IP allowlist API and per-port IPv4 payloads.
import axios, { AxiosInstance, AxiosError } from 'axios';
import { runtimeUrl, ACTIVE_SERVER, ACTIVE_NODE } from './nodeContext';
import type { GlobalSettings, Appearance, Assignment } from '../types/globalSettings';
import type { ReleaseConfigFileDefinition } from './api/types';
import type {
  ProjectZomboidMod,
  ProjectZomboidModId,
  ProjectZomboidWorkshopPreview,
} from '../types/projectZomboid';
import type {
  PatchSettingsResponse,
  SettingOptionsResponse,
  SettingsScreen,
} from './serverSettings';
import type {
  AddonProjectResponse,
  AddonSearchResponse,
  InstallAddonResponse,
  InstalledResponse,
  SearchAddonsParams,
  SetAddonEnabledResponse,
} from './minecraftAddons';
import { getFilenameFromDisposition, getPathFilename } from './api/helpers';
import { retryWithBackoff } from './uploadHelpers';
import { RealtimeGateway, type RealtimeConnectionStatus } from './api/realtimeGateway';
import {
  API_BASE_URL,
  AUTH_TOKEN_KEY,
  CATALOG_BASE_URL,
  clearCookieValue,
  getStoredToken,
  setCookieValue,
} from './api/runtime';

export type {
  ReleaseConfigFileDefinition,
} from './api/types';
export { PUBLIC_CONNECTION_HOST } from './api/runtime';
export type { RealtimeConnectionStatus } from './api/realtimeGateway';

const DEFAULT_TIMEOUT_MS = 60_000;
const LONG_TIMEOUT_MS = 30 * 60 * 1000;

// Percentages for cpu/memory/disk, bytes per second for the network pair.
export interface ServerMetricSample {
  resources?: ResourceUsage;
  cpuUsage?: number;
  memoryUsage?: number;
  diskUsage?: number;
  network?: { in?: number; out?: number };
  timestamp: string;
}

export interface ReleaseNotes {
  version: string;
  name: string | null;
  body: string | null;
  htmlUrl: string | null;
  publishedAt: string | null;
  prerelease: boolean;
}

export interface PanelUpdateCheck {
  managedUpdates?: { enabled: boolean; reason: string };
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  currentRelease: ReleaseNotes | null;
  newerReleases: ReleaseNotes[];
}

export interface FileHistoryEntry {
  id: string; createdAt: string; actor: string; state: 'prepared' | 'committed';
  beforeVersion: string; afterVersion: string; beforeBytes?: number; afterBytes?: number;
}
export interface FileHistoryDetail extends FileHistoryEntry { before: string; after: string }
export interface NativeRetentionPlan {
  fingerprint: string;
  policy: { keepArchives: number; keepRecovery: number };
  remove: Array<{ name: string; kind: 'archive' | 'recovery'; sizeBytes: number | null; modifiedAt: string; protectedReason: string | null }>;
  keep: Array<{ name: string; kind: 'archive' | 'recovery'; sizeBytes: number | null; modifiedAt: string; protectedReason: string | null }>;
}
export interface NativeProtectionSummary {
  measuredAt: string;
  gameAllocatedBytes: number | null;
  archiveBytes: number | null;
  recoveryAllocatedBytes: number | null;
  recoveryCount: number | null;
  nodeFreeBytes: number | null;
  archiveCount: number | null;
  unverifiedCount: number | null;
  latestBackup: { name: string; createdAt: string; validatedAt: string; mode: 'live' | 'offline'; sizeBytes: number } | null;
  schedules: { total: number; enabled: number; nextRunAt: string | null; lastProblem: number } | null;
  restoreHistoryAvailable: boolean;
  lastRestore: { status: string; startedAt: string; completedAt: string | null } | null;
  warnings: string[];
}
export interface BackupJob {
  id: string; kind: 'backup' | 'restore'; status: 'running' | 'completed' | 'failed' | 'interrupted';
  actor?: string;
  startedAt: string; completedAt?: string; error?: string;
  result?: { ok: boolean; exitCode: number; stdout?: string; stderr?: string };
}
export interface FileTransferJob {
  createdAt?: string;
  completedAt?: string | null;
  id: number;
  kind: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  root: string;
  basePath: string;
  completedFiles: number;
  transferredBytes: number;
  errorMessage: string | null;
}

class ApiClient {
  private client: AxiosInstance;
  private token: string | null = null;
  private readonly realtime: RealtimeGateway;
  private unauthorizedHandler: (() => void) | null = null;

  constructor() {
    this.realtime = new RealtimeGateway(() => this.getAuthToken());

    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: DEFAULT_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use((request) => {
      request.url = runtimeUrl(request.url || '');
      if (ACTIVE_SERVER) request.headers.set('X-GamePanel-Server', ACTIVE_SERVER.id);
      if (
        ['post', 'put', 'patch', 'delete'].includes(request.method || '') &&
        !request.headers.has('Idempotency-Key')
      ) {
        request.headers.set('Idempotency-Key', crypto.randomUUID());
      }
      return request;
    });

    this.token = getStoredToken();
    if (this.token) {
      this.setAuthToken(this.token);
    }

    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        const status = error.response?.status;
        const requestUrl = String(error.config?.url || '').toLowerCase();
        const isAuthLoginRequest = requestUrl.includes('/api/auth/login');
        if (mutationOutcomeUnknown(error.config?.method, requestUrl, status)) {
          const guidance = 'Outcome unconfirmed. The request may have been accepted. Check operation history or the current server state before retrying.';
          error.message = guidance;
          if (error.response?.data && typeof error.response.data === 'object') {
            (error.response.data as { error?: string }).error = guidance;
          }
        }

        if (status === 401 && !isAuthLoginRequest && !requestUrl.includes('/runtime/')) {
          this.clearAuth();
          if (this.unauthorizedHandler) {
            this.unauthorizedHandler();
          } else {
            window.location.href = '/';
          }
        }
        return Promise.reject(error);
      }
    );
  }

  setUnauthorizedHandler(handler: (() => void) | null) {
    this.unauthorizedHandler = handler;
  }

  onConnectionStatusChange(listener: (status: RealtimeConnectionStatus) => void): () => void {
    return this.realtime.onStatusChange(listener);
  }

  getConnectionStatus(): RealtimeConnectionStatus {
    return this.realtime.getStatus();
  }

  setAuthToken(token: string) {
    this.token = token;
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    setCookieValue(AUTH_TOKEN_KEY, token);
  }

  clearAuth() {
    clearEditorDrafts();
    this.token = null;
    delete this.client.defaults.headers.common['Authorization'];
    localStorage.removeItem(AUTH_TOKEN_KEY);
    clearCookieValue(AUTH_TOKEN_KEY);
    this.realtime.resetState();
    this.realtime.close();
  }

  getAuthToken(): string | null {
    return this.token || getStoredToken();
  }

  async login(username: string, password: string) {
    const response = await this.client.post('/api/auth/login', { username, password });
    const data = response.data as {
      success: true;
      user: {
        id: number;
        username: string;
        isRoot: boolean;
        isEnabled: boolean;
      };
      token: string;
    };

    if (typeof data.token === 'string' && data.token.length > 0) {
      this.setAuthToken(data.token);
    }

    return data;
  }

  async register(
    username: string,
    password: string,
    confirmPassword: string,
    globalPermissions?: string[]
  ) {
    const response = await this.client.post('/api/auth/register', {
      username,
      password,
      confirmPassword,
      ...(globalPermissions && globalPermissions.length > 0 ? { globalPermissions } : {}),
    });
    return response.data as {
      success: true;
      user: {
        id: number;
        username: string;
        isRoot: boolean;
        isEnabled: boolean;
        globalPermissions?: string[];
      };
    };
  }

  async getCurrentUser() {
    const response = await this.client.get('/api/auth/me');
    return response.data as {
      user: {
        id: number;
        username: string;
        isRoot: boolean;
        isEnabled: boolean;
      };
      permissions?: {
        global?: string[];
        servers?: Array<{
          serverId: number;
          permissions: string[];
        }>;
      };
    };
  }

  async changePassword(currentPassword: string, newPassword: string, confirmPassword: string) {
    const response = await this.client.post('/api/auth/change-password', {
      currentPassword,
      newPassword,
      confirmPassword,
    });
    const data = response.data as {
      success: true;
      message?: string;
      token?: string;
    };
    // A password change invalidates every prior JWT; store the fresh token so this session survives.
    if (typeof data.token === 'string' && data.token.length > 0) {
      this.setAuthToken(data.token);
    }
    return data;
  }

  logout() {
    this.clearAuth();
  }

  async listUsers() {
    const response = await this.client.get('/api/users');
    return response.data as {
      users: Array<{
        id: number;
        username: string;
        isRoot: boolean;
        isEnabled: boolean;
        globalPermissions: string[];
        createdAt: string;
        updatedAt: string;
      }>;
    };
  }

  async updateUser(
    userId: number,
    payload: Partial<{
      username: string;
      isEnabled: boolean;
      globalPermissions: string[];
    }>
  ) {
    const body: Record<string, unknown> = {};
    if (payload.username !== undefined) body.username = payload.username;
    if (payload.isEnabled !== undefined) body.isEnabled = payload.isEnabled;
    if (payload.globalPermissions !== undefined) body.globalPermissions = payload.globalPermissions;

    const response = await this.client.patch(`/api/users/${userId}`, body);
    return response.data as { success: boolean };
  }

  async resetUserPassword(userId: number, newPassword: string) {
    const response = await this.client.post(`/api/users/${userId}/reset-password`, { newPassword });
    return response.data as { success: boolean };
  }

  async createUser(
    username: string,
    password: string,
    confirmPassword: string,
    globalPermissions?: string[]
  ) {
    return this.register(username, password, confirmPassword, globalPermissions);
  }

  async deleteUser(userId: number) {
    const response = await this.client.delete(`/api/users/${userId}`);
    return response.data as { success: boolean };
  }

  async getServerMembers(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/members`);
    return response.data as {
      members: Array<{
        id: number;
        serverId: number;
        userId: number;
        username: string;
        permissions: string[];
        createdAt: string;
        updatedAt: string;
      }>;
    };
  }

  async addServerMember(serverId: number, userId: number, permissions: string[]) {
    const response = await this.client.post(`/api/servers/${serverId}/members`, {
      userId,
      permissions,
    });
    return response.data as { success: boolean };
  }

  async updateServerMember(serverId: number, userId: number, permissions: string[]) {
    const response = await this.client.patch(`/api/servers/${serverId}/members/${userId}`, {
      permissions,
    });
    return response.data as { success: boolean };
  }

  async removeServerMember(serverId: number, userId: number) {
    const response = await this.client.delete(`/api/servers/${serverId}/members/${userId}`);
    return response.data as { success: boolean };
  }

  async installServer(payload: {
    provider: 'ovhcloud' | 'linuxgsm' | 'external';
    name: string;
    shortname?: string;
    imageId?: string;
    dockerImage?: string;
    imageOptions?: { patchline?: string; profileUuid?: string | null };
    runtimeIdentity?: { user: string; uid: number; gid: number };
    ports: {
      tcp: { host: number; container: number; label: string; hostIp?: string }[];
      udp: { host: number; container: number; label: string; hostIp?: string }[];
    };
    healthcheck:
      | null
      | { mode: 'disabled' }
      | {
          mode: 'override';
          type: string;
          port?: number;
          interval?: number;
          timeout?: number;
          retries?: number;
          startPeriod?: number;
        };
    mounts?: { key: string; containerPath: string }[];
    env?: Record<string, string>;
    requireSteamCredentials?: boolean;
    steamUsername?: string;
    steamPassword?: string;
    resourceLimits?: { memoryMb: number; cpu: number } | null;
  }) {
    const response = await this.client.post('/api/servers/install', payload, {
      timeout: LONG_TIMEOUT_MS,
    });
    return response.data;
  }

  async respondToInstallInteraction(
    serverId: number,
    interactionId: number,
    response: Record<string, unknown>
  ) {
    const res = await this.client.post(
      `/api/servers/${serverId}/install/interactions/${interactionId}/respond`,
      response
    );
    return res.data;
  }


  async startServer(id: number) {
    const response = await this.client.post(`/api/servers/${id}/start`);
    return response.data;
  }

  async stopServer(id: number) {
    const response = await this.client.post(`/api/servers/${id}/stop`);
    return response.data;
  }

  async restartServer(id: number) {
    const response = await this.client.post(`/api/servers/${id}/restart`);
    return response.data;
  }

  async updateServer(
    serverId: number,
    payload: {
      applyMode?: 'restart' | 'defer';
      customParams?: string[];
      startupCommand?: string[] | null;
      name?: string;
      ports?: {
        tcp: Array<{ host: number; container: number; label: string; hostIp?: string }>;
        udp: Array<{ host: number; container: number; label: string; hostIp?: string }>;
      };
      mounts?: Array<{ key: string; containerPath: string }>;
      env?: Record<string, string>;
      healthcheck?: null | { mode: string; [key: string]: unknown };
      deleteHostData?: boolean;
      resourceLimits?: { memoryMb: number; cpu: number } | null;
    }
  ) {
    const response = await this.client.patch(`/api/servers/${serverId}`, payload);
    return response.data as { success?: boolean; server?: { id: number; name?: string } };
  }

  async deleteServer(id: number) {
    const response = await this.client.delete(`/api/servers/${id}`);
    return response.data as { success?: boolean; message?: string };
  }

  async createTerminalSession(id: number) {
    const response = await this.client.post(`/api/servers/${id}/terminal/container/sessions`);
    return response.data as { sessionId: string };
  }

  async getAvailableServerPorts(id: number, ip: string, protocol: 'tcp' | 'udp') {
    const response = await this.client.get(`/api/servers/${id}/available-ports`, { params: { ip, protocol } });
    return response.data as { ports: number[] };
  }

  async getServer(id: number) {
    const response = await this.client.get(`/api/servers/${id}`);
    const raw = response.data?.server ?? response.data;
    return raw as {
      uptimeSeconds?: number | null;
      id: number;
      name: string;
      game: string;
      port?: number;
      status: string;
      configFiles?: ReleaseConfigFileDefinition[] | string[] | string | null;
      config_files?: ReleaseConfigFileDefinition[] | string[] | string | null;
      config_files_json?: string | null;
    };
  }

  async updateNativeServer(id: number) {
    const response = await this.client.post(`/api/servers/${id}/native-update`, { confirm: true });
    return response.data as { message: string };
  }

  async listBackups(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/backups`);
    return response.data as {
      path: string;
      entries: Array<{
        name: string;
        type: 'file' | 'dir' | 'symlink';
        size: number;
        modifiedAt: string;
      }>;
    };
  }

  async previewNativeRetention(serverId: number, policy: NativeRetentionPlan['policy']): Promise<NativeRetentionPlan> {
    const response = await this.client.get(`/api/servers/${serverId}/backups/retention`, { params: policy });
    if (!Array.isArray(response.data.remove) || !Array.isArray(response.data.keep) || typeof response.data.fingerprint !== 'string') throw new Error('Cleanup preview is unavailable');
    return response.data;
  }
  async applyNativeRetention(serverId: number, plan: NativeRetentionPlan): Promise<{ removed: string[] }> {
    const response = await this.client.post(`/api/servers/${serverId}/backups/retention`, { ...plan.policy, fingerprint: plan.fingerprint });
    return response.data;
  }

  async nativeProtection(serverId: number): Promise<NativeProtectionSummary> {
    const response = await this.client.get(`/api/servers/${serverId}/backups/protection`);
    if (!response.data.measuredAt || !Array.isArray(response.data.warnings)) throw new Error('Protection summary is unavailable');
    return response.data;
  }

  async backupCompatibility(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/backups/compatibility`);
    if (!Array.isArray(response.data.legacy)) throw new Error('Backup compatibility information is unavailable');
    return response.data as { capabilities?: { backupJobs?: number; nativeRestoreRecovery?: number; versionedFiles?: number; absoluteResources?: number; nativeProtection?: number; nativeRetention?: number }; native: boolean; layoutReady: boolean; legacy: Array<{name:string;size:number;modifiedAt:string}>; recoveryCount:number };
  }
  async downloadLegacyBackup(serverId: number, name: string) {
    const response = await this.client.get(`/api/servers/${serverId}/backups/legacy/file`, {params:{name},responseType:'blob',timeout:LONG_TIMEOUT_MS});
    const url = URL.createObjectURL(response.data); const link=document.createElement('a'); link.href=url; link.download=name; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  async listBackupJobs(serverId: number): Promise<BackupJob[]> {
    const response = await this.client.get(`/api/servers/${serverId}/backups/jobs`);
    if (!Array.isArray(response.data.jobs)) throw new Error('Agent does not support persistent backup jobs');
    return response.data.jobs;
  }

  private async backupResult(serverId: number, data: any): Promise<{ ok: boolean; exitCode: number; stdout?: string; stderr?: string }> {
    if (!data.job) return data;
    const id = data.job.id;
    for (let attempt = 0; attempt < 900; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      let job: BackupJob;
      try { job = (await this.client.get(`/api/servers/${serverId}/backups/jobs/${encodeURIComponent(id)}`)).data.job; }
      catch { throw new Error('Connection lost while the operation may still be running. Open Backups to check its saved status before retrying.'); }
      if (job?.status === 'completed' && job.result) return job.result;
      if (job?.status === 'failed' || job?.status === 'interrupted') throw new Error(job.error || 'Backup operation failed');
    }
    throw new Error('The operation is still pending. Open Backups to check its saved status.');
  }

  async restoreBackup(serverId: number, path: string) {
    const response = await this.client.post(
      `/api/servers/${serverId}/backups/restore`,
      { path },
      {
        timeout: LONG_TIMEOUT_MS,
      }
    );
    return this.backupResult(serverId, response.data);
  }

  async sendConsoleCommand(serverId: number, command: string) {
    const response = await this.client.post(`/api/servers/${serverId}/console/commands`, {
      command,
    });
    return response.data as { ok: boolean; exitCode: number; stdout: string; stderr: string };
  }

  async downloadBackupFile(serverId: number, path: string) {
    const response = await this.client.get(`/api/servers/${serverId}/backups/file`, {
      params: { path, download: 1 },
      responseType: 'blob',
      timeout: LONG_TIMEOUT_MS,
    });

    const disposition = response.headers?.['content-disposition'] as string | undefined;
    const filename = getFilenameFromDisposition(disposition, getPathFilename(path, 'backup'));

    return { blob: response.data as Blob, filename };
  }

  async renameBackupFile(serverId: number, path: string, name: string) {
    const response = await this.client.patch(`/api/servers/${serverId}/backups/file`, {
      path,
      name,
    });
    return response.data as { path: string; name: string };
  }

  async deleteBackupFile(serverId: number, path: string) {
    const response = await this.client.delete(`/api/servers/${serverId}/backups/file`, {
      params: { path },
    });
    return response.data;
  }

  async createBackup(serverId: number, options?: { includeServerArtifact?: boolean; name?: string }) {
    const response = await this.client.post(
      `/api/servers/${serverId}/backups/create`,
      options ?? {},
      {
        timeout: LONG_TIMEOUT_MS,
      }
    );
    return this.backupResult(serverId, response.data);
  }

  async getBackupSettings(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/backups/settings`);
    return response.data as { maxBackups: number; maxBackupDays: number; stopOnBackup: boolean };
  }

  async updateBackupSettings(
    serverId: number,
    payload: Partial<{ maxBackups: number; maxBackupDays: number; stopOnBackup: boolean }>
  ) {
    const response = await this.client.patch(`/api/servers/${serverId}/backups/settings`, payload);
    return response.data as { maxBackups: number; maxBackupDays: number; stopOnBackup: boolean };
  }

  async getBackupCron(serverId: number) {
    try {
      const response = await this.client.get(`/api/servers/${serverId}/scheduled-tasks`);
      const tasks = (response.data?.tasks ?? []) as Array<{
        id: number;
        type: string;
        schedule: string;
        enabled: boolean;
      }>;
      const task = tasks.find((t) => t.type === 'backup');
      if (!task || !task.enabled) return { enabled: false as const };
      return { enabled: true as const, schedule: task.schedule, line: task.schedule };
    } catch {
      return { enabled: false as const };
    }
  }

  async updateBackupCron(
    serverId: number,
    payload: { enabled: false } | { enabled: true; schedule: string }
  ) {
    const listResponse = await this.client.get(`/api/servers/${serverId}/scheduled-tasks`);
    const tasks = (listResponse.data?.tasks ?? []) as Array<{
      id: number;
      type: string;
      enabled: boolean;
      schedule: string;
    }>;
    const existingTask = tasks.find((t) => t.type === 'backup');

    if (!payload.enabled) {
      if (existingTask) {
        await this.client.patch(`/api/servers/${serverId}/scheduled-tasks/${existingTask.id}`, {
          enabled: false,
        });
      }
      return { enabled: false as const };
    }

    if (existingTask) {
      const response = await this.client.patch(
        `/api/servers/${serverId}/scheduled-tasks/${existingTask.id}`,
        { schedule: payload.schedule, enabled: true }
      );
      return {
        enabled: true as const,
        schedule: response.data?.task?.schedule ?? payload.schedule,
      };
    }

    const response = await this.client.post(`/api/servers/${serverId}/scheduled-tasks`, {
      type: 'backup',
      schedule: payload.schedule,
      enabled: true,
    });
    return {
      enabled: true as const,
      schedule: response.data?.task?.schedule ?? payload.schedule,
    };
  }

  async getCatalogGames(): Promise<{ games: any[] }> {
    try {
      const res = await fetch(`${CATALOG_BASE_URL}/linuxgsm/metadata`);
      if (!res.ok) return { games: [] };
      const body = (await res.json()) as {
        items?: Array<{
          shortname: string;
          serverFiles: ReleaseConfigFileDefinition[] | null;
          requireSteamCredentials?: boolean;
          requireGameCopy?: boolean;
        }>;
      };
      const items = body?.items ?? [];
      return {
        games: items.map((item) => ({
          shortname: item.shortname,
          gameservername: item.shortname,
          gamename: item.shortname,
          configFiles: item.serverFiles ?? [],
          requireSteamCredentials: item.requireSteamCredentials ?? false,
          requireGameCopy: item.requireGameCopy ?? false,
        })),
      };
    } catch {
      return { games: [] };
    }
  }

  async getCatalogGame(gameKey: string): Promise<any> {
    if (!gameKey) return null;
    try {
      const res = await fetch(
        `${CATALOG_BASE_URL}/linuxgsm/metadata/${encodeURIComponent(gameKey)}`
      );
      if (!res.ok) return null;
      const data = (await res.json()) as {
        shortname: string;
        ports?: {
          tcp?: Array<{ host: number; container: number; label?: string }>;
          udp?: Array<{ host: number; container: number; label?: string }>;
        } | null;
        healthcheck?: Record<string, unknown> | null;
        serverFiles: ReleaseConfigFileDefinition[] | null;
        requireSteamCredentials?: boolean;
        requireGameCopy?: boolean;
        logPrompts?: Array<{ match: string; action: string; title?: string }>;
      };
      if (!data?.shortname) return null;
      return {
        shortname: data.shortname,
        gameservername: data.shortname,
        gamename: data.shortname,
        ports: data.ports ?? null,
        healthcheck: data.healthcheck ?? null,
        configFiles: data.serverFiles ?? [],
        requireSteamCredentials: data.requireSteamCredentials ?? false,
        requireGameCopy: data.requireGameCopy ?? false,
        logPrompts: data.logPrompts ?? [],
      };
    } catch {
      return null;
    }
  }

  async getScheduledTasks(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/scheduled-tasks`);
    return response.data as {
      tasks: Array<{
        id: number;
        serverId: number;
        type: 'restart' | 'backup' | 'custom';
        schedule: string;
        enabled: boolean;
        payload: Record<string, unknown>;
        nextRunAt: string | null;
        lastRunAt: string | null;
        lastStatus: string | null;
        lastError: string | null;
      }>;
    };
  }

  async createScheduledTask(
    serverId: number,
    payload: {
      type: 'restart' | 'backup' | 'custom';
      schedule: string;
      enabled?: boolean;
      payload?: Record<string, unknown>;
    }
  ) {
    const response = await this.client.post(`/api/servers/${serverId}/scheduled-tasks`, payload);
    return response.data;
  }

  async updateScheduledTask(
    serverId: number,
    taskId: number,
    payload: {
      type?: string;
      schedule?: string;
      enabled?: boolean;
      payload?: Record<string, unknown>;
    }
  ) {
    const response = await this.client.patch(
      `/api/servers/${serverId}/scheduled-tasks/${taskId}`,
      payload
    );
    return response.data;
  }

  async deleteScheduledTask(serverId: number, taskId: number) {
    const response = await this.client.delete(`/api/servers/${serverId}/scheduled-tasks/${taskId}`);
    return response.data;
  }

  async listServerFileRoots(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/files/roots`);
    return response.data as {
      roots: Array<{ key: string; containerPath: string }>;
    };
  }

  async listServerFiles(serverId: number, path: string = '/', root?: string) {
    const response = await this.client.get(`/api/servers/${serverId}/files`, {
      params: { path, ...(root ? { root } : {}) },
    });
    return response.data as {
      path: string;
      entries: Array<{
        name: string;
        type: 'dir' | 'file' | 'symlink';
        size: number;
        modifiedAt: string;
      }>;
    };
  }

  private fileVersions = new Map<string, string>();
  private fileKey(serverId: number, path: string, root?: string) { return JSON.stringify([ACTIVE_NODE, serverId, root, path]); }

  async readServerFile(serverId: number, path: string, root?: string) {
    const response = await this.client.get(`/api/servers/${serverId}/file`, {
      params: { path, ...(root ? { root } : {}) },
      responseType: 'text',
    });
    this.fileVersions.set(this.fileKey(serverId, path, root), response.headers.etag || '');
    return response.data as string;
  }

  async readServerFileBytes(serverId: number, path: string, root?: string): Promise<ArrayBuffer> {
    const response = await this.client.get(`/api/servers/${serverId}/file`, {
      params: { path, ...(root ? { root } : {}) }, responseType: 'arraybuffer',
    });
    return response.data;
  }

  async getServerDownloadUrl(serverId: number, path: string, root?: string): Promise<string> {
    const res = await this.client.post(`/api/servers/${serverId}/files/download-token`, {
      path,
      ...(root ? { root } : {}),
    });
    return `${API_BASE_URL}${res.data.path as string}`;
  }

  async readServerFileSnapshot(serverId: number, path: string, root?: string) {
    const response = await this.client.get(`/api/servers/${serverId}/file`, { params: { path, ...(root ? { root } : {}) }, responseType: 'arraybuffer' });
    return { bytes: response.data as ArrayBuffer, version: response.headers.etag as string | undefined };
  }

  async fileHistory(serverId: number, path: string, root: string): Promise<FileHistoryEntry[]> {
    const response = await this.client.get(`/api/servers/${serverId}/file/history`, { params: { path, root } });
    if (!Array.isArray(response.data.entries)) throw new Error('File history is unavailable on this agent');
    return response.data.entries;
  }
  async fileHistoryEntry(serverId: number, path: string, root: string, entry: string): Promise<FileHistoryDetail> {
    const response = await this.client.get(`/api/servers/${serverId}/file/history`, { params: { path, root, entry } });
    if (typeof response.data.entry?.before !== 'string' || typeof response.data.entry?.after !== 'string') throw new Error('History snapshot is unavailable');
    return response.data.entry;
  }

  async updateServerFile(serverId: number, path: string, content: string, root?: string, version?: string, overwrite = false) {
    const expected = version ?? this.fileVersions.get(this.fileKey(serverId, path, root));
    if (!overwrite && !expected) throw new Error('This runtime did not return a file version. Update the agent and reopen the file before saving.');
    const response = await this.client.put(
      `/api/servers/${serverId}/file`,
      { content, version: expected, ...(overwrite ? { overwrite: true } : {}) },
      { params: { path, ...(root ? { root } : {}) } }
    );
    this.fileVersions.set(this.fileKey(serverId, path, root), response.data.version);
    return response.data;
  }

  async createServerDirectory(serverId: number, path: string, name: string, root?: string) {
    const response = await this.client.post(`/api/servers/${serverId}/files/mkdir`, {
      path,
      name,
      ...(root ? { root } : {}),
    });
    return response.data;
  }

  async createServerFile(
    serverId: number,
    path: string,
    name: string,
    content: string,
    root?: string
  ) {
    const response = await this.client.post(`/api/servers/${serverId}/files/touch`, {
      path,
      name,
      content,
      ...(root ? { root } : {}),
    });
    return response.data;
  }

  async renameServerPath(serverId: number, from: string, to: string, root?: string) {
    const response = await this.client.post(`/api/servers/${serverId}/files/rename`, {
      from,
      to,
      ...(root ? { root } : {}),
    });
    return response.data;
  }

  async deleteServerPaths(serverId: number, paths: string[], root?: string) {
    const response = await this.client.post(`/api/servers/${serverId}/files/delete`, {
      paths,
      ...(root ? { root } : {}),
    });
    return response.data;
  }

  async extractServerArchive(serverId: number, path: string, root?: string, options?: { deleteArchive: boolean; overwrite: boolean }) {
    const response = await this.client.post(`/api/servers/${serverId}/files/extract`, {
      path,
      ...(root ? { root } : {}),
      ...options,
    });
    return (response.data as { job: FileTransferJob }).job;
  }

  async listFileTransfers(serverId: number): Promise<FileTransferJob[]> {
    const response = await this.client.get(`/api/servers/${serverId}/files/transfers`, { params: { limit: 20 } });
    if (!Array.isArray(response.data.jobs)) throw new Error('Operation history unavailable');
    return response.data.jobs;
  }

  async getFileTransfer(serverId: number, jobId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/files/transfers/${jobId}`);
    return (response.data as { job: FileTransferJob }).job;
  }

  async uploadServerFile(
    serverId: number,
    destDir: string,
    relativePath: string,
    file: File,
    onProgress?: (percent: number) => void,
    root?: string
  ) {
    const SMALL_LIMIT = 64 * 1024 * 1024;
    const baseDir = destDir.replace(/\/$/, '') || '';
    const destPath = `${baseDir}/${relativePath}`;

    if (file.size <= SMALL_LIMIT) {
      await this.client.put(`/api/servers/${serverId}/files/upload`, file, {
        params: { path: destPath, overwrite: 'true', ...(root ? { root } : {}) },
        headers: { 'Content-Type': 'application/octet-stream' },
        timeout: LONG_TIMEOUT_MS,
        onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
      });
    } else {
      const CHUNK_SIZE = 16 * 1024 * 1024;
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const dirPath = baseDir || '/';

      const sessionRes = await this.client.post(
        `/api/servers/${serverId}/files/upload-sessions`,
        {
          path: dirPath,
          totalBytes: file.size,
          totalFiles: 1,
          overwrite: true,
          ...(root ? { root } : {}),
        },
        { timeout: LONG_TIMEOUT_MS }
      );
      const uploadId = sessionRes.data?.upload?.id as number;

      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const chunk = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
        await retryWithBackoff(() =>
          this.client.put(
            `/api/servers/${serverId}/files/upload-sessions/${uploadId}/chunks`,
            chunk,
            {
              params: {
                relativePath,
                chunkIndex: i,
                totalChunks,
                fileSize: file.size,
                ...(root ? { root } : {}),
              },
              headers: { 'Content-Type': 'application/octet-stream' },
              timeout: LONG_TIMEOUT_MS,
              onUploadProgress: (e) => {
                const chunkPct = e.total ? e.loaded / e.total : 0;
                onProgress?.(Math.round(((i + chunkPct) / totalChunks) * 100));
              },
            }
          )
        );
      }

      await this.client.post(
        `/api/servers/${serverId}/files/upload-sessions/${uploadId}/complete`,
        undefined,
        { timeout: LONG_TIMEOUT_MS }
      );
    }
  }

  async startGameServer(id: string | number) {
    return this.startServer(Number(id));
  }

  async stopGameServer(id: string | number) {
    return this.stopServer(Number(id));
  }

  async restartGameServer(id: string | number) {
    return this.restartServer(Number(id));
  }

  connectWebSocket(onMessage?: (data: any) => void): Promise<void> {
    return this.realtime.connect(onMessage);
  }

  sendWebSocketMessage(message: any) {
    this.realtime.send(message);
  }

  addWebSocketListener(listener: (data: any) => void) {
    this.realtime.addListener(listener);
  }

  removeWebSocketListener(listener: (data: any) => void) {
    this.realtime.removeListener(listener);
  }

  subscribeLogs(serverId: number, limit?: number) {
    this.realtime.subscribeLogs(serverId, limit);
  }

  unsubscribeLogs(serverId: number) {
    this.realtime.unsubscribeLogs(serverId);
  }

  subscribeActions(serverId: number, limit?: number, owner?: string) {
    this.realtime.subscribeActions(serverId, limit, owner);
  }

  unsubscribeActions(serverId: number, owner?: string) {
    this.realtime.unsubscribeActions(serverId, owner);
  }

  subscribeServersMetrics() {
    this.realtime.subscribeServersMetrics();
  }

  unsubscribeServersMetrics() {
    this.realtime.unsubscribeServersMetrics();
  }

  // 24h history of one server, downsampled by the backend. Fetched when a graph opens.
  async getServerMetrics(serverId: number, limit = 2000) {
    const response = await this.client.get(`/api/servers/${serverId}/metrics`, {
      params: { limit },
    });
    return response.data as {
      serverId: number;
      metrics: ServerMetricSample[];
      limit: number;
      meta?: { window: string; downsample: string; rawCount: number; sentCount: number };
    };
  }

  subscribeSystemMetrics(limit?: number) {
    this.realtime.subscribeSystemMetrics(limit);
  }

  unsubscribeSystemMetrics() {
    this.realtime.unsubscribeSystemMetrics();
  }

  subscribeInstall(serverId: number) {
    this.realtime.subscribeInstall(serverId);
  }

  unsubscribeInstall(serverId: number) {
    this.realtime.unsubscribeInstall(serverId);
  }

  subscribeServers() {
    this.realtime.subscribeServers();
  }

  async getBindAddresses(): Promise<{
    addresses: string[];
    requireExplicitIp?: boolean;
    portsByIp?: Record<
      string,
      { tcp: Array<{ from: number; to: number }>; udp: Array<{ from: number; to: number }> }
    > | null;
  }> {
    const response = await this.client.get('/api/system/bind-addresses');
    return response.data;
  }

  async getPanelAppearance(): Promise<Appearance> {
    return (await this.client.get('/api/system/appearance')).data;
  }

  async getGlobalSettings(): Promise<GlobalSettings & { assignments: Assignment[] }> {
    return (await this.client.get('/api/system/settings')).data;
  }

  async saveGlobalSettings(settings: GlobalSettings): Promise<GlobalSettings> {
    return (await this.client.put('/api/system/settings', settings)).data;
  }

  async checkPanelUpdate(): Promise<PanelUpdateCheck> {
    const response = await this.client.get('/api/system/update/check');
    return response.data as PanelUpdateCheck;
  }

  async getPanelUpdateStatus(): Promise<{ running: boolean; job: null | { id: number; status: string; message: string | null; errorMessage: string | null; targetVersion: string } }> {
    return (await this.client.get('/api/system/update/status')).data;
  }

  async startPanelUpdate(version: string): Promise<{
    started: boolean;
    jobId: number;
    targetVersion: string;
  }> {
    const response = await this.client.post('/api/system/update', { version });
    return response.data as { started: boolean; jobId: number; targetVersion: string };
  }

  async getServerSettings(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/settings`);
    return response.data as SettingsScreen;
  }

  async patchServerSettingsFile(
    serverId: number,
    settings: Record<string, string | number | boolean | null>
  ) {
    const response = await this.client.patch(`/api/servers/${serverId}/settings/file`, {
      settings,
    });
    return response.data as PatchSettingsResponse;
  }

  async patchServerSettingsLaunch(
    serverId: number,
    settings: Record<string, string | number | boolean | null>
  ) {
    const response = await this.client.patch(`/api/servers/${serverId}/settings/launch`, {
      settings,
    });
    return response.data as PatchSettingsResponse;
  }

  async getServerSettingOptions(
    serverId: number,
    key: string,
    params: Record<string, string | number> = {}
  ) {
    const response = await this.client.get(`/api/servers/${serverId}/settings/options`, {
      params: { key, ...params },
    });
    return response.data as SettingOptionsResponse;
  }

  async getMinecraftSettings(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/minecraft/settings`);
    return response.data as {
      settings: Array<{
        key: string;
        label: string;
        description: string;
        type: 'select' | 'integer' | 'boolean' | 'string';
        options?: string[];
        min?: number;
        max?: number;
        value: string | number | boolean;
      }>;
    };
  }

  async patchMinecraftSettings(
    serverId: number,
    settings: Record<string, string | number | boolean>
  ) {
    const response = await this.client.patch(`/api/servers/${serverId}/minecraft/settings`, {
      settings,
    });
    return response.data as { updated: string[]; settings: Array<unknown> };
  }

  async getMinecraftOperators(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/minecraft/operators`);
    return response.data as {
      operators: Array<{ uuid: string; name: string; level: number; bypassesPlayerLimit: boolean }>;
    };
  }

  async addMinecraftOperator(serverId: number, name: string) {
    const response = await this.client.post(`/api/servers/${serverId}/minecraft/operators`, {
      name,
    });
    return response.data;
  }

  async removeMinecraftOperator(serverId: number, name: string) {
    const response = await this.client.delete(
      `/api/servers/${serverId}/minecraft/operators/${encodeURIComponent(name)}`
    );
    return response.data;
  }

  async getMinecraftWhitelist(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/minecraft/whitelist`);
    return response.data as {
      whitelist: { enabled: boolean; players: Array<{ uuid: string; name: string }> };
    };
  }

  async patchMinecraftWhitelist(serverId: number, enabled: boolean) {
    const response = await this.client.patch(`/api/servers/${serverId}/minecraft/whitelist`, {
      enabled,
    });
    return response.data;
  }

  async addMinecraftWhitelistPlayer(serverId: number, name: string) {
    const response = await this.client.post(
      `/api/servers/${serverId}/minecraft/whitelist/players`,
      { name }
    );
    return response.data;
  }

  async removeMinecraftWhitelistPlayer(serverId: number, name: string) {
    const response = await this.client.delete(
      `/api/servers/${serverId}/minecraft/whitelist/players/${encodeURIComponent(name)}`
    );
    return response.data;
  }

  async getMinecraftPlayerBans(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/minecraft/bans/players`);
    return response.data as {
      bans: Array<{
        name: string;
        uuid?: string;
        reason?: string;
        created?: string;
        expires?: string;
        source?: string;
      }>;
    };
  }

  async banMinecraftPlayer(serverId: number, name: string, reason?: string) {
    const response = await this.client.post(`/api/servers/${serverId}/minecraft/bans/players`, {
      name,
      ...(reason ? { reason } : {}),
    });
    return response.data;
  }

  async unbanMinecraftPlayer(serverId: number, name: string) {
    const response = await this.client.delete(
      `/api/servers/${serverId}/minecraft/bans/players/${encodeURIComponent(name)}`
    );
    return response.data;
  }

  async getMinecraftIpBans(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/minecraft/bans/ips`);
    return response.data as {
      bans: Array<{
        ip: string;
        reason?: string;
        created?: string;
        expires?: string;
        source?: string;
      }>;
    };
  }

  async banMinecraftIp(serverId: number, target: string, reason?: string) {
    const response = await this.client.post(`/api/servers/${serverId}/minecraft/bans/ips`, {
      target,
      ...(reason ? { reason } : {}),
    });
    return response.data;
  }

  async unbanMinecraftIp(serverId: number, ip: string) {
    const response = await this.client.delete(
      `/api/servers/${serverId}/minecraft/bans/ips/${encodeURIComponent(ip)}`
    );
    return response.data;
  }

  async getHytaleSettings(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/hytale/settings`);
    return response.data as {
      settings: Array<{
        key: string;
        label: string;
        description: string;
        type: 'integer' | 'boolean' | 'string';
        min?: number;
        max?: number;
        value: string | number | boolean;
      }>;
    };
  }

  async patchHytaleSettings(serverId: number, settings: Record<string, string | number | boolean>) {
    const response = await this.client.patch(`/api/servers/${serverId}/hytale/settings`, {
      settings,
    });
    return response.data as { updated: string[]; settings: Array<unknown> };
  }

  async getPalworldSettings(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/palworld/settings`);
    return response.data as {
      settings: Array<{
        key: string;
        label: string;
        description: string;
        type: 'integer' | 'boolean' | 'string' | 'float' | 'select';
        options?: Array<{ label: string; value: string }> | string[];
        min?: number;
        max?: number;
        value: string | number | boolean;
      }>;
    };
  }

  async patchPalworldSettings(
    serverId: number,
    settings: Record<string, string | number | boolean>
  ) {
    const response = await this.client.patch(`/api/servers/${serverId}/palworld/settings`, {
      settings,
    });
    return response.data as { updated: string[]; settings: Array<unknown> };
  }

  async getProjectZomboidSettings(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/project-zomboid/settings`);
    return response.data as {
      settings: Array<{
        key: string;
        label: string;
        description: string;
        type: 'integer' | 'boolean' | 'string' | 'float' | 'select';
        options?: Array<{ label: string; value: string }> | string[];
        min?: number;
        max?: number;
        value: string | number | boolean;
      }>;
    };
  }

  async patchProjectZomboidSettings(
    serverId: number,
    settings: Record<string, string | number | boolean>
  ) {
    const response = await this.client.patch(`/api/servers/${serverId}/project-zomboid/settings`, {
      settings,
    });
    return response.data as { updated: string[]; settings: Array<unknown> };
  }

  async getProjectZomboidMods(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/project-zomboid/mods`);
    return response.data as { mods: ProjectZomboidMod[] };
  }

  async getProjectZomboidWorkshopPreview(serverId: number, workshopId: string) {
    const response = await this.client.get(
      `/api/servers/${serverId}/project-zomboid/mods/workshop/${encodeURIComponent(workshopId)}`
    );
    return (response.data as { item: ProjectZomboidWorkshopPreview }).item;
  }

  // Bulk add: the backend resolves each Workshop item's mod ids via SteamCMD
  // (synchronous, can take seconds). Accepts a string or array of Workshop ids.
  async addProjectZomboidMods(serverId: number, workshopIds: string | string[]) {
    const response = await this.client.post(`/api/servers/${serverId}/project-zomboid/mods`, {
      workshopIds,
    });
    return response.data as {
      mods: ProjectZomboidMod[];
      added: string[];
      failed: string[];
      skipped: string[];
    };
  }

  async patchProjectZomboidMod(
    serverId: number,
    workshopId: string,
    input: { enabled?: boolean; modIds?: ProjectZomboidModId[] }
  ) {
    const response = await this.client.patch(
      `/api/servers/${serverId}/project-zomboid/mods/${encodeURIComponent(workshopId)}`,
      input
    );
    return response.data as { mods: ProjectZomboidMod[] };
  }

  async reorderProjectZomboidMods(serverId: number, order: string[]) {
    const response = await this.client.put(`/api/servers/${serverId}/project-zomboid/mods/order`, {
      order,
    });
    return response.data as { mods: ProjectZomboidMod[] };
  }

  async deleteProjectZomboidMod(serverId: number, workshopId: string) {
    const response = await this.client.delete(
      `/api/servers/${serverId}/project-zomboid/mods/${encodeURIComponent(workshopId)}`
    );
    return response.data as { mods: ProjectZomboidMod[] };
  }

  // Generic wipe (all OVHcloud games). Server must be stopped (backend returns 409
  // otherwise). Soft resets the world/progress and returns the removed paths; hard
  // wipes every volume and reinstalls the server (returns immediately).
  async wipeServer(serverId: number, mode: 'soft' | 'hard') {
    const response = await this.client.post(
      `/api/servers/${serverId}/wipe/${encodeURIComponent(mode)}`
    );
    return response.data as
      | { mode: 'soft'; removed: string[] }
      | { mode: 'hard'; reinstalling: true };
  }

  async getCS2Frameworks(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/counter-strike-2/frameworks`);
    return response.data as {
      frameworks: {
        metamodInstalled: boolean;
        counterStrikeSharpInstalled: boolean;
      };
    };
  }

  async installCS2Metamod(serverId: number, options?: { version?: string; gameinfoMode?: string }) {
    const response = await this.client.post(
      `/api/servers/${serverId}/counter-strike-2/metamod/install`,
      options ?? {},
      {
        timeout: LONG_TIMEOUT_MS,
      }
    );
    return response.data as {
      ok: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
      restarted: boolean;
    };
  }

  async installCS2CounterStrikeSharp(
    serverId: number,
    options?: { version?: string; releaseFlavor?: string; gameinfoMode?: string }
  ) {
    const response = await this.client.post(
      `/api/servers/${serverId}/counter-strike-2/counterstrikesharp/install`,
      options ?? {},
      {
        timeout: LONG_TIMEOUT_MS,
      }
    );
    return response.data as {
      ok: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
      restarted: boolean;
    };
  }

  async uploadModFile(
    serverId: number,
    file: File,
    routeBase: string,
    onProgress?: (percent: number) => void
  ) {
    const SMALL_LIMIT = 64 * 1024 * 1024;

    if (file.size <= SMALL_LIMIT) {
      await this.client.put(`/api/servers/${serverId}/${routeBase}/upload`, file, {
        params: { path: `/${file.name}` },
        headers: { 'Content-Type': 'application/octet-stream' },
        timeout: LONG_TIMEOUT_MS,
        onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0),
      });
    } else {
      const CHUNK_SIZE = 16 * 1024 * 1024;
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      const sessionRes = await this.client.post(
        `/api/servers/${serverId}/${routeBase}/upload-sessions`,
        { totalBytes: file.size, totalFiles: 1, overwrite: true },
        { timeout: LONG_TIMEOUT_MS }
      );
      const sessionId = sessionRes.data?.upload?.id as number;

      try {
        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const chunk = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
          await this.client.put(
            `/api/servers/${serverId}/${routeBase}/upload-sessions/${sessionId}/chunks`,
            chunk,
            {
              params: { relativePath: file.name, chunkIndex: i, totalChunks, fileSize: file.size },
              headers: { 'Content-Type': 'application/octet-stream' },
              timeout: LONG_TIMEOUT_MS,
              onUploadProgress: (e) => {
                const chunkPct = e.total ? e.loaded / e.total : 0;
                onProgress?.(Math.round(((i + chunkPct) / totalChunks) * 100));
              },
            }
          );
        }
        await this.client.post(
          `/api/servers/${serverId}/${routeBase}/upload-sessions/${sessionId}/complete`,
          undefined,
          { timeout: LONG_TIMEOUT_MS }
        );
      } catch (err) {
        await this.client
          .delete(`/api/servers/${serverId}/${routeBase}/upload-sessions/${sessionId}`)
          .catch(() => {});
        throw err;
      }
    }
  }

  async listHytaleMods(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/hytale/mods`);
    return response.data as {
      entries: Array<{ name: string; type: string; size: number; modifiedAt: string }>;
    };
  }

  async uploadHytaleMod(serverId: number, file: File, onProgress?: (percent: number) => void) {
    return this.uploadModFile(serverId, file, 'hytale/mods', onProgress);
  }

  async deleteHytaleMods(serverId: number, paths: string[]) {
    const response = await this.client.delete(`/api/servers/${serverId}/hytale/mods`, {
      data: { paths },
    });
    return response.data;
  }

  async listMinecraftAddons(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/minecraft/addons`);
    return response.data as {
      entries: Array<{ name: string; type: string; size: number; modifiedAt: string }>;
    };
  }

  async uploadMinecraftAddon(serverId: number, file: File, onProgress?: (percent: number) => void) {
    return this.uploadModFile(serverId, file, 'minecraft/addons', onProgress);
  }

  async deleteMinecraftAddons(serverId: number, paths: string[]) {
    const response = await this.client.delete(`/api/servers/${serverId}/minecraft/addons`, {
      data: { paths },
    });
    return response.data;
  }

  async searchMinecraftAddons(serverId: number, params: SearchAddonsParams = {}) {
    const response = await this.client.get(
      `/api/servers/${serverId}/minecraft/addons-catalog/search`,
      {
        params: {
          ...(params.query ? { query: params.query } : {}),
          ...(params.sort ? { sort: params.sort } : {}),
          ...(params.category ? { category: params.category } : {}),
          ...(params.offset != null ? { offset: params.offset } : {}),
          ...(params.limit != null ? { limit: params.limit } : {}),
          ...(params.anyVersion ? { anyVersion: true } : {}),
        },
      }
    );
    return response.data as AddonSearchResponse;
  }

  async getMinecraftAddonProject(serverId: number, projectId: string, anyVersion = false) {
    const response = await this.client.get(
      `/api/servers/${serverId}/minecraft/addons-catalog/projects/${encodeURIComponent(projectId)}`,
      { params: anyVersion ? { anyVersion: true } : {} }
    );
    return response.data as AddonProjectResponse;
  }

  async getMinecraftInstalledAddons(serverId: number) {
    const response = await this.client.get(
      `/api/servers/${serverId}/minecraft/addons-catalog/installed`
    );
    return response.data as InstalledResponse;
  }

  // Install or update are the same idempotent call; omit versionId for the latest stable release.
  async installMinecraftAddon(serverId: number, projectId: string, versionId?: string) {
    const response = await this.client.put(
      `/api/servers/${serverId}/minecraft/addons-catalog/installed/${encodeURIComponent(projectId)}`,
      versionId ? { versionId } : {}
    );
    return response.data as InstallAddonResponse;
  }

  // Enable/disable is keyed by file name (an unknown jar must be toggleable too).
  async setMinecraftAddonEnabled(serverId: number, fileName: string, enabled: boolean) {
    const response = await this.client.patch(
      `/api/servers/${serverId}/minecraft/addons-catalog/installed`,
      { fileName, enabled }
    );
    return response.data as SetAddonEnabledResponse;
  }

  async getRustSettings(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/rust/settings`);
    return response.data as {
      settings: Array<{
        key: string;
        label: string;
        description: string;
        type: 'integer' | 'boolean' | 'string' | 'float' | 'select';
        options?: Array<{ label: string; value: string }> | string[];
        min?: number;
        max?: number;
        value: string | number | boolean;
      }>;
    };
  }

  async patchRustSettings(serverId: number, settings: Record<string, string | number | boolean>) {
    const response = await this.client.patch(`/api/servers/${serverId}/rust/settings`, {
      settings,
    });
    return response.data as { updated: string[]; settings: Array<unknown> };
  }

  async getRustFrameworks(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/rust/frameworks`);
    return response.data as { frameworks: { oxideInstalled: boolean } };
  }

  async installRustOxide(serverId: number, options?: { version?: string }) {
    const response = await this.client.post(
      `/api/servers/${serverId}/rust/oxide/install`,
      options ?? {},
      {
        timeout: LONG_TIMEOUT_MS,
      }
    );
    return response.data as {
      ok: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
      restarted: boolean;
    };
  }

  async listRustMods(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/rust/mods`);
    return response.data as {
      entries: Array<{ name: string; type: string; size: number; modifiedAt: string }>;
    };
  }

  async uploadRustMod(serverId: number, file: File, onProgress?: (percent: number) => void) {
    return this.uploadModFile(serverId, file, 'rust/mods', onProgress);
  }

  async deleteRustMods(serverId: number, paths: string[]) {
    const response = await this.client.delete(`/api/servers/${serverId}/rust/mods`, {
      data: { paths },
    });
    return response.data;
  }

  // ── Valheim OVHcloud ──────────────────────────────────────────────────────

  async getValheimFrameworks(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/valheim/frameworks`);
    return response.data as { bepinex: { installed: boolean } };
  }

  // The install script takes the version as a positional argument; omitted means "latest".
  async installValheimBepInEx(serverId: number, options?: { version?: string }) {
    const response = await this.client.post(
      `/api/servers/${serverId}/valheim/bepinex/install`,
      options ?? {},
      {
        timeout: LONG_TIMEOUT_MS,
      }
    );
    return response.data as { ok: boolean; exitCode: number; stdout: string; stderr: string };
  }

  async listValheimMods(serverId: number) {
    const response = await this.client.get(`/api/servers/${serverId}/valheim/mods`);
    return response.data as {
      entries: Array<{ name: string; type: string; size: number; modifiedAt: string }>;
    };
  }

  async uploadValheimMod(serverId: number, file: File, onProgress?: (percent: number) => void) {
    return this.uploadModFile(serverId, file, 'valheim/mods', onProgress);
  }

  async deleteValheimMods(serverId: number, paths: string[]) {
    const response = await this.client.delete(`/api/servers/${serverId}/valheim/mods`, {
      data: { paths },
    });
    return response.data;
  }

  createAuthenticatedWebSocket(): Promise<WebSocket> {
    return this.realtime.createAuthenticatedWebSocket();
  }

  closeWebSocket() {
    this.realtime.close();
  }

  getWebSocketUrl(): string {
    return this.realtime.getWebSocketUrl();
  }
}

export const apiClient = new ApiClient();
