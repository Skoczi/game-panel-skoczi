// Shared data-only contract; backend remains authoritative for validation and installation.
export type { GameTemplate } from '../../backend/src/templates/types';
import type { GameTemplate } from '../../backend/src/templates/types';
export type TemplateVersion = {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'disabled';
  hash: string;
  actor: string;
  created_at: string;
  document: GameTemplate;
};
export const emptyTemplate = (): GameTemplate => ({
  schemaVersion: 1,
  name: 'New game template',
  description: '',
  author: '',
  source: '',
  runtime: {
    provider: 'external',
    image: '',
    catalogId: '',
    gameServerName: '',
    architectures: ['x64'],
    identity: { user: '1000', uid: 1000, gid: 1000 },
  },
  ports: [],
  variables: [],
  mounts: [{ key: 'data', containerPath: '/data' }],
});
