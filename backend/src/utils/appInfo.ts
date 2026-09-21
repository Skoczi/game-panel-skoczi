import fs from 'fs';

function readVersionFromPackageJson(): string | null {
  try {
    const raw = fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    const value = typeof parsed.version === 'string' ? parsed.version.trim() : '';
    return value || null;
  } catch {
    return null;
  }
}

export function getAppVersion(): string {
  return readVersionFromPackageJson() ?? '0.0.0-dev';
}

export function getRuntimeBuild() {
  const commit = process.env.GAMEPANEL_BUILD_COMMIT || '';
  const build = process.env.GAMEPANEL_BUILD_ID || '';
  return {
    version: getAppVersion(),
    commit: /^[a-f0-9]{40}$/i.test(commit) ? commit : null,
    build: /^[a-zA-Z0-9._-]{1,80}$/.test(build) ? build : null,
  };
}
