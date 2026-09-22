import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { AppSelect, type AppSelectOption, type AppSelectProps } from './AppSelect';

type OptionProps = { children?: ReactNode; value?: string | number; disabled?: boolean };
type Props = Omit<AppSelectProps, 'options' | 'value' | 'defaultValue'> & {
  children: ReactNode;
  value?: string | number;
  defaultValue?: string | number;
};
function optionText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (isValidElement<OptionProps>(node)) return optionText(node.props.children);
  return Children.toArray(node).map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement<OptionProps>(child) ? optionText(child.props.children) : '').join('');
}
// Keep declarative options while rendering the panel's custom, keyboard-accessible menu.
export function AppOptionSelect({ children, value, defaultValue, className, controlLabel, ...props }: Props) {
  const options: AppSelectOption[] = [];
  const collect = (nodes: ReactNode) => Children.forEach(nodes, child => {
    if (!isValidElement<OptionProps>(child)) return;
    if (child.type === Fragment) { collect(child.props.children); return; }
    if (child.type !== 'option') return;
    const label = optionText(child.props.children);
    options.push({ label, value: String(child.props.value ?? label), disabled: child.props.disabled });
  });
  collect(children);
  return <AppSelect {...props} className={`gp-option-select ${className || ''}`}
    controlLabel={controlLabel || props['aria-label']} options={options}
    value={value === undefined ? undefined : String(value)}
    defaultValue={defaultValue === undefined ? undefined : String(defaultValue)} />;
}
