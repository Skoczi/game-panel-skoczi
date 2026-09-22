import type { ReactNode } from 'react';

export function AppSectionHeader({ title, description, actions, className = '' }: {
  title: string; description?: ReactNode; actions?: ReactNode; className?: string;
}) {
  return <header className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}>
    <div className="min-w-0">
      <h3 className="gp-section-title">{title}</h3>
      {description && <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </header>;
}
