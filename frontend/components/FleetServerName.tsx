import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { fleetAllowed, fleetContext, fleetRequest } from '../utils/fleetRuntime';
export function FleetServerName({
  id,
  name,
  editable,
  onSaved,
}: {
  id: string;
  name: string;
  editable: boolean;
  onSaved: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (busy || value.trim().length < 3 || value.trim().length > 50) return;
    setBusy(true);
    setError('');
    try {
      const context = await fleetContext(id);
      if (!fleetAllowed(context, 'server.edit'))
        throw new Error('You no longer have permission to edit this server.');
      const result = await fleetRequest<{ server: { id: number; name: string } }>(
        context,
        '',
        { name: value.trim() },
        'PATCH'
      );
      if (Number(result.server?.id) !== context.runtimeId)
        throw new Error('Server context changed. Refresh and retry.');
      onSaved(result.server.name);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot save server name');
    } finally {
      setBusy(false);
    }
  };
  if (!editing)
    return editable ? (
      <button
        className="fleet-edit-name"
        title="Edit server name"
        aria-label={`Edit name for ${name}`}
        onClick={() => {
          setValue(name);
          setError('');
          setEditing(true);
        }}
      >
        <strong>{name}</strong>
        <Pencil size={14} />
      </button>
    ) : (
      <strong>{name}</strong>
    );
  return (
    <div className="fleet-name-editor">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          autoFocus
          aria-label="Server name"
          value={value}
          disabled={busy}
          minLength={3}
          maxLength={50}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !busy) {
              e.stopPropagation();
              setEditing(false);
            }
          }}
        />
        <button
          type="submit"
          aria-label="Save server name"
          disabled={busy || value.trim().length < 3}
        >
          <Check size={18} />
        </button>
        <button
          type="button"
          aria-label="Cancel rename"
          disabled={busy}
          onClick={() => setEditing(false)}
        >
          <X size={18} />
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
