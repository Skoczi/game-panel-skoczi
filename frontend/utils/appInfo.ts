function readVersionFromPackageJson(): string | null {
  const value = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__.trim() : '';
  return value || null;
}

export function getAppVersion(): string {
  return readVersionFromPackageJson() ?? '0.0.0-dev';
}

// Separate the upstream base from the fork revision; update checks keep SemVer.
export function formatDisplayVersion(version: string): string {
  const match = /^(\d+\.\d+\.\d+)-skoczi\.(\d+)(.*)$/.exec(version);
  return match ? `v${match[1]} · Revision ${match[2]}${match[3]}` : version;
}
