import { useState } from 'react';
import { HelpCircle } from 'lucide-react';

export interface InfoTipProps {
  text: string;
  className?: string;
}

export function InfoTip({ text, className = '' }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        aria-label="More information"
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-gray-400 transition-colors hover:text-gray-300"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute top-full left-0 z-30 mt-2 w-72 max-w-[calc(100vw-3rem)] rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-gray-300 shadow-xl"
        >
          <span className="absolute -top-1.5 left-4 h-3 w-3 rotate-45 border-l border-t border-gray-700 bg-gray-900" />
          {text}
        </span>
      )}
    </span>
  );
}
