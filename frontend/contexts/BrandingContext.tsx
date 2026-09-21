import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_APPEARANCE, type Appearance } from '../types/globalSettings';

const BrandingContext = createContext({ appearance: DEFAULT_APPEARANCE, loaded: false });
export const useBranding = () => useContext(BrandingContext);

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort(); controller = new AbortController();
      try {
        const response = await fetch('/api/branding', { cache: 'no-store', credentials: 'omit', signal: controller.signal });
        if (!response.ok) return;
        const value = await response.json() as Appearance;
        if (active) { setAppearance(value); setLoaded(true); }
      } catch { /* Keep the last good branding; a failed request must not block login. */ }
    };
    void refresh();
    window.addEventListener('panel-settings-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => { active = false; controller?.abort(); window.removeEventListener('panel-settings-changed', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => { document.title = appearance.siteName; }, [appearance.siteName]);
  useEffect(() => {
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) { icon = document.createElement('link'); icon.rel = 'icon'; document.head.append(icon); }
    icon.removeAttribute('type');
    icon.href = appearance.favicon || '/favicon.svg';
  }, [appearance.favicon]);
  return <BrandingContext.Provider value={{ appearance, loaded }}>{children}</BrandingContext.Provider>;
}
