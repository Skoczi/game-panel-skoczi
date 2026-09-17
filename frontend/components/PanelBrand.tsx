import { useState } from 'react';
import type { Appearance } from '../types/globalSettings';

export function PanelBrand({ appearance, login = false }: { appearance: Appearance; login?: boolean }) {
  const [failedLogo, setFailedLogo] = useState('');
  const Wrapper = login ? 'div' : 'span';
  return <Wrapper className="flex min-w-0 flex-col items-center gap-2 text-center" style={{ color: '#fff' }}>
    {appearance.logo && failedLogo !== appearance.logo && <img src={appearance.logo} alt={`${appearance.siteName} logo`} referrerPolicy="no-referrer" className={login ? 'max-h-24 max-w-full object-contain' : 'max-h-14 max-w-full object-contain'} onError={() => setFailedLogo(appearance.logo)} />}
    {login ? <h1 className="max-w-full break-words text-2xl font-semibold" style={{ color: '#fff' }}>{appearance.siteName}</h1>
      : <span className="max-w-full break-words font-semibold" style={{ color: '#fff' }}>{appearance.siteName}</span>}
    {appearance.siteSubtitle && <span className={login ? 'max-w-full break-words text-base' : 'max-w-full break-words text-xs'} style={{ color: '#fff' }}>{appearance.siteSubtitle}</span>}
  </Wrapper>;
}
