function readVersionFromPackageJson(): string | null {
  const value = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__.trim() : '';
  return value || null;
}

export function getAppVersion(): string {
  return readVersionFromPackageJson() ?? '0.0.0-dev';
}

// Compact fork revision for display only; update checks keep the full version.
export function formatDisplayVersion(version: string): string {
  const match = /^\d+\.\d+\.\d+-skoczi\.(\d+)(.*)$/.exec(version);
  return match ? `skoczi.0.${match[1].padStart(2, '0')}${match[2]}` : version;
}
