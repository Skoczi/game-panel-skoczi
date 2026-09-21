export type OperationState = 'accepted' | 'running' | 'completed' | 'failed' | 'interrupted' | 'unknown';

export function OperationNotice({ state }: { state: OperationState }) {
  const text = state === 'accepted' || state === 'running'
    ? 'Continues if you leave this page. Cancellation is unavailable.'
    : state === 'unknown' || state === 'interrupted'
      ? 'The result is not confirmed. Check the saved operation and current server state before retrying.'
      : null;
  return text ? <p role="note" aria-label="Operation guidance" className="text-sm text-slate-500 dark:text-slate-400">{text}</p> : null;
}
