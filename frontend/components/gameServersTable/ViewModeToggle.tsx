import { LayoutGrid, List } from 'lucide-react';

export type ServersViewMode = 'list' | 'grid';

interface ViewModeToggleProps {
  value: ServersViewMode;
  onChange: (mode: ServersViewMode) => void;
}

export function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  const options: { mode: ServersViewMode; label: string; Icon: typeof List }[] = [
    { mode: 'list', label: 'List view', Icon: List },
    { mode: 'grid', label: 'Grid view', Icon: LayoutGrid },
  ];

  return (
    <div role="group" aria-label="Servers view" className="inline-flex rounded-lg border border-gray-700 bg-gp-surface-elevated p-0.5">
      {options.map(({ mode, label, Icon }) => {
        const active = value === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            className={`inline-flex h-8 w-9 items-center justify-center rounded-md transition-colors ${
              active
                ? 'bg-[#0050D7]/15 text-[var(--color-cyan-400)]'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
