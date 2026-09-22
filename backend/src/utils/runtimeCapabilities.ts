// Increment each protocol only when its semantics change incompatibly.
// Package versions alone do not prove that a runtime supports an operation.
export const runtimeCapabilities = Object.freeze({
    cpuBinding: 1,
    gameMonitoring: 1,
    templateIcons: 1,
    fastDownload: 1,
    versionedFiles: 1,
    backupJobs: 1,
    nativeRestoreRecovery: 1,
    absoluteResources: 1,
    nativeProtection: 1,
    nativeRetention: 1,
    fileHistory: 1,
});
