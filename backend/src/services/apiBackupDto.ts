export function backupDtos(value: unknown) {
    const entries = (value as { entries?: unknown } | null)?.entries;
    if (!Array.isArray(entries) || entries.length > 2000) throw new Error('Invalid or oversized backup inventory');
    return entries.map((entry: any) => {
        if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name.length > 255 ||
            /[/\\\x00-\x1f]/.test(entry.name) || !['file', 'directory'].includes(entry.type))
            throw new Error('Invalid backup entry');
        return { name: entry.name, kind: entry.type as 'file' | 'directory',
            sizeBytes: entry.type === 'file' && typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size >= 0 ? entry.size : null,
            modifiedAt: typeof entry.modifiedAt === 'string' && Number.isFinite(Date.parse(entry.modifiedAt)) ? new Date(entry.modifiedAt).toISOString() : null };
    }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
