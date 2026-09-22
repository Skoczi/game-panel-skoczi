# Game Panel PRO 2.0.59

Native backups gain automatic retention, verified external copies and import from
external storage. These features are opt-in: updating does not enable deletion,
change schedules or configure a storage destination.

## Backup protection

- New protection settings in **Backups**, with independent local and external
  retention counts and protection against conflicting settings changes.
- Scheduled and manual backups use the same policy. Older validated local
  archives are removed only after a successful new backup and, when enabled,
  a verified external copy.
- External storage uses a dedicated NFS/SMB mount. SHA-256 checks verify the
  transfer before atomic publication. A missing mount cannot silently fill the
  node's local disk.
- External copies include private recovery metadata for the image, template,
  environment, ports and resources. Secrets are excluded from list responses.
- Import verifies checksum and archive structure without overwriting an existing
  local backup. Import does not stop, restore or restart the game.
- A failed external transfer preserves the new local backup and skips local
  retention. Recovery folders and unrecognized archives remain protected from
  automatic cleanup. The just-created archive remains protected after clock changes.
- Storage deadlines run in a separate worker so a stalled network filesystem
  does not indefinitely block the API operation.
- Responsive controls, explicit unavailable-storage errors and retained drafts
  when another administrator changes the policy.

## Compatibility and activation

Update both panel and agents to use the feature on remote servers. The new controls
stay hidden for agents that do not advertise `nativeBackupPolicy: 1`. No database
migration is added. Updating panel/agents does not restart game containers.

An administrator must mount and configure the external destination on each runtime
node. This release supports NFS/SMB, not direct S3. Configure timing in Schedules;
retention and external copying start disabled. This is game-data protection, not
a complete backup of the panel database, accounts or node identities.

See [configuration and recovery instructions](BACKUP-PROTECTION.md).

## Validation

Local validation passed 231 backend tests, 69 targeted browser tests and both
production builds. A live WAW2 backup was restored into an isolated container;
CS 1.6 started and answered A2S_INFO on `de_dust` with 16 slots. The source game
was not restarted. Actual OVH external-transfer acceptance remains pending
destination selection and activation; the successful rehearsal used a local copy.
