import { AppSelect } from '../src/ui/components';
import { useState } from 'react';

/** Reuse the Resources dropdown and its shared light/dark theme. */
export function FleetSelect({
  label,
  ariaLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="gp-fleet-select"
      onKeyDownCapture={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          const trigger =
            event.currentTarget.querySelector<HTMLButtonElement>('button[role="combobox"]');
          setOpen(false);
          requestAnimationFrame(() => trigger?.focus());
        }
        if (event.key === 'Tab' && open) {
          // The shared popup retains focus on close; explicitly continue toolbar tab order.
          event.preventDefault();
          event.stopPropagation();
          const trigger =
            event.currentTarget.querySelector<HTMLButtonElement>('button[role="combobox"]');
          const toolbar = event.currentTarget.closest('.gp-fleet-view-controls');
          const controls = Array.from(
            toolbar?.querySelectorAll<HTMLButtonElement>(
              'button[role="combobox"], button.gp-fleet-button'
            ) || []
          );
          const index = trigger ? controls.indexOf(trigger) : -1;
          const next =
            controls[index + (event.shiftKey ? -1 : 1)] ||
            toolbar?.parentElement?.querySelector<HTMLInputElement>('.gp-fleet-search input');
          setOpen(false);
          // Ark restores trigger focus on its next frame; continue after that restoration.
          requestAnimationFrame(() => requestAnimationFrame(() => next?.focus()));
        }
      }}
    >
      <span className="gp-fleet-select-label">{label}</span>
      <AppSelect
        open={open}
        onOpenChange={({ open }) => setOpen(open)}
        className="gp-resources-select gp-fleet-dropdown"
        controlLabel={ariaLabel}
        value={value || '__fleet_all__'}
        options={options.map((option) => ({ ...option, value: option.value || '__fleet_all__' }))}
        onChange={(next) => onChange(next === '__fleet_all__' ? '' : next)}
      />
    </div>
  );
}
