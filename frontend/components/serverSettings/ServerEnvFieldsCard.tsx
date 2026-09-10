import { useEffect, useState } from 'react';
import { Check, Eye, EyeOff, Loader2, Save } from 'lucide-react';
import { AppButton, AppInput, AppToggle, InfoTip } from '../../src/ui/components';
import { apiClient } from '../../utils/api';

function FieldLabel({ label, tooltip }: { label: string; tooltip?: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <span className="block text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      {tooltip && <InfoTip text={tooltip} />}
    </div>
  );
}

// Parse a server's `env` (object, array of KEY=VALUE, or JSON string) into a map.
export function parseServerEnv(rawEnv: unknown): Record<string, string> {
  const parsed: Record<string, string> = {};
  const fromArray = (arr: unknown[]) => {
    for (const item of arr) {
      if (typeof item !== 'string') continue;
      const idx = item.indexOf('=');
      if (idx >= 0) parsed[item.slice(0, idx)] = item.slice(idx + 1);
    }
  };
  if (typeof rawEnv === 'string') {
    try {
      const decoded = JSON.parse(rawEnv);
      if (Array.isArray(decoded)) fromArray(decoded);
      else if (decoded && typeof decoded === 'object') Object.assign(parsed, decoded);
    } catch { /* empty */ }
  } else if (Array.isArray(rawEnv)) {
    fromArray(rawEnv);
  } else if (rawEnv && typeof rawEnv === 'object') {
    Object.assign(parsed, rawEnv as Record<string, string>);
  }
  return parsed;
}

export type EnvFieldDef = {
  key: string;
  label: string;
  description?: string;
  type: 'password' | 'toggle' | 'text';
  defaultValue?: string;
  minLength?: number;
};

export interface ServerEnvFieldsCardProps {
  serverId: number;
  serverStatus?: string | null;
  fields: EnvFieldDef[];
  canEdit: boolean;
  containerConfigSaveCount?: number;
  title?: string;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
}

export function ServerEnvFieldsCard({
  serverId,
  serverStatus,
  fields,
  canEdit,
  containerConfigSaveCount,
  title,
  borderColor,
  contentBg,
  textPrimary,
}: ServerEnvFieldsCardProps) {
  const [env, setEnv] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiClient.getServer(serverId).then((server: any) => {
      if (cancelled) return;
      const parsed = parseServerEnv(server?.env ?? server?.env_json ?? {});
      setEnv(parsed);
      const initial: Record<string, string> = {};
      fields.forEach((f) => { initial[f.key] = parsed[f.key] ?? f.defaultValue ?? ''; });
      setValues(initial);
    }).catch(() => {
      if (!cancelled) setEnv({});
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverId, containerConfigSaveCount]);

  const isRunning = serverStatus === 'running';
  const isDirty = env !== null && fields.some((f) => values[f.key] !== (env[f.key] ?? f.defaultValue ?? ''));

  const fieldError = (f: EnvFieldDef): string | null =>
    f.minLength && (values[f.key] ?? '').trim().length < f.minLength
      ? `Must be at least ${f.minLength} characters.`
      : null;
  const hasErrors = fields.some((f) => fieldError(f) !== null);

  const save = async () => {
    if (!canEdit || saving || hasErrors) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      // Re-fetch the latest env and change only these fields, so a separate env
      // editor (e.g. the CS2 config form) is not clobbered.
      const fresh: any = await apiClient.getServer(serverId);
      const newEnv = { ...parseServerEnv(fresh?.env ?? fresh?.env_json ?? {}) };
      fields.forEach((f) => { newEnv[f.key] = values[f.key]; });
      await apiClient.updateServer(serverId, { env: newEnv });
      setEnv(newEnv);
      if (isRunning) await apiClient.restartServer(serverId);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setSaveError(err?.response?.data?.error || err?.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`${contentBg} border ${borderColor} rounded-lg p-4 space-y-4`}>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          {title && <h4 className={`text-sm font-semibold ${textPrimary}`}>{title}</h4>}
          {fields.map((f) =>
            f.type === 'toggle' ? (
              <div key={f.key} className={`flex items-center justify-between gap-4 rounded-lg border ${borderColor} p-3`}>
                <div className="-mb-1.5 min-w-0">
                  <FieldLabel label={f.label} tooltip={f.description} />
                </div>
                <AppToggle
                  ariaLabel={f.label}
                  checked={values[f.key] === 'true'}
                  onChange={(next) => setValues((v) => ({ ...v, [f.key]: next ? 'true' : 'false' }))}
                  disabled={!canEdit}
                  className="shrink-0"
                />
              </div>
            ) : (
              <div key={f.key}>
                <FieldLabel label={f.label} tooltip={f.description} />

                {f.type === 'password' && (
                  <div className="relative">
                    <AppInput
                      type={revealed[f.key] ? 'text' : 'password'}
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                      spellCheck={false}
                      autoComplete="off"
                      disabled={!canEdit}
                      className="w-full px-3 py-2 pr-10 bg-gp-surface-elevated border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-cyan-400)]/40 focus:border-[var(--color-cyan-400)] disabled:opacity-60"
                    />
                    <button
                      type="button"
                      onClick={() => setRevealed((r) => ({ ...r, [f.key]: !r[f.key] }))}
                      aria-label={revealed[f.key] ? 'Hide' : 'Show'}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-200 transition-colors"
                    >
                      {revealed[f.key] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                )}

                {f.type === 'text' && (
                  <AppInput
                    type="text"
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                    disabled={!canEdit}
                    className="w-full px-3 py-2 bg-gp-surface-elevated border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-cyan-400)]/40 focus:border-[var(--color-cyan-400)] disabled:opacity-60"
                  />
                )}

                {fieldError(f) && <p className="mt-1.5 text-xs text-red-400">{fieldError(f)}</p>}
              </div>
            )
          )}

          {saveSuccess && (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <Check className="w-4 h-4" />
              {isRunning ? 'Saved. Server is restarting…' : 'Saved.'}
            </div>
          )}
          {saveError && <p className="text-sm text-red-400">{saveError}</p>}

          {canEdit && (
            <div className="flex justify-end">
              <AppButton
                tone="primary"
                onClick={save}
                disabled={saving || !isDirty || hasErrors}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {saving ? 'Saving…' : isRunning ? 'Save & Restart' : 'Save'}
              </AppButton>
            </div>
          )}
        </>
      )}
    </div>
  );
}
