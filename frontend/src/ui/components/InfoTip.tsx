import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';

export interface InfoTipProps {
  text: string;
  className?: string;
  label?: string;
}

export function InfoTip({ text, className = '', label = 'More information' }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const tip = tooltip.current?.getBoundingClientRect();
      if (!anchor || !tip) return;
      const left = Math.max(12, Math.min(anchor.left, window.innerWidth - tip.width - 12));
      const below = anchor.bottom + 8;
      const top = Math.max(12, Math.min(below + tip.height <= window.innerHeight - 12 ? below : anchor.top - tip.height - 8, window.innerHeight - tip.height - 12));
      setPosition({ left, top });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, text]);
  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => { if (document.activeElement !== trigger.current) setOpen(false); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={event => { if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); } }}
        onClick={event => { event.preventDefault(); setOpen(true); }}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-gray-400 dark:hover:text-gray-200"
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open && createPortal(
        <span ref={tooltip} id={id} role="tooltip" style={{ position: 'fixed', ...position }}
          className="pointer-events-none z-[10020] w-72 max-w-[calc(100vw-24px)] rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-normal normal-case leading-relaxed tracking-normal text-gray-100 shadow-xl">
          {text}
        </span>, document.body
      )}
    </span>
  );
}
