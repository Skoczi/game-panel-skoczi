// Inventory presentation only. Runtime provider and signed snapshots stay unchanged.
export function fleetDisplayIdentity(provider: string, catalogId: string | null | undefined, metadata: unknown) {
    try {
        const value = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
        const document = value?.template?.document;
        if (document?.schemaVersion === 2 && typeof document.name === 'string' && document.name.length <= 80)
            return { provider: 'native', catalogId: document.name };
    } catch { /* Old provider metadata need not be JSON. */ }
    return { provider, catalogId };
}
