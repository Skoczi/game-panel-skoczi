import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Loader2, Save } from 'lucide-react';
import { AppButton, AppInput, AppSelect, AppSlider, AppToggle, InfoTip } from '../../src/ui/components';
import { RestartToApplyNote } from './RestartToApplyNote';

export type GameSettingOption = { label: string; value: string };

export type GameSettingField = {
  key: string;
  label: string;
  description: string;
  type: 'select' | 'integer' | 'boolean' | 'string' | 'float';
  options?: GameSettingOption[] | string[];
  min?: number;
  max?: number;
  value: string | number | boolean;
};

export interface GameSettingsSectionProps {
  serverId: number;
  serverStatus?: string | null;
  canRead: boolean;
  canWrite: boolean;
  load: (serverId: number) => Promise<{ settings: GameSettingField[] }>;
  save: (
    serverId: number,
    changed: Record<string, string | number | boolean>
  ) => Promise<unknown>;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
  editableOnlyWhenStopped?: boolean;
}

function SectionCard({ title, children, borderColor, contentBg, textPrimary }: {
  title: string;
  children: React.ReactNode;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
}) {
  return (
    <div className={`${contentBg} border ${borderColor} rounded-lg p-4 space-y-3`}>
      <h4 className={`text-base font-semibold ${textPrimary}`}>{title}</h4>
      {children}
    </div>
  );
}

function ErrorMsg({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="text-sm text-red-400">{error}</p>;
}

function SuccessMsg({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-emerald-400">
      <Check className="w-4 h-4" />
      {msg}
    </div>
  );
}

// Options may arrive as plain strings or {label,value} pairs, and the value may be
// numeric (e.g. Project Zomboid select values are 1-based numbers). AppSelect compares
// string values, so coerce everything to strings for display/selection; the original
// (possibly numeric) value is restored at save time in resolveOutgoingValue.
function normalizeOptions(options: GameSettingField['options']): GameSettingOption[] {
  if (!Array.isArray(options)) return [];
  return options.map((o) =>
    typeof o === 'string' ? { label: o, value: o } : { label: String(o.label), value: String(o.value) }
  );
}

// Map the (stringified) selected value back to the option's original value so numeric
// select values are sent as numbers, not strings.
function resolveOutgoingValue(field: GameSettingField, value: string | number | boolean): string | number | boolean {
  if (field.type !== 'select' || !Array.isArray(field.options)) return value;
  const match = field.options.find((o) =>
    (typeof o === 'string' ? o : String(o.value)) === String(value)
  );
  if (match === undefined) return value;
  return typeof match === 'string' ? match : match.value;
}

// Float sliders need a decimal step; derive ~100 steps across the range.
function floatStep(min?: number, max?: number): number {
  if (min == null || max == null || max <= min) return 0.01;
  const step = (max - min) / 100;
  return step > 0 ? step : 0.01;
}

export function GameSettingsSection({
  serverId,
  serverStatus,
  canRead,
  canWrite,
  load,
  save,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
  editableOnlyWhenStopped = false,
}: GameSettingsSectionProps) {
  const [fields, setFields] = useState<GameSettingField[]>([]);
  const [edits, setEdits] = useState<Record<string, string | number | boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const loaded = useRef(false);

  const isRunning = serverStatus === 'running';
  const editingLocked = editableOnlyWhenStopped && isRunning;
  const canEdit = canWrite && !editingLocked;

  const loadSettings = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const data = await load(serverId);
      setFields(data.settings);
      const initial: Record<string, string | number | boolean> = {};
      data.settings.forEach((f) => { initial[f.key] = f.value; });
      setEdits(initial);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load server settings.');
    } finally {
      setLoading(false);
    }
  }, [serverId, canRead, load]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const changed: Record<string, string | number | boolean> = {};
      fields.forEach((f) => {
        const next = resolveOutgoingValue(f, edits[f.key]);
        if (next !== f.value) changed[f.key] = next;
      });
      if (Object.keys(changed).length === 0) {
        setSuccess('No changes to save.');
        setSaving(false);
        return;
      }
      await save(serverId, changed);
      setSuccess(
        editableOnlyWhenStopped
          ? 'Settings saved. They will apply on the next start.'
          : 'Settings saved. Restart the server to apply the changes.'
      );
      await loadSettings();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Server Settings" borderColor={borderColor} contentBg={contentBg} textPrimary={textPrimary}>
      {editableOnlyWhenStopped
        ? isRunning && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>The server must be stopped to edit these settings. Stop it, make your changes, then start it again.</span>
            </div>
          )
        : <RestartToApplyNote serverStatus={serverStatus} />}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading settings...
        </div>
      )}
      <ErrorMsg error={error} />
      <SuccessMsg msg={success} />
      {!loading && fields.length === 0 && !error && (
        <p className={`text-sm ${textSecondary}`}>
          No settings available. The server may not have started yet.
        </p>
      )}
      {!loading && fields.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {fields.map((field) => (
              <div key={field.key} className={`rounded-lg border ${borderColor} bg-gp-surface-base/45 p-3 sm:p-4 flex flex-col justify-center`}>
                <div className={`grid grid-cols-1 items-center gap-3 sm:gap-4 w-full ${field.type === 'boolean' ? 'sm:grid-cols-[1fr_auto]' : 'sm:grid-cols-[minmax(185px,1.15fr)_minmax(0,1.1fr)]'}`}>
                  <div>
                    <span className={`flex items-center gap-1.5 text-sm font-semibold leading-tight sm:pr-2 ${textPrimary}`}>
                      <span className="break-words">{field.label}</span>
                      {field.description && <InfoTip text={field.description} />}
                    </span>
                  </div>
                  <div>
                    {field.type === 'boolean' && (
                      <div className="flex items-center justify-end">
                        <AppToggle
                          ariaLabel={field.label}
                          checked={String(edits[field.key] ?? field.value) === 'true'}
                          onChange={(checked) => setEdits((prev) => ({ ...prev, [field.key]: checked }))}
                          className="shrink-0"
                          disabled={!canEdit}
                        />
                      </div>
                    )}
                    {field.type === 'select' && (
                      <AppSelect
                        value={String(edits[field.key] ?? field.value)}
                        onChange={(v) => setEdits((prev) => ({ ...prev, [field.key]: v }))}
                        options={normalizeOptions(field.options)}
                        className="w-full gp-game-config-select"
                        disabled={!canEdit}
                      />
                    )}
                    {(field.type === 'integer' || field.type === 'float') && field.min != null && field.max != null ? (
                      <div className="space-y-1.5">
                        <AppSlider
                          min={field.min}
                          max={field.max}
                          step={field.type === 'float' ? floatStep(field.min, field.max) : 1}
                          value={Number(edits[field.key] ?? field.value)}
                          onChange={(e) => setEdits((prev) => ({
                            ...prev,
                            [field.key]: field.type === 'float' ? (parseFloat(e.target.value) || 0) : (parseInt(e.target.value) || 0),
                          }))}
                          aria-label={field.label}
                          disabled={!canEdit}
                        />
                        <div className={`grid grid-cols-3 items-center text-[11px] ${textSecondary}`}>
                          <span className="text-left">{field.min}</span>
                          <input
                            type="number"
                            min={field.min}
                            max={field.max}
                            step={field.type === 'float' ? 'any' : 1}
                            value={Number(edits[field.key] ?? field.value)}
                            onChange={(e) => {
                              const v = field.type === 'float' ? parseFloat(e.target.value) : parseInt(e.target.value);
                              if (!isNaN(v)) setEdits((prev) => ({ ...prev, [field.key]: Math.min(field.max!, Math.max(field.min!, v)) }));
                            }}
                            disabled={!canEdit}
                            className="w-16 text-center text-xs font-semibold rounded px-1 py-0.5 mx-auto block bg-gp-surface-elevated border border-gray-600 focus:outline-none focus:ring-2 focus:ring-[var(--color-cyan-400)]/40 focus:border-[var(--color-cyan-400)] text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                          <span className="text-right">{field.max}</span>
                        </div>
                      </div>
                    ) : (field.type === 'integer' || field.type === 'float') ? (
                      <AppInput
                        type="number"
                        min={field.min}
                        max={field.max}
                        step={field.type === 'float' ? 'any' : 1}
                        value={String(edits[field.key] ?? field.value)}
                        onChange={(e) => setEdits((prev) => ({
                          ...prev,
                          [field.key]: field.type === 'float' ? (parseFloat(e.target.value) || 0) : (parseInt(e.target.value) || 0),
                        }))}
                        className="w-full px-3 py-2 bg-gp-surface-elevated border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-cyan-400)]/40 focus:border-[var(--color-cyan-400)]"
                        disabled={!canEdit}
                      />
                    ) : null}
                    {field.type === 'string' && (
                      <AppInput
                        type="text"
                        value={String(edits[field.key] ?? field.value)}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [field.key]: e.target.value }))}
                        className="w-full px-3 py-2 bg-gp-surface-elevated border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-cyan-400)]/40 focus:border-[var(--color-cyan-400)]"
                        disabled={!canEdit}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {canWrite && (
            <div className="flex justify-end pt-2">
              <AppButton
                tone="primary"
                onClick={handleSave}
                disabled={saving || editingLocked}
                className="flex items-center gap-1.5 px-5 py-2.5 rounded-lg text-sm font-medium disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {saving ? 'Saving…' : 'Save'}
              </AppButton>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}
