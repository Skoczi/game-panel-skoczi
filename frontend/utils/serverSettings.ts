export type SettingType = 'boolean' | 'integer' | 'float' | 'string' | 'select';

export interface SettingOption {
  value: string | number;
  label: string;
  // Normalised stability flag. Absent means the list has no notion of stability (Paper and
  // Forge Minecraft versions, Forge builds) — such options are never filtered out.
  stable?: boolean;
}

export interface Setting {
  key: string;
  group: string;
  type: SettingType;
  label: string;
  description?: string;
  value: string | number | boolean;
  options?: SettingOption[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  default?: string | number | boolean;
  secret?: boolean;
  freeform?: boolean;
  nullable?: boolean;
  pattern?: string;
  patternMessage?: string;
  optionsUnavailable?: boolean;
  dependsOn?: string;
  refreshes?: string[];
}

export interface SettingGroup {
  id: string;
  label: string;
  order: number;
}

export interface FileSettingsPolicy {
  writableWhileRunning: boolean;
  writeBlockedReason?: string;
}

export interface ConfigFileRef {
  path: string;
  root: string;
  format: string;
  label: string;
  exists: boolean;
}

export interface SettingsScreen {
  groups: SettingGroup[];
  fileSettings: Setting[];
  fileSettingsPolicy?: FileSettingsPolicy;
  launchSettings: Setting[];
  configFiles: ConfigFileRef[];
}

export interface PatchSettingsResponse {
  updated: string[];
  settings: Setting[];
  recreated?: boolean;
  restarted?: boolean;
}

export interface SettingOptionsResponse {
  key: string;
  options: SettingOption[];
}

export type EditValue = string | boolean;

export function initialEditValue(s: Setting): EditValue {
  if (s.type === 'boolean') return Boolean(s.value);
  return s.value === null || s.value === undefined ? '' : String(s.value);
}

export function validateSetting(s: Setting, value: EditValue): string | null {
  if (typeof value === 'boolean') return null;
  if (value === '') return null; // empty is allowed (nullable clears; others 400 server-side)
  if (s.type === 'integer' || s.type === 'float') {
    const n = Number(value);
    if (Number.isNaN(n)) return 'Enter a valid number.';
    if (s.type === 'integer' && !Number.isInteger(n)) return 'Enter a whole number.';
    if (s.min != null && n < s.min) return `Minimum is ${s.min}.`;
    if (s.max != null && n > s.max) return `Maximum is ${s.max}.`;
    return null;
  }
  if (s.minLength != null && value.length < s.minLength) return `At least ${s.minLength} characters.`;
  if (s.maxLength != null && value.length > s.maxLength) return `At most ${s.maxLength} characters.`;
  if (s.pattern) {
    try {
      if (!new RegExp(s.pattern).test(value)) return s.patternMessage ?? 'Invalid value.';
    } catch {
      /* ignore an unparseable pattern — the backend stays the authority */
    }
  }
  return null;
}

// Convert an edit-buffer value to the type the backend expects (§4: send the same type back).
export function serializeSettingValue(s: Setting, value: EditValue): string | number | boolean | null {
  if (s.type === 'boolean') return Boolean(value);
  const str = String(value);
  if (s.nullable && str === '') return null;
  if (s.type === 'integer' || s.type === 'float') {
    const n = Number(str);
    return str !== '' && !Number.isNaN(n) ? n : str;
  }
  if (s.type === 'select') {
    const opt = s.options?.find((o) => String(o.value) === str);
    return opt ? opt.value : str;
  }
  return str;
}

export function hasUnstableOptions(options: SettingOption[]): boolean {
  return options.some((o) => o.stable === false);
}

// The stable track only. Filter on the flag, never on the label text — the wording can be
// reworded upstream, the boolean cannot. The current value is always kept so hiding the
// unstable track can never drop the value the server actually runs.
export function stableOptions<T extends SettingOption>(options: T[], keep: string): T[] {
  return options.filter((o) => o.stable !== false || String(o.value) === keep);
}

export function groupSettings(
  settings: Setting[],
  groups: SettingGroup[]
): { group: SettingGroup; settings: Setting[] }[] {
  const order = new Map(groups.map((g) => [g.id, g]));
  const byId = new Map<string, Setting[]>();
  for (const s of settings) {
    const list = byId.get(s.group);
    if (list) list.push(s);
    else byId.set(s.group, [s]);
  }
  return [...byId.entries()]
    .map(([id, list]) => ({
      group: order.get(id) ?? { id, label: id, order: 999 },
      settings: list,
    }))
    .sort((a, b) => a.group.order - b.group.order);
}
