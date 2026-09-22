import type { GameServerRow } from '../types/gameServer.js';
import { nativeTemplate, nativeContainerOptions } from '../templates/nativeContract.js';
import { cs16GameConfig } from '../templates/gameConfig.js';
import { parseStoredEnv, parseStoredPorts } from '../providers/runtimeConfig.js';

export function nativeGameConfig(server: GameServerRow) {
    const metadata = JSON.parse(server.provider_metadata_json || '{}');
    const template = nativeTemplate(metadata);
    if (!template || template.gameConfig === false) return null;
    const file = template.configFiles?.find(f => /\/cstrike\/server\.cfg$/i.test(f.path));
    const legacy = !template.gameConfig;
    const profile = template.gameConfig || (file && /ReHLDS|Counter.Strike\s*1\.6/i.test(template.name) ? cs16GameConfig(file.path, file.root) : null);
    if (!profile) return null;
    const config = structuredClone(profile);
    // The bundled CS preset and old snapshots both select the active filename through CFG.
    if (legacy || /\/cstrike\/server\.cfg$/i.test(config.path)) {
        const args = nativeContainerOptions(template, parseStoredEnv(server), parseStoredPorts(server), metadata.startupCommand, metadata.customParams).command;
        const option = args.lastIndexOf('+servercfgfile');
        const cfg = option >= 0 ? args[option + 1] : 'server.cfg';
        if (!cfg || !/^[A-Za-z0-9_-]+\.cfg$/.test(cfg)) throw Object.assign(new Error('The active CFG filename is invalid. Check server Settings.'), { statusCode: 409 });
        config.path = config.path.replace(/[^/]+$/, cfg);
    }
    return config;
}
