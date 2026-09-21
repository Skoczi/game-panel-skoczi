import type { GameServerRow } from '../types/gameServer.js';
import { getOvhcloudServerAdapter } from '../providers/ovhcloud/adapters/registry.js';
import { nativeTemplate } from '../templates/nativeContract.js';

export type InstallStepKey =
    | `native_step_${number}`
    | 'pulling_image'
    | 'preparing_files'
    | 'hytale_downloader_auth'
    | 'downloading_server_files'
    | 'extracting_server_files'
    | 'hytale_account_auth'
    | 'hytale_profile_selection'
    | 'configuring_hytale_auth'
    | 'creating_container'
    | 'starting_container';

export type InstallStatus = InstallStepKey | 'pending' | 'completed' | 'failed';

export type InstallStep = {
    key: InstallStepKey;
    optional: boolean;
    label?: string;
};

export const STANDARD_INSTALL_STEPS: InstallStep[] = [
    { key: 'pulling_image', optional: false },
    { key: 'preparing_files', optional: false },
    { key: 'creating_container', optional: false },
    { key: 'starting_container', optional: false },
];

export function getInstallStepsForServer(server: GameServerRow): InstallStep[] {
    const native = nativeTemplate(JSON.parse(server.provider_metadata_json || '{}'));
    if (native) return [
        { key: 'pulling_image', optional: false, label: 'Checking local runtime and installer images' },
        { key: 'preparing_files', optional: false },
        ...native.lifecycle!.install.map((step, i): InstallStep => ({ key: `native_step_${i}`, optional: false, label: step.name })),
        { key: 'creating_container', optional: false },
        { key: 'starting_container', optional: false },
    ];
    if (server.provider === 'ovhcloud') {
        return getOvhcloudServerAdapter(server).installSteps ?? STANDARD_INSTALL_STEPS;
    }

    return STANDARD_INSTALL_STEPS;
}
