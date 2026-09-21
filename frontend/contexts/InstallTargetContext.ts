import { createContext } from 'react';

// Installation forms can target a node without changing the fleet's runtime context.
export const InstallTargetContext = createContext<string | null>(null);
