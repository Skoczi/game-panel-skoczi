import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Trash2 } from 'lucide-react';
import { AppButton } from '../../src/ui/components';
import { ConfirmationModal } from '../ConfirmationModal';
import type { WipeMode, WipeModeInfo } from './wipeModes';

export type { WipeMode, WipeModeInfo } from './wipeModes';

export interface WipeSectionProps {
  serverStatus?: string | null;
  canWrite: boolean;
  modes: WipeModeInfo[];
  onWipe: (mode: WipeMode) => Promise<{ removed?: string[]; reinstalling?: boolean }>;
  onReinstallStarted?: () => void;
  borderColor: string;
  contentBg: string;
  textPrimary: string;
  textSecondary: string;
}

const TONE = {
  soft: {
    card: 'border-amber-500/40 bg-amber-500/[0.06]',
    button: 'border-amber-500/50 text-amber-400 hover:bg-amber-500/10',
    confirmButton: 'bg-amber-600 hover:bg-amber-500',
  },
  hard: {
    card: 'border-red-500/40 bg-red-500/[0.06]',
    button: 'border-red-500/50 text-red-400 hover:bg-red-500/10',
    confirmButton: 'bg-red-600 hover:bg-red-500',
  },
} as const;

// Generic, game-agnostic "wipe" panel. Modes are supplied pre-filtered by the caller
// (supported by the game + permitted). Every mode is destructive with no automatic
// backup, so each is gated behind a type-to-confirm modal and requires the server to
// be stopped (the backend also enforces this, returning 409 if running).
export function WipeSection({
  serverStatus,
  canWrite,
  modes,
  onWipe,
  onReinstallStarted,
  borderColor,
  contentBg,
  textPrimary,
  textSecondary,
}: WipeSectionProps) {
  const [pending, setPending] = useState<WipeModeInfo | null>(null);
  const [result, setResult] = useState<{ mode: string; removed: string[] } | null>(null);

  const isRunning = serverStatus === 'running';
  const canMutate = canWrite && !isRunning;

  const handleConfirm = async () => {
    if (!pending) return;
    const mode = pending;
    const data = await onWipe(mode.id);
    if (data.reinstalling) {
      onReinstallStarted?.();
      return;
    }
    setResult({ mode: mode.label, removed: data.removed ?? [] });
  };

  if (modes.length === 0) return null;

  return (
    <div className={`${contentBg} border ${borderColor} rounded-lg p-4 space-y-3`}>
      <h4 className={`text-base font-semibold ${textPrimary}`}>Wipe</h4>

      {isRunning && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>The server must be stopped to wipe it. After a wipe the server stays stopped and regenerates on the next start.</span>
        </div>
      )}

      {result && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-300">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            {result.mode} complete{result.removed.length > 0 ? ` (${result.removed.length} path${result.removed.length > 1 ? 's' : ''} removed)` : ''}.
            The server is stopped — start it when ready to regenerate a fresh world.
          </span>
        </div>
      )}

      <div className="space-y-4">
        {modes.map((mode) => {
          const tone = TONE[mode.tone];
          return (
            <div key={mode.id} className={`rounded-xl border ${tone.card} p-3.5`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${textPrimary}`}>{mode.label}</p>
                  <p className={`mt-0.5 text-xs ${textSecondary}`}>{mode.description}</p>

                  <div className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    <div>
                      <span className="font-semibold text-red-400">Deleted</span>
                      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-gray-400">
                        {mode.deleted.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                    <div>
                      <span className="font-semibold text-emerald-400">Kept</span>
                      <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-gray-400">
                        {mode.kept.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>

                {canWrite && (
                  <AppButton
                    tone="ghost"
                    onClick={() => { setResult(null); setPending(mode); }}
                    disabled={!canMutate}
                    className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 ${tone.button}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {mode.label}
                  </AppButton>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmationModal
        isOpen={pending !== null}
        title={pending ? `${pending.label}?` : ''}
        message={pending?.confirmMessage ?? ''}
        icon="danger"
        requiredText={pending ? pending.label.toUpperCase() : undefined}
        confirmText={pending?.label ?? 'Wipe'}
        confirmButtonClass={pending ? TONE[pending.tone].confirmButton : undefined}
        onConfirm={handleConfirm}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
