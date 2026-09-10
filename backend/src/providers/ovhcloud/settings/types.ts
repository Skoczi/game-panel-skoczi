import type { GameServerRow } from '../../../types/gameServer.js';
import type { SettingGroup, SettingGroupId } from './groups.js';

export type SettingType = 'boolean' | 'integer' | 'float' | 'string' | 'select';

export type SettingValue = string | number | boolean;

export type SettingOption = {
    value: string | number;
    label: string;
    stable?: boolean;
};

export type SettingDefinition = {
    key: string;
    group: SettingGroupId;
    type: SettingType;
    label: string;
    description: string;
    options?: SettingOption[];
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    default?: SettingValue;
    secret?: boolean;
    freeform?: boolean;
    nullable?: boolean;
    pattern?: string;
    patternMessage?: string;
    optionsUnavailable?: boolean;
    dependsOn?: string;
    refreshes?: string[];
};

export type Setting = SettingDefinition & {
    value: SettingValue;
};

export type SettingsWritePolicy = {
    writableWhileRunning: boolean;
    writeBlockedReason?: string;
};

export type ConfigFileFormat =
    | 'ini' | 'properties' | 'json' | 'yaml' | 'lua' | 'toml' | 'cfg' | 'txt' | 'unknown';

export type ConfigFileDescriptor = {
    path: string;
    root?: string;
    format: ConfigFileFormat;
    label: string;
};

export type ConfigFileEntry = Required<Pick<ConfigFileDescriptor, 'path' | 'root' | 'format' | 'label'>> & {
    exists: boolean;
};

export type SettingsPayload = {
    groups: SettingGroup[];
    fileSettings: Setting[];
    fileSettingsPolicy: SettingsWritePolicy;
    launchSettings: Setting[];
    configFiles: ConfigFileEntry[];
};

export type FileSettingsPatchResult = {
    updated: string[];
    settings: Setting[];
};

export type LaunchSettingsPatchResult = {
    updated: string[];
    recreated: boolean;
    restarted: boolean;
    settings: Setting[];
};

export type EnvMap = Map<string, string>;

export type FileSettingsAccessor<TSnapshot = unknown> = {
    definitions(server: GameServerRow): SettingDefinition[];
    load(server: GameServerRow): Promise<TSnapshot>;
    read(snapshot: TSnapshot, definition: SettingDefinition): SettingValue | null;
    write(snapshot: TSnapshot, definition: SettingDefinition, value: SettingValue): boolean;
    save(server: GameServerRow, snapshot: TSnapshot): Promise<void>;
    onMissing: 'omit' | 'default';
    policy?(server: GameServerRow): Promise<SettingsWritePolicy> | SettingsWritePolicy;
};

export type LaunchSettingsAccessor = {
    definitions(server: GameServerRow, env: EnvMap): Promise<SettingDefinition[]> | SettingDefinition[];
    read(server: GameServerRow, env: EnvMap): Map<string, SettingValue>;
    apply(
        server: GameServerRow,
        env: EnvMap,
        updates: Map<string, SettingValue>
    ): Promise<EnvMap> | EnvMap;
    resolveOptions?(
        server: GameServerRow,
        key: string,
        params: Record<string, string>
    ): Promise<SettingOption[]>;
};

export type OvhcloudFileSettingsSupport = {
    permissions: {
        read: string;
        write: string;
    };
    accessor(): FileSettingsAccessor<any>;
};

export type OvhcloudSettingsSupport = {
    label: string;
    file?: OvhcloudFileSettingsSupport;
    launch?(): LaunchSettingsAccessor;
    configFiles?(server: GameServerRow): Promise<ConfigFileDescriptor[]> | ConfigFileDescriptor[];
};
