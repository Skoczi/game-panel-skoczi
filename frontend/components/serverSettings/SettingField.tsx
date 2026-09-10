import { useMemo, useState } from 'react';
import { AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { AppCombobox, AppInput, AppSelect, AppSlider, AppToggle, InfoTip } from '../../src/ui/components';
import {
  hasUnstableOptions,
  stableOptions,
  validateSetting,
  type EditValue,
  type Setting,
} from '../../utils/serverSettings';

interface SettingFieldProps {
  setting: Setting;
  value: EditValue;
  onChange: (key: string, value: EditValue) => void;
  disabled?: boolean;
  borderColor: string;
  textPrimary: string;
  textSecondary: string;
}

const inputCls =
  'prevent-autofill gp-game-config-input w-full px-3 py-2 bg-gp-surface-elevated border border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-[var(--color-cyan-400)]/40 focus:border-[var(--color-cyan-400)]';

const numberBoxCls =
  'w-16 mx-auto block text-center text-xs font-semibold rounded px-1 py-0.5 bg-gp-surface-elevated border border-gray-600 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[var(--color-cyan-400)]/40 focus:border-[var(--color-cyan-400)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

export function SettingField({
  setting,
  value,
  onChange,
  disabled,
  borderColor,
  textPrimary,
  textSecondary,
}: SettingFieldProps) {
  const [reveal, setReveal] = useState(false);
  const [showUnstable, setShowUnstable] = useState(false);
  const unstableAvailable = hasUnstableOptions(setting.options ?? []);
  // Stable identity: the combobox refilters its list on every change of this array.
  const options = useMemo(() => {
    const all = setting.options ?? [];
    const keep = typeof value === 'string' ? value : '';
    const visible = showUnstable ? all : stableOptions(all, keep);
    return visible.map((o) => ({ label: o.label, value: String(o.value) }));
  }, [setting.options, showUnstable, value]);
  const error = validateSetting(setting, value);
  const set = (v: EditValue) => onChange(setting.key, v);

  const strValue = typeof value === 'boolean' ? '' : value;
  const asFreeText = setting.type === 'select' && (setting.freeform || setting.optionsUnavailable);
  const placeholder =
    setting.nullable && setting.default != null && setting.default !== '' ? String(setting.default) : undefined;
  // A strict select renders blank for a value the option list does not carry, which happens
  // when a stored value predates the list it is validated against. Say so rather than
  // leaving the field silently empty; the backend rejects it on save anyway.
  const unknownValue =
    setting.type === 'select' && !asFreeText && strValue !== ''
      ? !(setting.options ?? []).some((o) => String(o.value) === strValue)
      : false;

  let control: React.ReactNode;

  if (setting.type === 'boolean') {
    control = (
      <div className="flex items-center justify-end">
        <AppToggle
          ariaLabel={setting.label}
          checked={value === true}
          onChange={(checked) => set(checked)}
          disabled={disabled}
          className="shrink-0"
        />
      </div>
    );
  } else if (setting.type === 'select' && !asFreeText) {
    control = (
      <AppSelect
        value={strValue}
        onChange={(v) => set(v)}
        options={options}
        placeholder={placeholder}
        className="w-full gp-game-config-select"
        disabled={disabled}
      />
    );
  } else if (asFreeText && options.length > 0) {
    control = (
      <AppCombobox
        value={strValue}
        onChange={(v) => set(v)}
        options={options}
        placeholder={placeholder}
        invalid={Boolean(error)}
        disabled={disabled}
        className="w-full gp-game-config-combobox"
      />
    );
  } else if ((setting.type === 'integer' || setting.type === 'float') && setting.min != null && setting.max != null) {
    control = (
      <div className="space-y-1.5">
        <AppSlider
          min={setting.min}
          max={setting.max}
          step={setting.type === 'float' ? 'any' : 1}
          value={strValue}
          onChange={(e) => set(e.target.value)}
          aria-label={setting.label}
          disabled={disabled}
        />
        <div className={`grid grid-cols-3 items-center text-[11px] ${textSecondary}`}>
          <span className="text-left">{setting.min}</span>
          <input
            type="number"
            min={setting.min}
            max={setting.max}
            step={setting.type === 'float' ? 'any' : 1}
            value={strValue}
            onChange={(e) => set(e.target.value)}
            disabled={disabled}
            className={numberBoxCls}
          />
          <span className="text-right">{setting.max}</span>
        </div>
      </div>
    );
  } else if (setting.type === 'integer' || setting.type === 'float') {
    control = (
      <AppInput
        type="number"
        min={setting.min}
        max={setting.max}
        step={setting.type === 'float' ? 'any' : 1}
        value={strValue}
        onChange={(e) => set(e.target.value)}
        disabled={disabled}
        className={inputCls}
      />
    );
  } else if (setting.secret) {
    control = (
      <div className="flex items-center gap-2">
        <AppInput
          type={reveal ? 'text' : 'password'}
          value={strValue}
          placeholder={placeholder}
          onChange={(e) => set(e.target.value)}
          disabled={disabled}
          // Without this Chrome reads the screen as a sign-in form and autofills a saved
          // username into the first text field above (a game setting, not a login).
          autoComplete="new-password"
          className={`${inputCls} flex-1`}
        />
        <button
          type="button"
          onClick={() => setReveal((r) => !r)}
          className="shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label={reveal ? 'Hide' : 'Show'}
        >
          {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  } else {
    control = (
      <AppInput
        type="text"
        value={strValue}
        placeholder={placeholder}
        maxLength={setting.maxLength}
        onChange={(e) => set(e.target.value)}
        disabled={disabled}
        className={inputCls}
      />
    );
  }

  const notices = (
    <>
      {unstableAvailable && (
        <label className={`flex items-center gap-2 text-xs cursor-pointer select-none ${textSecondary}`}>
          <input
            type="checkbox"
            checked={showUnstable}
            onChange={(e) => setShowUnstable(e.target.checked)}
            disabled={disabled}
            className="rounded border-gray-400 dark:border-gray-600 accent-[var(--gp-ods-accent-primary)]"
          />
          Show unstable versions
        </label>
      )}
      {unknownValue && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          The saved value “{strValue}” is not one of the available options — pick one from the list.
        </p>
      )}
      {setting.optionsUnavailable && (
        <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          The option list could not be loaded — you can still type a value.
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </>
  );

  return (
    <div className={`rounded-lg border ${borderColor} bg-gp-surface-base/45 p-3 sm:p-4 flex flex-col justify-center ${disabled ? 'opacity-60' : ''}`}>
      <div
        className={`grid grid-cols-1 items-center gap-3 sm:gap-4 w-full ${
          setting.type === 'boolean'
            ? 'sm:grid-cols-[1fr_auto]'
            : 'sm:grid-cols-[minmax(185px,1.15fr)_minmax(0,1.1fr)]'
        }`}
      >
        <div>
          <span className={`flex items-center gap-1.5 text-sm font-semibold leading-tight sm:pr-2 ${textPrimary}`}>
            <span className="break-words">{setting.label}</span>
            {setting.description && <InfoTip text={setting.description} />}
          </span>
        </div>
        <div>{control}</div>
      </div>
      <div className="empty:hidden mt-2 space-y-1.5">{notices}</div>
    </div>
  );
}
