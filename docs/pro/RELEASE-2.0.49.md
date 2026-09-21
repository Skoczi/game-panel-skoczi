# Game Panel PRO 2.0.49

Local release candidate. Not deployed to eserv.pl and not published as a GitHub release.

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

- Native backups run for stopped and running servers. Live archives are marked and do not promise a consistent world snapshot.
- Native archives live in `data/backups/` and contain only `serverfiles/`. Logs, installers and older backups are excluded.
- Restore validates and stages files before replacing `serverfiles/`. The game must be stopped. Previous files are retained in a recovery directory.
- Manual Native backups accept an optional name, with a timestamp and unique suffix. Completed archives are checked for restore compatibility.
- Backup and restore operations retain their status after reload. Interrupted restore transactions recover the previous tree on agent startup; failures keep mutations blocked.
- Managed backup directories are protected from ordinary file-manager operations. Legacy archives remain available as downloads with an explicit format warning.
- Ordinary archive extraction stages files, retains rollback data and holds its lock until the background task ends.
- Schedules include cleanup steps that run after a failure, separately from success-only post-commands.
- Cron rejects malformed numbers, ranges and steps. Next-run calculation follows actual elapsed minutes across daylight-saving transitions.
- File editing uses content versions and atomic replacement. A stale edit opens a comparison without discarding the draft. The size limit is 2 MiB of UTF-8 bytes.
- Current resource metrics show vCPU, memory bytes and assigned limits. Game data size and free node storage are separate. Missing measurements are not presented as zero.
- Confirmations for navigation, node settings and other management actions use shared panel modals. Native backup naming uses the shared input and modal components.
- Project identity: Game Panel PRO. Version 2.0.49 continues development from `1.5.0-skoczi.49`; it is not upstream OVH version 2.

Panel and agents require a coordinated update. Automatic production updates remain disabled. No new game or Egg importer is included.
