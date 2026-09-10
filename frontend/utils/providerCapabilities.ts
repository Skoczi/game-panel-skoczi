// `providerMetadata.capabilities` is published by the OVHcloud provider only. Other
// providers ship no metadata at all, so a missing block must not be read as "unsupported".
interface ProviderCapabilities {
  consoleCommand?: unknown;
  backup?: { type?: unknown; supportsCreate?: unknown } | null;
}

function readCapabilities(metadataJson: string | null | undefined): ProviderCapabilities | null {
  if (!metadataJson) return null;
  try {
    const parsed = JSON.parse(metadataJson) as { capabilities?: unknown } | null;
    const capabilities = parsed?.capabilities;
    return capabilities && typeof capabilities === 'object' ? (capabilities as ProviderCapabilities) : null;
  } catch {
    return null;
  }
}

export function supportsConsoleCommand(metadataJson: string | null | undefined): boolean {
  const capabilities = readCapabilities(metadataJson);
  return capabilities ? Boolean(capabilities.consoleCommand) : true;
}

export function supportsBackupCreate(metadataJson: string | null | undefined): boolean {
  return readCapabilities(metadataJson)?.backup?.supportsCreate !== false;
}

export function supportsBackupRename(metadataJson: string | null | undefined): boolean {
  return readCapabilities(metadataJson)?.backup?.type !== 'native-file-pair';
}
