export type AddonKind = 'mods' | 'plugins';

export interface AddonContext {
  kind: AddonKind;
  loader: 'paper' | 'fabric' | 'neoforge' | 'forge';
  projectType: 'mod' | 'plugin';
  directory: string;
  minecraftVersion: string | null;
  minecraftVersionSource: 'metadata' | 'neoforge' | 'unknown';
  versionFilterAvailable: boolean;
  loaderVersion: string | null;
  sorts: string[];
  categories: string[];
  catalogAvailable: boolean;
}

export interface AddonSearchHit {
  projectId: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  projectTypes: string[];
  serverSide: string;
  clientSide: string;
  dateModified: string;
  color: number | null;
  compatible: boolean;
  installed: boolean;
  installedVersionId: string | null;
}

export interface AddonSearchResponse {
  context: AddonContext;
  sort: string;
  offset: number;
  limit: number;
  total: number;
  versionFiltered: boolean;
  librariesExcluded: boolean;
  hits: AddonSearchHit[];
}

export interface InstalledAddon {
  fileName: string;
  fileSize: number;
  fileSha1: string;
  modifiedAt: string;
  enabled: boolean;
  source: 'panel' | 'detected' | 'unknown';
  projectId: string | null;
  slug: string | null;
  title: string | null;
  iconUrl: string | null;
  versionId: string | null;
  versionNumber: string | null;
  gameVersions: string[];
  installedAt: string | null;
  compatible: boolean | null;
  updateAvailable: boolean;
  latestVersionId: string | null;
  latestVersionNumber: string | null;
}

export interface InstalledResponse {
  context: AddonContext;
  catalogAvailable: boolean;
  updateCheckAvailable: boolean;
  addons: InstalledAddon[];
}

export interface AddonLink {
  source: string | null;
  issues: string | null;
  wiki: string | null;
  discord: string | null;
}

export interface AddonGalleryImage {
  url: string;
  title: string | null;
  description: string | null;
  featured: boolean;
}

export interface AddonProjectVersion {
  versionId: string;
  name: string;
  versionNumber: string;
  versionType: 'release' | 'beta' | 'alpha';
  datePublished: string;
  downloads: number;
  gameVersions: string[];
  loaders: string[];
  fileName: string;
  fileSize: number;
  fileSha1: string;
}

export interface AddonDependency {
  projectId: string | null;
  slug: string | null;
  title: string | null;
  iconUrl: string | null;
  type: 'required' | 'optional' | 'incompatible' | 'embedded';
}

export interface AddonProject extends AddonSearchHit {
  body: string;
  license: string | null;
  links: AddonLink;
  gallery: AddonGalleryImage[];
  versions: AddonProjectVersion[];
  compatibleVersionCount: number;
  dependencies: AddonDependency[];
}

export interface AddonProjectResponse {
  project: AddonProject;
}

export interface InstallAddonResponse {
  addon: InstalledAddon;
  replacedFileName: string | null;
  replacedVersionId: string | null;
  restartRequired: boolean;
}

export interface SetAddonEnabledResponse {
  addon: InstalledAddon;
  restartRequired: boolean;
}

export interface SearchAddonsParams {
  query?: string;
  sort?: string;
  category?: string;
  offset?: number;
  limit?: number;
  anyVersion?: boolean;
}
