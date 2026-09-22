# Native backup protection — stage 1 candidate

This change adds opt-in automatic retention and verified external copies to the
existing Native backup operation. It is a candidate based on 2.0.58, not a new
published release. Agents must advertise `nativeBackupPolicy: 1`; older agents
retain their existing Backups screen.

## Operator workflow

1. An administrator mounts a dedicated NFS/SMB directory on the runtime node and
   exposes it to that node's backend/agent container as described below.
2. In **Backups → Backup protection**, enable external copies and optionally
   automatic retention. Defaults are seven local and fourteen external copies;
   both features start disabled. Saving settings checks external availability.
3. In **Schedules**, create a task of type **Backup** and choose its timing.
   Settings in Backups apply equally to scheduled and manually created backups.
   For WAW2, the proposed initial schedule is daily at 03:15 UTC; it has not been
   enabled by this candidate. Verify the timezone displayed by the node.
4. Run one backup and check the complete operation result. A local archive alone
   does not prove that external protection succeeded.

Settings changes require both `backups.settingsWrite` and `backups.delete`.
Import requires `backups.create` and `backups.download`; listing requires
`backups.read`. Policy revisions prevent overwriting another administrator's
changes. Settings survive restart in `<serverRoot>/.backup-policy.json`.

## External storage setup

This implementation supports a mounted **NFS or SMB filesystem**, not an S3 API.
Use a dedicated directory, separate from existing host/Pterodactyl backup trees.
The runtime refuses local filesystems, missing mounts and symlink paths. It does
not create mounts or embed storage credentials.

Example additions to an agent's existing `compose.json` service:

```json
{
  "environment": {
    "GAMEPANEL_EXTERNAL_BACKUP_ROOT": "/external-backups",
    "GAMEPANEL_EXTERNAL_BACKUP_LABEL": "OVH Backup Storage"
  },
  "volumes": [
    {
      "type": "bind",
      "source": "/mnt/ovh-backup/gamepanel-backups",
      "target": "/external-backups",
      "bind": { "create_host_path": false }
    }
  ]
}
```

Merge these entries into the existing service; preserve its image, environment,
identity and data mounts. Create the dedicated directory **after confirming the
host network mount**. The container's root user must have read/write access.
Recreate only the agent after checking Compose configuration. Agent upgrades
preserve the existing Compose configuration and these additions. Mount changes
may require recreating the agent so its bind mount points at the current share.

For a panel with local games, the same settings belong on its backend. The
standard `deploy/upgrade.py` rejects extra backend mounts; review that installation's
update path before enabling local-node external storage. WAW2 is an agent, so
its existing image-only update path preserves the mount.

Storage layout:

```text
<external root>/gamepanel-v1/<server runtime UUID>/
  native-<unique name>.tar.gz/
    archive.tar.gz
    recovery.json
  .partial-<UUID>/                incomplete transfer; never offered for restore
```

The recovery record contains a SHA-256 checksum, size, timestamps, consistency
mode and runtime metadata (image, template, environment, ports and resources).
It is private and may contain game secrets. The API only returns archive summary
fields. This is not a full backup of the panel database, accounts, node identity,
TLS or deployment configuration; retain those separately. Whole-node loss still
requires an operator to recreate the runtime from the private metadata. The UI
imports copies for an existing runtime UUID; it does not rebuild a lost fleet.

## Success, failure and retention

The order is: create and validate local archive → persist validation record →
copy and compare source/destination SHA-256 → publish the external directory →
external retention → local retention. Copying needs archive size plus 256 MiB
free space. The just-created archive is protected even after a clock correction.

An external failure marks the operation failed but retains the completed local
archive and skips local retention. Partial directories and malformed external
records are preserved for manual inspection. Missing mounts never silently
fall back to the node disk. Listing has a 15-second deadline; transfer/import
has a ten-minute deadline, in a separate process. A stuck NFS kernel operation
may outlive that deadline; the API reports failure without waiting for exit.
Check storage and operation status before retrying. Partial files may remain.

Automatic local retention only deletes archives with matching validation records.
It never removes recovery directories or unknown/unvalidated archives. The last
validated recovery point may cause the retained count to exceed the configured
count after a clock correction. Use the existing reviewed cleanup tool for
recovery folders. External retention only affects completed copies for the
same runtime UUID, after a newly verified transfer; unrelated host backups are
never included. Retention is a count, not a size quota or a minimum age.

Disabling external copies does not delete stored copies. Disabling automatic
retention stops both local and external pruning. Imported archives become
validated local archives and are eligible for future automatic retention.

## Recovery

Use **External copies → Show / refresh copies → Import to local backups**.
Import checks SHA-256 and archive structure before publishing it locally and
never overwrites a same-named local archive. It does not stop, restore or start
the game. Then stop the game and use the existing **Restore** action. Restore
keeps the displaced files in a recovery directory and leaves the game stopped.

Live copies remain best-effort because the game may write while files are read.
For games needing a consistent world snapshot, use their save mechanism and/or
take an offline backup. Successful structure/hash checks do not substitute for
starting an isolated restored game.

## Acceptance evidence — 22 September 2026

- WAW2: first local live backup completed without stopping the source server.
- Restored that archive with the production Native restore implementation into
  an isolated temporary container using the same game image, no external network
  and no published ports. The game answered A2S_INFO: `de_dust`, 0/16 players.
- Source container ID/start time and `server.cfg` remained unchanged. Temporary
  container and restored data were removed; the original backup was retained.
- Unit/route tests cover opt-in policy, conflicts, copy failure before pruning,
  clock rollback, checksum/structure failures, no-clobber import, missing mount,
  retention isolation and a killed worker that never emits an exit callback.
- Browser tests cover editing, permissions, import, failed storage and mobile /
  dark desktop layout, alongside existing server settings/configuration tests.

This rehearsal verifies local archive recovery and game startup. It does **not**
claim a completed transfer or restore from the real OVH share; destination
selection and production activation remain pending.
