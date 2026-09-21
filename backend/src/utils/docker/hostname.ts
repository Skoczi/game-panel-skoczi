import { createHash } from 'node:crypto';
// Docker names and kernel hostnames have different limits. Keep the Docker identity intact.
export function containerHostname(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'game-server';
    if (slug.length <= 63) return slug;
    return `${slug.slice(0, 46).replace(/-+$/, '')}-${createHash('sha256').update(name).digest('hex').slice(0, 16)}`;
}
