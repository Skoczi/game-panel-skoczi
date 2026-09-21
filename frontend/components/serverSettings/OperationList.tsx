import { type OperationState } from '../OperationNotice';
export interface OperationSummary {
  id: string;
  name: string;
  status: OperationState;
  startedAt?: string;
  completedAt?: string;
  actor?: string;
  detail?: string;
  error?: string;
}
export function OperationList({ operations, label, secondaryClass = 'text-slate-500' }: {
  operations: OperationSummary[];
  label: string;
  secondaryClass?: string;
}) {
  return <section aria-label={label} className="space-y-3 text-sm">
    <h4 className="font-semibold">Recent operations</h4>
    {operations.length === 0 && <p className={secondaryClass}>No recorded operations.</p>}
    {operations.map(operation => <div key={operation.id} className="flex flex-col gap-1">
      <span>{operation.name} · {operation.status}{operation.startedAt ? ` · ${new Date(operation.startedAt).toLocaleString()}` : ''}</span>
      <details className={secondaryClass}>
        <summary className="cursor-pointer text-xs">Details</summary>
        <div className="mt-1 space-y-1 break-words text-xs">
          <p>{operation.id}{operation.actor ? ` · ${operation.actor}` : ''}</p>
          {operation.completedAt && <p>Finished {new Date(operation.completedAt).toLocaleString()}</p>}
          {operation.detail && <p>{operation.detail}</p>}
        </div>
      </details>
      {(operation.status === 'unknown' || operation.status === 'interrupted') && <p role="note">Result unconfirmed. Check the server before retrying.</p>}
      {operation.error && <span role="alert" className="text-amber-500">{operation.error}</span>}
    </div>)}
  </section>;
}
