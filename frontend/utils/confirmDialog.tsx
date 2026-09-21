import { createRoot } from 'react-dom/client';
import { ConfirmationModal } from '../components/ConfirmationModal';
let open = false;
export function confirmDialog(
  message: string,
  title = 'Confirm action',
  confirmText = 'Continue'
): Promise<boolean> {
  if (open) return Promise.resolve(false);
  open = true;
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const previous = document.activeElement as HTMLElement | null;
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      open = false;
      // Unmount after the modal event handler completes.
      queueMicrotask(() => {
        root.unmount();
        host.remove();
        previous?.focus();
        resolve(value);
      });
    };
    root.render(
      <ConfirmationModal
        isOpen
        title={title}
        message={message}
        confirmText={confirmText}
        onClose={() => finish(false)}
        onConfirm={() => finish(true)}
      />
    );
  });
}
