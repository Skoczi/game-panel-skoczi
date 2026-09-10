const SETTING_GROUPS = {
    version: { label: 'Version', order: 5 },
    branding: { label: 'Presentation', order: 20 },
    world: { label: 'World', order: 30 },
    gameplay: { label: 'Gameplay', order: 40 },
    players: { label: 'Players', order: 50 },
    security: { label: 'Security & access', order: 60 },
    performance: { label: 'Performance', order: 70 },
    network: { label: 'Network', order: 80 },
    updates: { label: 'Updates', order: 90 },
} as const satisfies Record<string, { label: string; order: number }>;

export type SettingGroupId = keyof typeof SETTING_GROUPS;

export type SettingGroup = {
    id: SettingGroupId;
    label: string;
    order: number;
};

export function collectSettingGroups(usedIds: Iterable<SettingGroupId>): SettingGroup[] {
    const unique = new Set(usedIds);

    return [...unique]
        .map((id) => ({ id, label: SETTING_GROUPS[id].label, order: SETTING_GROUPS[id].order }))
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
