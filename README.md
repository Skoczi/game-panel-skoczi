<div align="center">

# Game Panel PRO

**Servers, console, files and recovery in one workspace.**

[![Release](https://img.shields.io/github/v/release/Skoczi/game-panel-skoczi?color=0891b2)](https://github.com/Skoczi/game-panel-skoczi/releases)
[![CI](https://github.com/Skoczi/game-panel-skoczi/actions/workflows/skoczi-ci.yml/badge.svg?branch=main)](https://github.com/Skoczi/game-panel-skoczi/actions/workflows/skoczi-ci.yml)
[![License](https://img.shields.io/badge/license-Apache_2.0-64748b)](LICENSE)

[Features](#features) · [Screenshots](#screenshots) · [Documentation](#documentation) · [Changelog](CHANGELOG.md) · [Polski](docs/pro/README.pl.md)

</div>

Game Panel PRO is a self-hosted panel for managing game servers across multiple nodes. It is built for a trusted group of operators who need direct access to the console, configuration, schedules and backups.

Developed by **Skoczi**, it extends **[OVHcloud Game Panel 1.5.0](https://github.com/ovh/game-panel/tree/v1.5.0)** with a multi-node workspace, Native runtime, recovery tools and a scoped integration API. It is an independent project, not an official OVHcloud release.

**Current release: 2.0.55.** [Release notes](docs/pro/RELEASE-2.0.55.md) · [Compatibility](docs/pro/FEATURES.md)

## Screenshots

Reserved for real panel captures. Each view has a defined slot in the [screenshot guide](docs/screenshots/README.md); no mockups are presented as working screens.

| Fleet overview | Server workspace |
|:---:|:---:|
| *Desktop · dark theme — screenshot to follow* | *Console and resource measurements — screenshot to follow* |
| File editor | Backups & recovery |
| *Tabs, direct saving and file history — screenshot to follow* | *Named copies, job status and restore — screenshot to follow* |

<!-- Replace the slots above with real captures using these paths:
![Fleet overview](docs/screenshots/fleet-dark.webp)
![Server console](docs/screenshots/server-console.webp)
![File editor history](docs/screenshots/files-history.webp)
![Native backups](docs/screenshots/native-backups.webp)
![Mobile server workspace](docs/screenshots/server-mobile.webp)
-->

## Features

### Fleet and server workspace

- Manage local and remote runtime nodes from a single panel, with per-server access controls.
- Use fleet cards or a list, personal ordering, game filters and groups.
- Keep console, files, configuration, backups, schedules, network, startup settings and activity within the selected server.
- Read connection addresses and copy identifiers without leaving the workspace. Configure per-IP port allocations and ranges.
- Use dark or light themes, responsive layouts, a resizable side console and shared confirmation dialogs.

### Console and resources

- Send commands, recall previous commands, copy output and switch to full screen.
- Follow incoming logs or pause scrolling to read earlier output. The rolling buffer retains up to 5000 server log entries.
- Read CPU in vCPU, memory in bytes and usage against assigned limits. Game data size, free node storage and network rates are separate measurements.
- Missing or stale information stays visibly unavailable rather than appearing as zero usage or a successful operation.

### Files and configuration

- Browse files, upload, preview, rename and use archive tools. Edit configuration in a tabbed Monaco editor.
- Save text directly with atomic replacement, preserving file owner and permissions. Save replaces the current server file with the editor contents.
- Recover bounded local editor drafts and review server-side file history with timestamps and operator information.
- Load a historical text version into the editor, review it, then save to apply it.
- Archive extraction stages changes and keeps rollback data while the operation runs.

### Native backups and recovery

- Create an optionally named backup while the server is running or stopped. Online copies are marked as live; game-specific save consistency is not guaranteed.
- Store archives in `data/backups`, beside `serverfiles` and `log`. Archives contain only `serverfiles`, excluding logs, installers and older backups.
- Download archives, inspect operation status after reload and review backup protection information.
- Restore while the game is stopped. The runtime validates and stages the archive before replacing `serverfiles`; previous files are retained for recovery.
- Use a free-space guard and preview manual retention before deleting copies. Incomplete recovery data is protected from cleanup.
- Keep legacy archives available for download without silently converting their format.

### Schedules and integrations

- Schedule backups, restarts and custom tasks using validated five-field cron expressions, node timezone information and next-run previews.
- Define pre/post commands and cleanup steps that can run after a task fails.
- Create expiring API tokens scoped to selected servers and operations. Secrets are shown once; access also depends on the owner's current permissions.
- Use API v1 to list servers, read resources and backup metadata, create Native backups and follow operation status.
- Retry backup requests with an idempotency key. Interrupted or uncertain outcomes are reported explicitly.
- Read the installed changelog and check releases from this GitHub repository. Standard standalone installations can update from the panel, with a snapshot and automatic rollback on failed startup.

[API guide and curl examples](docs/pro/API-PROGRESS.md) · [OpenAPI contract](docs/pro/openapi-v1.json)

## Runtime support

| Runtime | Scope |
|---|---|
| **Native** | Versioned template definitions, explicit install/update recipes, resource limits and the backup/recovery workflow described above |
| **LinuxGSM** | Existing adapter, game configuration and provider-specific operations |
| **OVH adapter** | Existing provider behavior and supported configuration/backup operations |

Capabilities differ by provider. A listed template is not a certification that every game has passed installation, live backup and recovery testing. This release adds no games or Egg importer. [Full compatibility notes](docs/pro/FEATURES.md).

## Install or upgrade

Install Game Panel PRO directly; no existing OVH panel is required:

```sh
git clone --branch v2.0.55 --depth 1 https://github.com/Skoczi/game-panel-skoczi.git
cd game-panel-skoczi
sudo bash deploy/install.sh
```

For an existing standard OVHcloud Game Panel 1.5.0 installation, use the separate migration path:

```sh
sudo python3 deploy/upgrade.py check --app-root /opt/gamepanel --project-name gamepanel
sudo bash deploy/update.sh --app-root /opt/gamepanel --project-name gamepanel
```

Run these commands from the new release checkout outside the installed panel directory. The fresh installer refuses a non-empty destination. [Requirements, migration, panel updates and rollback](docs/pro/INSTALL.md).

## Deployment

**Update the panel and runtime agents together.** An old agent cannot provide the new file protections, Native recovery or resource measurements. Preserve databases, environment, image references, game data and recovery journals before an upgrade.

Native backup support requires the `data/serverfiles` layout. Existing installations using another layout need a reviewed migration. A backup on the same disk is a local recovery point; download important copies to separate storage.

Start with the [deployment and rollback guide](docs/pro/DEPLOYMENT.md). Source archives are not a snapshot of an existing installation. Docker integration tests cover Linux behavior; target-host acceptance and a real game-client check remain part of deployment.

## Documentation

| Guide | Contents |
|---|---|
| [Install & upgrade](docs/pro/INSTALL.md) | Standalone installation, 1.5.0 migration and managed updates |
| [Operations](docs/pro/OPERATIONS.md) | Backups, restore, file protection and limits |
| [Compatibility](docs/pro/FEATURES.md) | Native layout and provider differences |
| [API v1](docs/pro/API-PROGRESS.md) | Authentication, scopes, errors and examples |
| [Development](docs/pro/DEVELOPMENT.md) | Local setup and test commands |
| [Validation](docs/pro/VALIDATION-2.0.50.md) | What was tested and what still needs target-host acceptance |
| [Performance](docs/pro/PERFORMANCE-PROGRESS.md) | Reproducible local measurements and regression budgets |
| [Changelog](CHANGELOG.md) | Current release and development history |

### Local development

Use Node.js 22 or 24 LTS, npm and Git. Docker integration tests need a Linux Docker runtime.

```sh
git clone https://github.com/Skoczi/game-panel-skoczi.git
cd game-panel-skoczi
npm ci --prefix backend
npm test --prefix backend
npm run build --prefix backend
npm ci --prefix frontend
npm run build --prefix frontend
cd frontend
npx playwright install chromium
npm run test:ui
```

See the development guide for service configuration and the isolated Linux acceptance runner. UI screenshots are opt-in with `PLAYWRIGHT_SCREENSHOTS=1`.

## License and origin

Apache License 2.0. Original OVH copyright and notices are preserved in [LICENSE](LICENSE), [LICENSE-2.0.txt](LICENSE-2.0.txt) and [NOTICE](NOTICE). Skoczi maintains the modifications and continued development. The repository URL remains `Skoczi/game-panel-skoczi` for continuity; the product name is **Game Panel PRO**.
