import { useCallback, useMemo } from 'react';
import { Combobox, ComboboxContent, ComboboxControl } from '@ovhcloud/ods-react';
import { cn } from '../utils/cn';

export interface AppComboboxOption {
  label: string;
  value: string;
}

export interface AppComboboxProps {
  className?: string;
  createPortal?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  newElementLabel?: string;
  noResultLabel?: string;
  onChange: (value: string) => void;
  options: AppComboboxOption[];
  placeholder?: string;
  value: string;
}

export function AppCombobox({
  className,
  createPortal = false,
  disabled,
  invalid,
  newElementLabel = 'Use ',
  noResultLabel = 'No match',
  onChange,
  options,
  placeholder,
  value,
}: AppComboboxProps) {
  // A value the option list does not carry still has to show up in the field — ODS blanks
  // the input for a value it cannot find — so it joins the list as its own item.
  const items = useMemo(() => {
    const list = options.map((o) => ({ label: o.label, value: o.value }));
    return value && !list.some((o) => o.value === value) ? [{ label: value, value }, ...list] : list;
  }, [options, value]);

  const selectedLabel = useMemo(
    () => items.find((o) => o.value === value)?.label.trim() ?? '',
    [items, value]
  );

  // ODS rewrites the input text whenever this array changes; a fresh one on every render
  // would wipe what is being typed. The resolved label is a dependency because a field can
  // keep its value while its option list is replaced, leaving the text stale.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const selected = useMemo(() => (value ? [value] : []), [value, selectedLabel]);

  // Reopening the field leaves the selected label in the input, and ODS filters on it —
  // which would narrow the list down to the single selected row. Show the whole list until
  // the user actually edits the text.
  const filter = useCallback(
    (label: string, query: string) =>
      query === selectedLabel || label.toLowerCase().includes(query.toLowerCase()),
    [selectedLabel]
  );

  return (
    <Combobox
      allowCustomValue
      className={cn('gp-app-combobox', className)}
      customFilter={filter}
      disabled={disabled}
      invalid={invalid}
      items={items}
      newElementLabel={newElementLabel}
      noResultLabel={noResultLabel}
      onValueChange={({ value: next }) => onChange(next[0] ?? '')}
      value={selected}
    >
      <ComboboxControl className="gp-app-combobox-control" placeholder={placeholder} />
      <ComboboxContent createPortal={createPortal} />
    </Combobox>
  );
}
