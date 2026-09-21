# Features and compatibility

| Function | Native 2.0.54 | Existing providers |
| --- | --- | --- |
| Console, power, files | Supported through the installed runtime | Existing adapter behavior |
| Backup | `data/serverfiles` only; archive in `data/backups` | Provider-specific archive or directory |
| Online backup | Allowed, explicitly marked best-effort | Provider-specific |
| Restore | Stopped server, staged validation, previous directory retained | Existing OVH adapter support; no new LinuxGSM restore |
| Retention / off-node copies | Manual | Existing LinuxGSM settings where supported |
| Game Config | Declared file links | Specialized adapter forms |
| Schedules | Online/offline backup; restart/custom require running server | Existing operation-specific behavior |
| Absolute metrics | Requires compatible PRO runtime | Same runtime requirement |

The Native backup layout currently requires a declared `data` mount containing `serverfiles`. The shipped ReHLDS template uses it. Legacy Native recipes that install directly in `/data` need an explicit layout migration before using the new backup path; do not silently archive the wrong directory.

Archives created by earlier revisions in `<serverRoot>/.native-backups` remain on disk. They contain mount directories and are not automatically relocated or treated as the new `serverfiles` format. The Backups screen lists them as legacy downloads for manual recovery. Do not delete them during update.

No new game has been certified by this stage. Local tests include real filesystem faults and an isolated Linux Docker panel/agent scenario. Game-specific save behavior, Linux ownership and actual WAW1 runtime operation require acceptance testing before deployment.

## Node selection

Administrators have a node selector on every page. **All nodes** is the initial view; a selection is retained per user within the browser tab. It filters the server list and Host Status. All-host metrics remain separate, because percentages from different hosts are not additive. Select a host for its detailed history. Panel, account and template settings remain global. The filter does not change the explicit runtime context of an open server or installation.
