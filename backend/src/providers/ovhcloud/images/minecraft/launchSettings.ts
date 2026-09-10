import type { GameServerRow } from '../../../../types/gameServer.js';
import { getOvhcloudMinecraftMetadata } from '../../../serverMetadata.js';
import { readCatalog, tryReadCatalog } from '../../settings/catalog.js';
import type {
    EnvMap,
    LaunchSettingsAccessor,
    SettingDefinition,
    SettingOption,
    SettingValue,
} from '../../settings/types.js';
import type { OvhcloudMinecraftServerType } from '../minecraft.js';

const MC_VERSION_ENV = 'MC_VERSION';
const PAPER_BUILD_ENV = 'PAPER_BUILD';
const PAPERMC_USER_AGENT_ENV = 'PAPERMC_USER_AGENT';
const PAPERMC_USER_AGENT_VALUE = 'gamepanel/1.0';
const FORGE_VERSION_ENV = 'FORGE_VERSION';
const FABRIC_LOADER_ENV = 'FABRIC_LOADER_VERSION';
const FABRIC_INSTALLER_ENV = 'FABRIC_INSTALLER_VERSION';
const NEOFORGE_VERSION_ENV = 'NEOFORGE_VERSION';
const BEDROCK_DOWNLOAD_URL_ENV = 'BEDROCK_DOWNLOAD_URL';

const VERSION_PATTERN = '^[A-Za-z0-9._+-]*$';
const VERSION_PATTERN_MESSAGE = 'A version may only contain letters, digits, dots, dashes, underscores and plus signs.';

type JavaVersionsPayload = { versions?: Array<{ version?: unknown; type?: unknown }> };
type VersionListPayload = { versions?: Array<{ version?: unknown }> };
type PaperBuildsPayload = { builds?: Array<{ build?: unknown; channel?: unknown }> };
type ForgeBuildsPayload = { builds?: Array<{ build?: unknown; channel?: unknown }> };
type FabricListPayload = {
    versions?: Array<{ version?: unknown; stable?: unknown }>;
    loaders?: Array<{ version?: unknown; stable?: unknown }>;
    installers?: Array<{ version?: unknown; stable?: unknown }>;
};
type NeoForgePayload = {
    versions?: Array<{ version?: unknown; minecraftVersion?: unknown; channel?: unknown }>;
};
type BedrockPayload = {
    versions?: Array<{ version?: unknown; channel?: unknown; downloadUrl?: unknown }>;
};

function asText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function concreteVersion(value: string | undefined): string | null {
    return (value ?? '').trim() || null;
}

function versionSelect(
    key: string,
    label: string,
    description: string,
    options: SettingOption[] | null,
    extra: Partial<SettingDefinition> = {}
): SettingDefinition {
    return {
        key,
        group: 'version',
        type: 'select',
        label,
        description,
        options: options ?? [],
        optionsUnavailable: options === null,
        freeform: true,
        default: '',
        pattern: VERSION_PATTERN,
        patternMessage: VERSION_PATTERN_MESSAGE,
        ...extra,
    };
}

function stability(
    channel: string | null,
    unstableWords: string[]
): { stable?: boolean; mention: string | null } {
    if (!channel) return { mention: null };

    const normalized = channel.toLowerCase();
    const unstable = unstableWords.includes(normalized);

    return { stable: !unstable, mention: unstable ? normalized : null };
}

function optionLabel(value: string, mention: string | null): string {
    return mention ? `${value} (${mention})` : value;
}

async function javaVersionOptions(): Promise<SettingOption[] | null> {
    const payload = await tryReadCatalog<JavaVersionsPayload>('/minecraft/java/versions');
    if (!payload) return null;

    return (payload.versions ?? []).flatMap((entry) => {
        const version = asText(entry.version);
        if (!version) return [];
        const { stable, mention } = stability(asText(entry.type), ['snapshot']);
        return [{ value: version, label: optionLabel(version, mention), stable }];
    });
}

async function versionListOptions(path: string): Promise<SettingOption[] | null> {
    const payload = await tryReadCatalog<VersionListPayload>(path);
    if (!payload) return null;

    return (payload.versions ?? []).flatMap((entry) => {
        const version = asText(entry.version);
        return version ? [{ value: version, label: version }] : [];
    });
}

async function fabricOptions(
    path: string,
    field: 'versions' | 'loaders' | 'installers'
): Promise<SettingOption[] | null> {
    const payload = await tryReadCatalog<FabricListPayload>(path);
    if (!payload) return null;

    return (payload[field] ?? []).flatMap((entry) => {
        const version = asText(entry.version);
        if (!version) return [];
        const stable = entry.stable === true;
        return [{ value: version, label: optionLabel(version, stable ? null : 'unstable'), stable }];
    });
}

async function paperBuildOptions(mcVersion: string | null): Promise<SettingOption[] | null> {
    if (!mcVersion) return [];

    const payload = await tryReadCatalog<PaperBuildsPayload>(
        `/minecraft/paper/versions/${encodeURIComponent(mcVersion)}/builds`
    );
    if (!payload) return null;

    return (payload.builds ?? []).flatMap((entry) => {
        const build = typeof entry.build === 'number' ? String(entry.build) : asText(entry.build);
        if (!build) return [];
        const { stable, mention } = stability(asText(entry.channel), ['experimental', 'alpha', 'beta']);
        return [{ value: build, label: optionLabel(build, mention), stable }];
    });
}

async function forgeBuildOptions(mcVersion: string | null): Promise<SettingOption[] | null> {
    if (!mcVersion) return [];

    const payload = await tryReadCatalog<ForgeBuildsPayload>(
        `/minecraft/forge/versions/${encodeURIComponent(mcVersion)}/builds`
    );
    if (!payload) return null;

    return (payload.builds ?? []).flatMap((entry) => {
        const build = asText(entry.build);
        if (!build) return [];
        return [{ value: build, label: optionLabel(build, asText(entry.channel)) }];
    });
}

async function neoforgeOptions(): Promise<SettingOption[] | null> {
    const payload = await tryReadCatalog<NeoForgePayload>('/minecraft/neoforge/versions');
    if (!payload) return null;

    return (payload.versions ?? []).flatMap((entry) => {
        const version = asText(entry.version);
        if (!version) return [];
        const { stable } = stability(asText(entry.channel), ['beta']);
        const minecraftVersion = asText(entry.minecraftVersion);
        return [{
            value: version,
            label: minecraftVersion ? `${version} (Minecraft ${minecraftVersion})` : version,
            stable,
        }];
    });
}

async function bedrockOptions(): Promise<SettingOption[] | null> {
    const payload = await tryReadCatalog<BedrockPayload>('/minecraft/bedrock/versions');
    if (!payload) return null;

    return (payload.versions ?? []).flatMap((entry) => {
        const version = asText(entry.version);
        if (!version) return [];
        const { stable, mention } = stability(asText(entry.channel), ['preview']);
        return [{ value: version, label: optionLabel(version, mention), stable }];
    });
}

async function buildDefinitions(
    serverType: OvhcloudMinecraftServerType,
    env: EnvMap
): Promise<SettingDefinition[]> {
    const mcVersion = concreteVersion(env.get(MC_VERSION_ENV));

    switch (serverType) {
        case 'vanilla':
            return [
                versionSelect(
                    'version',
                    'Minecraft version',
                    'Version of the Minecraft server downloaded on the next start.',
                    await javaVersionOptions()
                ),
            ];

        case 'paper': {
            const [versions, builds] = await Promise.all([
                versionListOptions('/minecraft/paper/versions'),
                paperBuildOptions(mcVersion),
            ]);

            return [
                versionSelect('version', 'Minecraft version', 'Minecraft version the Paper server is built for.', versions, {
                    refreshes: ['build'],
                }),
                versionSelect('build', 'Paper build', 'Paper build for the selected Minecraft version.', builds, {
                    dependsOn: 'version',
                }),
            ];
        }

        case 'forge': {
            const [versions, builds] = await Promise.all([
                versionListOptions('/minecraft/forge/versions'),
                forgeBuildOptions(mcVersion),
            ]);

            return [
                versionSelect('version', 'Minecraft version', 'Minecraft version the Forge server is built for.', versions, {
                    refreshes: ['build'],
                }),
                versionSelect('build', 'Forge version', 'Forge build for the selected Minecraft version.', builds, {
                    dependsOn: 'version',
                }),
            ];
        }

        case 'fabric': {
            const [versions, loaders, installers] = await Promise.all([
                fabricOptions('/minecraft/fabric/versions', 'versions'),
                fabricOptions('/minecraft/fabric/loaders', 'loaders'),
                fabricOptions('/minecraft/fabric/installers', 'installers'),
            ]);

            return [
                versionSelect('version', 'Minecraft version', 'Minecraft version the Fabric server runs.', versions),
                versionSelect('loader', 'Fabric loader', 'Fabric loader version installed on the server.', loaders),
                versionSelect('installer', 'Fabric installer', 'Fabric installer version used to build the server.', installers),
            ];
        }

        case 'neoforge':
            return [
                versionSelect(
                    'version',
                    'NeoForge version',
                    'NeoForge version installed on the server. The matching Minecraft version is applied automatically.',
                    await neoforgeOptions()
                ),
            ];

        case 'bedrock': {
            const versions = await bedrockOptions();

            return [{
                key: 'version',
                group: 'version',
                type: 'select',
                label: 'Bedrock version',
                description: 'Version of the Bedrock dedicated server downloaded on the next start.',
                options: versions ?? [],
                optionsUnavailable: versions === null,
                freeform: false,
                default: '',
            }];
        }
    }
}

function readValues(serverType: OvhcloudMinecraftServerType, env: EnvMap): Map<string, SettingValue> {
    const values = new Map<string, SettingValue>();
    const mcVersion = env.get(MC_VERSION_ENV) ?? '';

    switch (serverType) {
        case 'vanilla':
        case 'bedrock':
            values.set('version', mcVersion);
            break;

        case 'paper':
            values.set('version', mcVersion);
            values.set('build', env.get(PAPER_BUILD_ENV) ?? '');
            break;

        case 'forge':
            values.set('version', mcVersion);
            values.set('build', env.get(FORGE_VERSION_ENV) ?? '');
            break;

        case 'fabric':
            values.set('version', mcVersion);
            values.set('loader', env.get(FABRIC_LOADER_ENV) ?? '');
            values.set('installer', env.get(FABRIC_INSTALLER_ENV) ?? '');
            break;

        case 'neoforge':
            values.set('version', env.get(NEOFORGE_VERSION_ENV) ?? '');
            break;
    }

    return values;
}

async function applyNeoForgeVersion(env: EnvMap, version: string): Promise<void> {
    env.set(NEOFORGE_VERSION_ENV, version);

    const payload = await tryReadCatalog<NeoForgePayload>('/minecraft/neoforge/versions');
    const match = (payload?.versions ?? []).find((entry) => asText(entry.version) === version);
    const minecraftVersion = match ? asText(match.minecraftVersion) : null;

    if (minecraftVersion) env.set(MC_VERSION_ENV, minecraftVersion);
}

async function applyBedrockVersion(env: EnvMap, version: string): Promise<void> {
    const payload = await readCatalog<BedrockPayload>('/minecraft/bedrock/versions');
    const match = (payload.versions ?? []).find((entry) => asText(entry.version) === version);
    const downloadUrl = match ? asText(match.downloadUrl) : null;

    if (!downloadUrl) {
        throw Object.assign(
            new Error(`Unknown Bedrock version: ${version}`),
            { statusCode: 400 }
        );
    }

    env.set(MC_VERSION_ENV, version);
    env.set(BEDROCK_DOWNLOAD_URL_ENV, downloadUrl);
}

async function applyValues(
    serverType: OvhcloudMinecraftServerType,
    env: EnvMap,
    updates: Map<string, SettingValue>
): Promise<EnvMap> {
    for (const [key, rawValue] of updates) {
        const value = String(rawValue);

        if (key === 'version') {
            if (serverType === 'neoforge') {
                await applyNeoForgeVersion(env, value);
                continue;
            }
            if (serverType === 'bedrock') {
                await applyBedrockVersion(env, value);
                continue;
            }
            env.set(MC_VERSION_ENV, value);
            continue;
        }

        if (key === 'build') {
            if (serverType === 'paper') {
                env.set(PAPER_BUILD_ENV, value);
                if (!env.get(PAPERMC_USER_AGENT_ENV)) {
                    env.set(PAPERMC_USER_AGENT_ENV, PAPERMC_USER_AGENT_VALUE);
                }
            }
            if (serverType === 'forge') env.set(FORGE_VERSION_ENV, value);
            continue;
        }

        if (key === 'loader') env.set(FABRIC_LOADER_ENV, value);
        if (key === 'installer') env.set(FABRIC_INSTALLER_ENV, value);
    }

    return env;
}

const MINECRAFT_LAUNCH_SETTINGS: LaunchSettingsAccessor = {
    definitions(server: GameServerRow, env: EnvMap): Promise<SettingDefinition[]> {
        return buildDefinitions(getOvhcloudMinecraftMetadata(server).serverType, env);
    },

    read(server: GameServerRow, env: EnvMap): Map<string, SettingValue> {
        return readValues(getOvhcloudMinecraftMetadata(server).serverType, env);
    },

    apply(server: GameServerRow, env: EnvMap, updates: Map<string, SettingValue>): Promise<EnvMap> {
        return applyValues(getOvhcloudMinecraftMetadata(server).serverType, env, updates);
    },

    async resolveOptions(
        server: GameServerRow,
        key: string,
        params: Record<string, string>
    ): Promise<SettingOption[]> {
        const serverType = getOvhcloudMinecraftMetadata(server).serverType;
        if (key !== 'build') return [];

        const mcVersion = concreteVersion(params.version);
        const options = serverType === 'forge'
            ? await forgeBuildOptions(mcVersion)
            : await paperBuildOptions(mcVersion);

        return options ?? [];
    },
};

export function minecraftLaunchSettingsAccessor(): LaunchSettingsAccessor {
    return MINECRAFT_LAUNCH_SETTINGS;
}
