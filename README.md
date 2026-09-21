# Game Panel PRO

A self-hosted game server panel for a trusted group. Manage servers across nodes, edit configuration, use the console, schedule tasks and recover game files from backups.

**Independent fork of [OVHcloud Game Panel](https://github.com/ovh/game-panel), developed by Skoczi.** The upstream copyright and Apache 2.0 notices remain in [LICENSE](LICENSE), [LICENSE-2.0.txt](LICENSE-2.0.txt) and [NOTICE](NOTICE).

Current development version: **2.0.49**. This is a local release candidate, not a statement about the version deployed at eserv.pl.

## Interface

A compact workspace with a server fleet, console and file editor. Dark and light themes, responsive layouts and shared controls.

Screenshots will be added after release review. See [the screenshot slots](docs/screenshots/README.md); this repository does not use placeholder images presented as real product screenshots.

## What it does

| Area | Available behavior |
| --- | --- |
| Fleet and nodes | Multi-node inventory, per-server access, console and activity |
| Native runtime | Versioned template snapshot, explicit installation and update recipes |
| LinuxGSM / OVH adapters | Existing provider-specific installation and game configuration |
| Files | Multiple editor tabs, previews, uploads, archive tools and conditional text saves |
| Native backups | Online or offline `serverfiles` archive, download, restore while stopped and retained recovery data |
| Scheduling | Restart, backup and custom tasks, strict five-field cron, pre/post steps |
| Resources | Absolute CPU/RAM measurements, assigned limits, game data size and network rate |
| Project updates | GitHub release checks and in-panel changelog; managed deployment stays manual |

Provider capabilities differ. A catalog entry is not proof that a game has passed a full installation and recovery test. [Feature and compatibility matrix](docs/pro/FEATURES.md).

## Documentation

[Dokumentacja po polsku](docs/pro/README.pl.md).

- [Daily operation and data protection](docs/pro/OPERATIONS.md)
- [Local development and tests](docs/pro/DEVELOPMENT.md)
- [Deployment, agent compatibility and rollback](docs/pro/DEPLOYMENT.md)
- [Stage A implementation status (PL)](docs/pro/STAGE-A.md)
- [Local validation report](docs/pro/VALIDATION-2.0.49.md)
- [Changelog](CHANGELOG.md) and [2.0.49 release notes](docs/pro/RELEASE-2.0.49.md)
- [Historical fork documentation](docs/skoczi/README.md)

## Scope

Game Panel PRO is designed for trusted operators. Docker access gives the runtime substantial control over its host. This release focuses on predictable operations and protecting game data. Billing, an Egg importer and additional game profiles are outside this update.

A backup on the game server's disk is a local recovery point. Download important archives to another machine or storage system.

## Development

Node.js 22 or 24 LTS, npm and Git are required. Docker integration tests additionally need a Linux Docker daemon.

```sh
cd backend
npm ci
npm test
npm run build
cd ../frontend
npm ci
npm run build
npx playwright install chromium
npm run test:ui
```

UI tests run headlessly. Screenshot capture is opt-in via `PLAYWRIGHT_SCREENSHOTS=1`.

## Releases and attribution

Release tags use `v2.0.X`. `2.0.49` continues the former Revision 49; the original base version is recorded in the changelog. Published GitHub releases are used for update detection. Missing or failed release checks do not prove the installation is current.

Repository: [Skoczi/game-panel-skoczi](https://github.com/Skoczi/game-panel-skoczi). The existing URL is kept so remotes and update checks remain valid. Product name: **Game Panel PRO**. Origin: **fork of OVH Game Panel**. This is not an official OVHcloud release.
