import { useEffect, useLayoutEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { AppButton, AppInput, AppModal, AppModalBody, AppModalContent, AppModalDescription, AppModalHeader, AppModalTitle } from '../src/ui/components';

interface ConfirmationModalProps {
  confirmButtonClass?: string;
  confirmText?: string;
  showCloseButton?: boolean;
  icon?: 'warning' | 'danger';
  isOpen: boolean;
  message: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  requiredText?: string;
}

export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText,
  confirmButtonClass,
  showCloseButton = true,
  icon = 'warning',
  requiredText,
}: ConfirmationModalProps) {
  const inputId = useId();
  const [inputValue, setInputValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (!isOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      // Let the modal library finish its focus cleanup before recovering a lost trigger.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (trigger?.isConnected && document.activeElement === document.body) trigger.focus();
      }));
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setInputValue('');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !requiredText) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen, requiredText]);

  const isConfirmAllowed = requiredText ? inputValue === requiredText : true;
  const matches = requiredText ? inputValue === requiredText : false;

  const handleConfirm = async () => {
    if (!isConfirmAllowed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err: any) {
      setError(
        err?.response?.data?.error || err?.message || 'Action failed. Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppModal open={isOpen} onOpenChange={(open) => !open && !submitting && onClose()}>
      <AppModalContent
        aria-label={title}
        aria-labelledby={`${inputId}-title`}
        dismissible={false}
        className="z-[61] w-[calc(100%-2rem)] max-w-md rounded-lg p-4 md:p-6"
      >
        <AppModalBody>
          <div className="flex items-start gap-3 md:gap-4">
            <div
              className={`rounded-full p-2 md:p-3 ${icon === 'danger' ? 'bg-red-500/10' : 'bg-yellow-500/10'}`}
            >
              <AlertTriangle
                className={`h-5 w-5 md:h-6 md:w-6 ${icon === 'danger' ? 'text-red-400' : 'text-yellow-400'}`}
              />
            </div>

            <div className="flex-1 min-w-0">
              <AppModalHeader className="mb-2">
                <AppModalTitle id={`${inputId}-title`} className="text-base md:text-lg">{title}</AppModalTitle>
              </AppModalHeader>
              <AppModalDescription className={`text-sm text-slate-300 ${requiredText ? 'mb-3' : 'mb-4 md:mb-6'}`}>
                {message}
              </AppModalDescription>

              {requiredText && (
                <div className="mb-4 md:mb-6">
                  <label htmlFor={inputId} className="mb-1.5 block text-xs text-gray-500 dark:text-gray-400">
                    Type <span className="font-semibold text-gray-900 dark:text-white">"{requiredText}"</span> to confirm
                  </label>
                  <AppInput
                    id={inputId}
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleConfirm();
                    }}
                    onPaste={(e) => e.preventDefault()}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={submitting}
                    className={matches ? 'w-full border-red-500' : 'w-full'}
                    placeholder={requiredText}
                  />
                </div>
              )}

              {error && (
                <div role="alert" className="mb-3 flex items-start gap-2 text-sm text-red-400">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <AppButton
                  tone={icon === 'danger' ? 'critical' : 'primary'}
                  onClick={handleConfirm}
                  disabled={!isConfirmAllowed || submitting}
                  title={!isConfirmAllowed ? `Type ${requiredText} to confirm` : undefined}
                  className={`min-w-0 ${confirmButtonClass || ''}`}
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {submitting ? 'Working…' : confirmText || 'Confirm'}
                </AppButton>
                <AppButton tone="neutral" onClick={onClose} disabled={submitting}>Cancel</AppButton>
              </div>
            </div>

            {showCloseButton ? (
              <AppButton
                tone="ghost"
                aria-label="Close confirmation"
                onClick={onClose}
                disabled={submitting}
                className="h-8 w-8 p-0 text-slate-400 hover:text-red-400"
              >
                <X className="h-5 w-5" />
              </AppButton>
            ) : null}
          </div>
        </AppModalBody>
      </AppModalContent>
    </AppModal>
  );
}
