import type { ReactNode } from 'react';

export function AppSectionHeader({ title, description, actions }: {
  title: string; description: ReactNode; actions?: ReactNode;
}) {
  return <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <h3 className="mb-2 text-2xl font-bold text-gray-900 dark:text-white">{title}</h3>
      <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </header>;
}
