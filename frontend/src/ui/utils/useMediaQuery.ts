import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [matches, setMatches] = useState(() => (supported ? window.matchMedia(query).matches : false));

  useEffect(() => {
    if (!supported) return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [supported, query]);

  return matches;
}
