import { CATALOG_BASE_URL } from './api/runtime';

export type McServerType = 'vanilla' | 'paper' | 'fabric' | 'neoforge' | 'forge' | 'bedrock';

// javaVersion is Mojang's required JRE major for that Minecraft version. It can be
// null when upstream doesn't publish it (old releases, exotic snapshots) — resolve
// those with resolveRequiredJava's nearest-neighbour fallback.
export interface JavaVersion {
  version: string;
  type: 'release' | 'snapshot';
  javaVersion: number | null;
}

export interface McVersionInfo {
  version: string;
  javaVersion: number | null;
}

export interface PaperBuild {
  build: number;
  channel: string;
}

export interface ForgeBuild {
  // Forge build is a string (e.g. "47.4.10"); some pre-1.17 builds carry a branch
  // suffix ("10.13.4.1614-1.7.10") and must be sent verbatim — never parsed/reformatted.
  build: string;
  channel: string;
}

export interface FabricVersion {
  version: string;
  stable: boolean;
  javaVersion: number | null;
}

export interface NeoForgeVersion {
  version: string;
  minecraftVersion: string;
  channel: string;
  javaVersion: number | null;
}

export interface BedrockVersion {
  channel: 'release' | 'preview';
  version: string;
  downloadUrl: string;
}

export function getMcServerType(imageId: string): McServerType | null {
  if (imageId.includes('paper')) return 'paper';
  if (imageId.includes('fabric')) return 'fabric';
  if (imageId.includes('neoforge')) return 'neoforge';   // must stay ABOVE 'forge'
  if (imageId.includes('forge')) return 'forge';
  if (imageId.includes('bedrock')) return 'bedrock';
  if (imageId.includes('java-edition')) return 'vanilla';
  return null;
}

export function getPickerManagedKeys(serverType: McServerType): string[] {
  switch (serverType) {
    case 'vanilla': return ['MC_VERSION'];
    case 'paper': return ['MC_VERSION', 'PAPER_BUILD', 'PAPERMC_USER_AGENT'];
    case 'fabric': return ['MC_VERSION', 'FABRIC_LOADER_VERSION', 'FABRIC_INSTALLER_VERSION'];
    case 'neoforge': return ['NEOFORGE_VERSION', 'MC_VERSION'];
    case 'forge': return ['MC_VERSION', 'FORGE_VERSION'];
    case 'bedrock': return ['MC_VERSION', 'BEDROCK_DOWNLOAD_URL'];
  }
}

async function catalogGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${CATALOG_BASE_URL}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchJavaVersions(): Promise<JavaVersion[] | null> {
  const data = await catalogGet<{ versions: JavaVersion[] }>('/minecraft/java/versions');
  return data?.versions ?? null;
}

export async function fetchPaperVersions(): Promise<McVersionInfo[] | null> {
  const data = await catalogGet<{ versions: McVersionInfo[] }>('/minecraft/paper/versions');
  return data?.versions.map((v) => ({ version: v.version, javaVersion: v.javaVersion ?? null })) ?? null;
}

export async function fetchPaperBuilds(mcVersion: string): Promise<PaperBuild[] | null> {
  const data = await catalogGet<{ builds: PaperBuild[] }>(
    `/minecraft/paper/versions/${encodeURIComponent(mcVersion)}/builds`
  );
  return data?.builds ?? null;
}

export async function fetchForgeVersions(): Promise<McVersionInfo[] | null> {
  const data = await catalogGet<{ versions: McVersionInfo[] }>('/minecraft/forge/versions');
  return data?.versions.map((v) => ({ version: v.version, javaVersion: v.javaVersion ?? null })) ?? null;
}

export async function fetchForgeBuilds(mcVersion: string): Promise<ForgeBuild[] | null> {
  const data = await catalogGet<{ builds: ForgeBuild[] }>(
    `/minecraft/forge/versions/${encodeURIComponent(mcVersion)}/builds`
  );
  return data?.builds ?? null;
}

export async function fetchFabricVersions(): Promise<FabricVersion[] | null> {
  const data = await catalogGet<{ versions: FabricVersion[] }>('/minecraft/fabric/versions');
  return data?.versions ?? null;
}

export async function fetchFabricLoaders(): Promise<FabricVersion[] | null> {
  const data = await catalogGet<{ loaders: FabricVersion[] }>('/minecraft/fabric/loaders');
  return data?.loaders ?? null;
}

export async function fetchFabricInstallers(): Promise<FabricVersion[] | null> {
  const data = await catalogGet<{ installers: FabricVersion[] }>('/minecraft/fabric/installers');
  return data?.installers ?? null;
}

export async function fetchNeoForgeVersions(): Promise<NeoForgeVersion[] | null> {
  const data = await catalogGet<{ versions: NeoForgeVersion[] }>('/minecraft/neoforge/versions');
  return data?.versions ?? null;
}

export async function fetchBedrockVersions(): Promise<BedrockVersion[] | null> {
  const data = await catalogGet<{ versions: BedrockVersion[] }>('/minecraft/bedrock/versions');
  return data?.versions ?? null;
}

export function resolveJavaImageMajor(required: number, availableMajors: number[]): number {
  const sorted = [...availableMajors].sort((a, b) => a - b);
  return sorted.find((m) => m >= required) ?? sorted[sorted.length - 1];
}

// Required Java major for the selected Minecraft version, falling back to the nearest
// neighbour when its own javaVersion is null. Lists are newest-first, so look up
// (newer) first, then down (older) — adjacent versions share the requirement. Returns
// null only when the whole list has no javaVersion (degraded catalog / hand-typed).
export function resolveRequiredJava(
  ordered: { version: string; javaVersion: number | null }[],
  selectedVersion: string,
): number | null {
  const idx = ordered.findIndex((v) => v.version === selectedVersion);
  if (idx === -1) return null;
  if (ordered[idx].javaVersion != null) return ordered[idx].javaVersion;
  for (let i = idx - 1; i >= 0; i--) if (ordered[i].javaVersion != null) return ordered[i].javaVersion;
  for (let i = idx + 1; i < ordered.length; i++) if (ordered[i].javaVersion != null) return ordered[i].javaVersion;
  return null;
}
