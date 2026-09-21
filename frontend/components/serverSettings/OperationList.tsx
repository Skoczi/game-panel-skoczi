import { OperationNotice, type OperationState } from '../OperationNotice';
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
      <span className={secondaryClass}>Operation {operation.id}{operation.actor ? ` · Started by ${operation.actor}` : ''}</span>
      {operation.completedAt && <span className={secondaryClass}>Recorded end: {new Date(operation.completedAt).toLocaleString()}</span>}
      {operation.detail && <span className={secondaryClass}>{operation.detail}</span>}
      <OperationNotice state={operation.status} />
      {operation.error && <span role="alert" className="text-amber-500">{operation.error}</span>}
    </div>)}
  </section>;
}
