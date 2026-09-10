import { parseCs2Params } from './cs2Params';

// RUST_START_PARAMS holds creation-time launch convars. The launcher word-splits on
// whitespace and does NOT honour quotes, so every value must be space-free and is
// written WITHOUT quotes. Unknown flags are preserved so custom args are never lost.

export const RUST_WORLDSIZE_MIN = 1000;
export const RUST_WORLDSIZE_MAX = 6000;
export const RUST_SEED_MIN = 0;
export const RUST_SEED_MAX = 2147483647;

// '' = default/survival mode → the flag is omitted entirely (empty is not a valid arg).
export const RUST_GAMEMODE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Default (survival)' },
  { value: 'softcore', label: 'Softcore' },
  { value: 'hardcore', label: 'Hardcore' },
];

const KNOWN_KEYS = ['server.worldsize', 'server.seed', 'server.gamemode'];

export interface RustLaunchParams {
  worldsize: string;
  seed: string;
  gamemode: string;
  extra: string;
}

export function parseRustParams(raw: string): RustLaunchParams {
  const map = parseCs2Params(raw || '');
  const extras = Object.entries(map)
    .filter(([key]) => !KNOWN_KEYS.includes(key))
    .map(([key, value]) => (value ? `+${key} ${value}` : `+${key}`));

  return {
    worldsize: map['server.worldsize'] ?? '',
    seed: map['server.seed'] ?? '',
    gamemode: map['server.gamemode'] ?? '',
    extra: extras.join(' '),
  };
}

export function serializeRustParams(params: RustLaunchParams): string {
  const parts: string[] = [];
  if (params.worldsize.trim()) parts.push(`+server.worldsize ${params.worldsize.trim()}`);
  if (params.seed.trim()) parts.push(`+server.seed ${params.seed.trim()}`);
  if (params.gamemode.trim()) parts.push(`+server.gamemode ${params.gamemode.trim()}`);
  const extra = params.extra.trim();
  if (extra) parts.push(extra);
  return parts.join(' ');
}
