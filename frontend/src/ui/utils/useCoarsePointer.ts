import { useEffect, useState } from 'react';

export function useCoarsePointer(): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [coarse, setCoarse] = useState(() =>
    supported ? window.matchMedia('(pointer: coarse)').matches : false
  );

  useEffect(() => {
    if (!supported) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = () => setCoarse(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [supported]);

  return coarse;
}
