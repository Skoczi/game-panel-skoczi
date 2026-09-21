# Deployment and rollback — preparation only

No deployment is part of this change. The last confirmed live version is `1.5.0-skoczi.49`, commit `679c161f5637f83da356f3943e23a0ef6e40b15c`. The development identity becomes Game Panel PRO `2.0.49`.

## Existing WAW2 process

The local `eserv-deployment/upgrade49.py` and its builder are the current reference. They validate the WAW2 host and package checksums, compare expected Compose content, build candidate images, pin old and new image identities, stop only the panel services and copy panel data before switching. They retain previous source, Compose, environment, release metadata and SQLite data. Failure after switching restores the prior panel state. They do not update remote agents.

Keep `/srv/eserv/data`, `backend.env`/JWT secret, server data and all Native archives. Do not use the upstream host installer or a generic Compose regeneration. Keep managed automatic updates disabled.

## Agent gate

**WAW1 requires a 2.0.49 agent update before this release can be accepted.** File versions/atomic writes, Native backup/restore, scheduler and resource measurements execute on the runtime node. A panel-only update cannot deliver those functions on an old agent. SSH to WAW1 is not configured; this is a deployment prerequisite, not permission to alter it through another channel.

On an old agent the UI lacks the new measurements. Do not interpret that as zero. Before exposing file editing to users, confirm the runtime returns content ETags and rejects saves without a version; an old agent cannot enforce the new protection.

## Candidate acceptance

1. Build and test a fixed commit. Prepare the coordinated agent/panel package without running it.
2. Record deployed versions, image digests and schema migration state on both nodes.
3. Preserve panel/agent SQLite, source, environment and previous image references before switching.
4. Use a disposable Native server: online and offline backup, archive listing, stop, restore, compare files, start and join with a game client.
5. Test concurrent editor saves across two sessions and Unicode files at the byte limit.
6. Verify CPU/RAM limit changes, disk and network measurements, cron timezone and failed-job messages.
7. Verify other containers remain untouched. Only then consider publishing a stable GitHub release.

`0004_resource_metrics` adds nullable `resources_json` to `server_metrics`. Existing rows remain intact. For rollback use the pre-upgrade database with the old source/images; do not point an old application at a newer migration ledger without review.

## Recovery scope

Panel rollback is not game data rollback. A Native restore retains the old `serverfiles` directory separately; keep matching runtime/template metadata. Legacy `.native-backups` directories are retained and need manual recovery for their old mount-based format. No automatic migration or deletion of those archives occurs.

Do not issue a `v2.0.49` release/tag until acceptance is complete. A draft release may hold these notes; it must not advertise an untested production update.

## Stage A completion checks

The candidate now adds persistent backup jobs and on-start recovery of restore/extraction journals. Before a coordinated rollout, test agent termination at both restore rename boundaries and during a multi-file extraction commit on disposable Linux game data. Confirm that only the affected game is stopped for recovery, that failed recovery blocks writes/start, and that status survives a browser reload. Keep journals, `.backup-jobs`, `.extract-*`, `.native-backups` and `data/backups` when backing up the server directory.

Legacy layouts require explicit reviewed migration. This stage does not change game templates or automatically move an installation into serverfiles. Existing legacy archives are downloadable, not silently converted.

## Local source package

`scripts/prepare-local-release.py` packages a clean, committed candidate and an explicit rollback commit into a new directory outside the repository. It checks frontend/backend versions, rejects private data paths and unsafe archive members, and writes commit identities plus SHA-256 checksums. It neither connects to a host nor publishes a tag.

```sh
python3 scripts/prepare-local-release.py --candidate HEAD \
  --rollback 679c161f5637f83da356f3943e23a0ef6e40b15c \
  --output '../game-panel-pro-2.0.49-candidate'
```

These are **source rollback archives**, not snapshots of running WAW services. Before deployment the existing upgrade process must still capture actual images, environment, databases and recovery journals, and coordinate the panel with WAW1. Verify `SHA256SUMS` before using the package. Do not run historical `upgrade49.py` as an installer for this new candidate.
