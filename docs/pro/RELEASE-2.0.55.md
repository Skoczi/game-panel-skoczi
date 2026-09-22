# Game Panel PRO 2.0.55

This release collects the server-management and interface updates developed after 2.0.54.

## FastDownload

- Per-node FastDownload URLs, with settings below Resources & Volumes and a profile in each game template. Templates define whether the game uses FastDownload, its game directory, automatic folders, publication mode and optional download-URL configuration file.
- GoldSrc / CS 1.6 serves approved assets directly from the game directory: no duplicate files, symlinks or separate FastDownload directory. Source mode generates only `.bz2` files in `/data/fastdownload/<game>`.
- Compressed publication runs every minute, supports manual uploads, respects user-modified files and removes source-linked outputs when the source is deleted. Active file transfers pause publication. Switching to direct mode removes only generated copies and empty directories.
- Native backup/restore includes the FastDownload directory when present. Older backups without that directory preserve existing FastDownload files.
- A responsive public file browser provides folder navigation, file sizes, download links and pagination. Private paths, configuration files and filesystem links remain excluded. Invalid paths display a readable error page.
- The download URL can be saved in the game configuration and applied to a running console. File-browser shortcuts now open directories instead of attempting to edit them as files.

## CPU binding and resources

- Node-aware CPU affinity controls alongside vCPU and memory limits. The picker shows physical-core / logical-CPU topology and servers already assigned to those CPUs, including friendly names for recognized external containers.
- Multiple servers can share a binding; affinity and vCPU quotas remain separate controls. Choices refresh when opening the picker or changing nodes.
- Clearing a Docker CPU affinity requests recreation instead of claiming that an unsupported live update succeeded. Restart-required configuration remains explicit.

## Schedules, console and activity

- New **Game console** scheduled task type sends game commands through the running server console. Existing **Custom** tasks continue to execute in the container shell.
- Pre-commands, pauses, post-success commands and cleanup steps follow the selected task type. Scheduled task status refreshes and displays active runs.
- Activity records commands submitted through the panel and presents events as a grouped timeline with actor, time and status.
- Console output includes lifecycle and startup information, avoids duplicate status transitions and hides the known Steam desktop-client probe message in the console view.
- Native games can stop through their template-defined console command. Startup settings preserve multiline arguments, append custom parameters once and clearly show changes awaiting restart.

## Interface

- Refined installation status, server list metrics, server-name wrapping and consistent panel backgrounds.
- Consistent server-tab headings; improved Game Config cards, storage/backup spacing, console sizing, settings layout and dropdown styling.
- Improved file/editor loading states and mobile folder navigation. Removed redundant helper labels across the updated screens.

## Updating and compatibility

Update remote agents first, then the panel, to **2.0.55** before using the new scheduling, CPU-binding and FastDownload features. Updating the panel/agents does not require restarting game containers; applying game runtime or binding changes may require a separate restart/recreation.

This release adds database migration `0005_scheduled_game_commands`. Preserve each node's database and deployment configuration before upgrading. Do not downgrade a runtime containing new scheduled-task types, CPU-binding metadata or FastDownload template snapshots/archives to an older release without a compatible recovery plan. The supplied rollback archive contains source code, not a database or game-data snapshot.

FastDownload serving is **opt-in per node**: configure its public origin, internal proxy and read-only asset service before enabling template profiles. Existing reverse proxies are not automatically rewritten by the release. The backend image now explicitly installs the BZIP2 compressor. See [FastDownload setup](../skoczi/FASTDOWNLOAD.md).

Saved server templates are immutable snapshots: changing a template does not silently rewrite existing servers. Publication does not modify game files, branding or hosting configuration on installed systems.
