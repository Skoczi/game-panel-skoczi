# Game Panel PRO 2.0.50

Game Panel PRO brings the work since Revision 49 into a published release. It is an independently developed, expanded version of OVHcloud Game Panel 1.5.0, maintained by Skoczi under Apache 2.0.

## Standalone installation and updates

Install Game Panel PRO directly from this release; no upstream panel installation is required. The installer includes the complete source/build context, refuses an existing non-empty installation directory and builds our local updater image.

Existing standard OVHcloud Game Panel 1.5.0 installations have a dedicated preflight and migration command. Accounts, memberships, game records, JWT secret and deployment settings are preserved. The updater saves the stopped database and old image references before switching, then rolls back if startup fails.

Standalone installations can launch future updates from **Version & changelog**. Downloads come only from `Skoczi/game-panel-skoczi`; the archive checksum and contents are validated. Confirmation is required. Multi-node and custom deployments remain coordinated manual updates. [Install and migrate](https://github.com/Skoczi/game-panel-skoczi/blob/v2.0.50/docs/pro/INSTALL.md).

## Server workspace

A multi-node fleet with per-server access, cards and list layouts, filters and personal ordering. Each server has a dedicated workspace for console, files, configuration, backups, schedules, network and activity. Shared controls, responsive layouts and dark/light themes keep these tools consistent.

CPU is shown in vCPU; memory uses explicit units and assigned limits. Game data size and node free space are separate. Unknown and stale states are not reported as zero or success.

## Backups and data protection

- Native backups work with a running or stopped game, with optional names and persistent job status. Live copies are identified explicitly.
- Archives live in `data/backups` and contain only `serverfiles`. Logs, installers and existing backups are excluded.
- Restore requires a stopped game, validates the archive and stages it before replacing files. The previous directory remains available for recovery.
- Recovery journals handle interrupted restore and extraction operations. Free-space checks protect staging; manual retention has a preview and rejects stale deletion plans.
- Legacy archives stay downloadable. No automatic format conversion or off-node replication is included.

A live backup does not guarantee a consistent game-world save. Stop the game when its save format requires it, and retain important archives on separate storage.

## Editor and schedules

Text saves check the current file version and replace files atomically. Conflicts keep the operator's draft and open a comparison. Recoverable editor drafts and bounded server-side file history support configuration recovery without bypassing the save checks.

Native scheduled backups now work without contradictory server-state requirements. Cron validation rejects malformed values and handles timezone transitions. Cleanup commands can run after failure, separately from success-only post-commands.

## API v1

Scoped, expiring tokens for selected servers; the secret is displayed once and stored as a hash. Owner permissions are checked on every request. Tokens can be revoked from the panel.

The first API covers server inventory, resources, backup lists, named Native backup creation and operation status. Backup requests use durable idempotency keys, including after restart. Uncertain outcomes are explicit. [API guide](https://github.com/Skoczi/game-panel-skoczi/blob/v2.0.50/docs/pro/API-PROGRESS.md) · [OpenAPI](https://github.com/Skoczi/game-panel-skoczi/blob/v2.0.50/docs/pro/openapi-v1.json).

## Loading and console

Deferred panel loading, shared UI utilities and static compression reduce the initial download. Local median measurements moved from 5.59 to 0.96 seconds for login, 5.97 to 2.28 seconds for the server fixture and 12.13 to 5.08 seconds for first editor opening. These are synthetic measurements on a fixed CPU/network profile, not production timings.

Unchanged console rows are reused. Following the tail and counting unread logs continue to work when the 5000-entry rolling buffer is full.

## Upgrading

**Coordinate the panel and agent update.** Preserve the previous source/images, environment, databases and game recovery data. Native backup support requires `data/serverfiles`; review older layouts before migration. Managed standalone updates are started explicitly from the panel; remote-agent installations require coordinated manual updates. Publishing this release does not upgrade an existing installation.

Local validation covers backend, UI, real Linux filesystem faults and an isolated panel/agent integration. Target-host and game-client acceptance must still be performed before production rollout. No new games, ReHLDS template work or Egg importer are included.

[Deployment and rollback](https://github.com/Skoczi/game-panel-skoczi/blob/v2.0.50/docs/pro/DEPLOYMENT.md) · [Validation](https://github.com/Skoczi/game-panel-skoczi/blob/v2.0.50/docs/pro/VALIDATION-2.0.50.md) · [Screenshot slots](https://github.com/Skoczi/game-panel-skoczi/blob/v2.0.50/docs/screenshots/README.md)
