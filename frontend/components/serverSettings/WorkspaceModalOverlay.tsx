import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Portal avoids the workspace's stacking contexts; only the dialog's horizontal
// position follows the main pane. The backdrop still blocks the entire page.
export function WorkspaceModalOverlay({ children }: { children: ReactNode }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [bounds, setBounds] = useState<{ left: number; width: number }>();
  useLayoutEffect(() => {
    const main = anchor.current?.closest('.gp-server-workspace-main');
    const workspace = main?.parentElement;
    const update = () => {
      if (main && workspace?.classList.contains('has-console-dock') && window.innerWidth > 1000) {
        const rect = main.getBoundingClientRect();
        const left = Math.max(0, rect.left);
        setBounds({ left, width: Math.max(0, Math.min(innerWidth, rect.right) - left) });
      } else setBounds(undefined);
    };
    update();
    const observer = new ResizeObserver(update);
    if (main) observer.observe(main);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);
  return <>
    <span ref={anchor} hidden />
    {createPortal(
      <div className="fixed inset-0 z-[200] bg-black/50">
        <div className="absolute inset-y-0 flex items-center justify-center overflow-y-auto p-4" style={bounds ?? { left: 0, width: '100%' }}>
          {children}
        </div>
      </div>, document.body)}
  </>;
}
