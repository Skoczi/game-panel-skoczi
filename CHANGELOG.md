# Game Panel PRO — Changelog

## 2.0.53

- Renamed Startup & Settings to Settings, including the settings heading and modal navigation.
- Added Delete server at the bottom of Settings, gated by server.delete. Confirm the exact server name before removing its runtime, files and local backups.
- Successful deletion returns to the shared fleet with the chosen node scope. Remote deletion retains the global server identity and node routing.
- Permission failures remain visible; an unconfirmed deletion requires checking the fleet before another attempt.

Panel update only. Agents 2.0.52 are compatible; no agent or game restart is required. No database migration.


## 2.0.52 — Editor, backups and unified navigation

- File Editor saves directly, including when the game changed the file after opening it. Writes remain atomic; the previous contents are kept in file history within its size and retention limits.
- Native backups and restore preserve internal relative symlinks with missing targets, including the optional `libSDL2.so` link in existing CS 1.6 servers. Unsafe links remain blocked.
- File history has a padded modal, a clear empty state and shorter controls. Loading a version still requires Save to apply it.
- Backup name and retention fields have visible borders and spacing. The archive list comes first; storage details, legacy archives and operation metadata are expandable.
- Files is now File Editor. Removed the extra server context strip; disabled power buttons retain their tooltips.
- Compact node selector with location and availability on one row. All nodes remains the default.

- One Game Servers view: node links and installation shortcuts open the shared list with that node selected. The old runtime list is removed.
- Long names wrap within the name column; CPU and RAM values keep their units on one line. Console buttons and the quick-console heading use shorter labels.
- Matching page and tab headings, with a compact loading state.
- Removed Resources, announcements, Follow Us and Trustpilot from the panel and its settings.
- Configurable favicon: HTTPS URL or PNG, ICO, JPEG and WebP upload. The default icon now uses Game Panel PRO styling.
- Root administrators can edit user access across every node. Failed permission reads block saving, and grants use the global server identity.

Update the panel and agents together, agents first. Game containers do not need a restart. The settings record gains a favicon field; retain a database snapshot alongside previous images and configuration for rollback.


## 2.0.51 — Global node selection

- Sidebar node filter on every administrator page, with All nodes as the default.
- Per-node server filtering and an all-host metrics overview with individual history charts.
- Isolated metrics streams and explicit unavailable states; no reused host cache.
- Compatible with 2.0.50 agents; central panel update only.

## 2.0.50 — Game Panel PRO

First published Game Panel PRO release, based on the expanded OVHcloud Game Panel 1.5.0 fork. Includes the backup, editor, resources, API and UI work recorded in the 2.0.49 development candidate below.

- Standalone Linux installer: complete build inputs, our own panel/updater images, non-empty destination protection and HTTP readiness check.
- Standard 1.5.0 migration: preflight, preserved accounts/configuration, stopped database snapshot, pinned rollback images and recovery on failed startup.
- Updates from the panel for supported standalone installations, with explicit confirmation, stable releases from our GitHub and verified source archives. Multi-node/custom installations remain manual.
- Maintenance barrier for PRO updates: block new writes, pause scheduled work and drain active operations before switching.
- Bundled 2.0.50 changelog, available offline; version checks use `Skoczi/game-panel-skoczi` only.
- Expanded README, API/compatibility documentation, installation guide and reserved screenshot slots.

[Full release notes](docs/pro/RELEASE-2.0.50.md) · [Install or migrate](docs/pro/INSTALL.md).

## 2.0.49 — local release candidate

Renamed the project from the Skoczi edition to Game Panel PRO. Continues `1.5.0-skoczi.49` (Revision 49). Not deployed or published as a stable release.

- Faster login through deferred panel loading, isolated UI helpers and compressed static assets; repeatable local performance budgets.
- Console rendering reuses unchanged rows; following and unread counts work when the rolling log buffer is full.
- Scoped, expiring API tokens with one-time secret display and revocation; API v1 for server inventory, absolute resources and backup metadata.
- Native backup API with durable admission, idempotency across restarts and explicit uncertain outcomes; OpenAPI and curl examples.
- Native protection summary with archive validation records, separate storage measurements and backup schedule health.
- A 64 MiB free-space guard for backup and restore staging; reviewed manual cleanup with separate archive/recovery rules and stale-plan rejection.
- Bounded editor file history with operator, before/after comparison and conflict-checked recovery through the editor.
- Section-level recovery, runtime compatibility checks and explicit unknown operation/server states.
- Shared operation guidance and persistent file-operation history; Native interruption and disk-full recovery validated on isolated Linux Docker.
- Shared backup/schedule headings, explicit disabled-action reasons and server context with copyable identifiers and chart sample time.
- Recoverable browser editor drafts in globally identified server workspaces, with expiry, logout cleanup and conflict-safe recovery.

- Fixed Native scheduled backups for stopped servers; added explicitly marked live backups.
- Store new Native archives in `data/backups`, containing only `serverfiles`.
- Added staged restore with validation and retained recovery data; requires a stopped server.
- Optional manual Native backup names with unique filenames and archive compatibility validation.
- Persistent Native backup/restore jobs, restart recovery journals and full-lifetime extraction locks.
- Protected backup paths, legacy archive downloads and layout migration warnings.
- Staged ordinary extraction with rollback of overwritten files.
- Explicit schedule cleanup after failures and shared confirmation dialogs across management screens.
- Strict cron syntax, elapsed-minute DST handling and next-run timezone information.
- Conditional, atomic text file saves with conflict comparison and a consistent 2 MiB limit.
- Absolute CPU/RAM metrics and configured limits; game data and node free storage are separate.
- Shared Native controls and editor confirmation dialogs.
- Updated project documentation, release checks and in-panel changelog.

Agent update required. No Egg importer, new game, automatic retention or off-node storage in this release.

## Before 2.0.49

Revision 49 is the last audited deployed baseline. Revisions 11–49 added the multi-node fleet, Native runtime/templates, per-IP allocations, shared UI, server workspace, file editor and console work. The repository commit history is the authoritative detailed record; no reconstructed release dates or unverified release claims are assigned here.

- [Complete fork commit history through Revision 49](docs/pro/REVISION-HISTORY.md)
- [Earlier fork changelog](CHANGELOG-SKOCZI.md)
- [Historical implementation notes](docs/skoczi/CHANGES.md)
- [Original upstream changelog](docs/pro/UPSTREAM-CHANGELOG.md)
