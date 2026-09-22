// Shared, data-only catalog. Artwork is bundled with the frontend.
export const GAME_ICONS = [
    { id: 'counter-strike', label: 'Counter-Strike 1.6' },
    { id: 'counter-strike-source', label: 'Counter-Strike: Source' },
    { id: 'counter-strike-go', label: 'Counter-Strike: Global Offensive' },
    { id: 'counter-strike-2', label: 'Counter-Strike 2' },
    { id: 'team-fortress-2', label: 'Team Fortress 2' },
    { id: 'garrys-mod', label: "Garry's Mod" },
] as const;
export const MAX_GAME_ICON_BYTES = 16 * 1024;
