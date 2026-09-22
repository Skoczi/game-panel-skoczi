# Daily operation and data protection

## Native backup layout

For a Native server using `/data`:

```text
<servers>/<id>/data/
  serverfiles/          game binaries, configuration and saves
  log/                  runtime logs, outside the backup
  backups/
    native-....tar.gz
    native-live-....tar.gz
    recovery-<uuid>/    files retained before a restore
  ...                   other runtime directories are preserved
```

The archive begins with `serverfiles/`. It does not include `backups`, `log`, installer cache or other sibling directories. The Docker image, template and environment are not in this archive; retain panel database and deployment metadata separately.

Online backups do not stop or restart the game. A game can write during archiving: an online archive is best-effort, not a transactional world snapshot. For a consistent copy, save through the game's supported mechanism, stop the server, then create the backup. A failed archive is not published and its partial file is removed.

Restore requires the server to be stopped. The runtime validates gzip/tar entries, paths, entry types, duplicate names, required directory and available staging space. Internal links are recreated only after regular files are staged and their resolved targets are checked. External, broken or cyclic links and special files are rejected. It stages data on the same filesystem and renames directories only after validation. Original files remain in `backups/recovery-<uuid>/serverfiles`. Logs and sibling directories are left in place. The server remains stopped.

An ordinary replacement failure restores the original directory. A durable `.native-restore.json` journal is written before the swap. On agent startup, an unfinished transaction stops the affected container if necessary and rolls back to the previous files. Recovery failure blocks further panel mutations instead of allowing a start. Interrupted candidate trees are retained for inspection. The filesystem recovery states are tested locally; actual Linux host/power-loss acceptance remains a deployment requirement. Recovery directories are not automatically deleted.

Manual Native backups have an optional name. The runtime validates it and appends time and a unique identifier, so repeating a name does not overwrite an older copy. Empty names use the automatic format. Before publication, archives are checked against the restore path/link contract; external, broken or cyclic links produce a failed backup rather than a misleading successful recovery point.

Manual Native backup and restore requests return a persistent job immediately. Backups shows recent operations after a page reload, including failures. Closing the page does not cancel a job. A connection error does not prove the operation stopped: inspect its saved status before retrying. An agent restart marks unfinished job records as interrupted. Restore recovery is completed separately before allowing new mutations.

The file manager protects `data/backups`, including indirect paths through links and recursive downloads of its parent. Use the Backups API with backup permissions. Older `.native-backups` archives are visible as legacy downloads; their mount format needs manual recovery. Legacy layouts without `data/serverfiles` show a migration warning and disable new manual backups. No game directory or template is silently migrated.

A Native update is a separate operation. Restoring game files does not rewind the Docker image, environment or template; use matching runtime metadata when recovering an older game version.

## Editor

Save replaces the current server file with the editor contents, including changes made by the game since opening it. The write uses a sibling temporary file, syncs it and atomically replaces the original while preserving owner and permissions. Reads and writes have a 2 MiB byte limit. Failed saves leave the editor text intact.

The editor requests explicit overwrite mode. API callers that omit `overwrite: true` retain conditional version checks. Update agents to 2.0.52 before deploying the new editor.

History retains the content read immediately before an editor save: up to 10 versions per file, 100 per server and 30 days, with a 512 KiB text limit and 64 MiB server quota. Loading history changes the editor; Save applies it. A game can still rewrite its configuration after a panel save.

Native backups preserve internal relative symlinks even when their targets are missing. Absolute or escaping links, cycles and missing hard-link targets are rejected. These checks also run before restore staging.

## Schedules

Cron uses five fields: minute, hour, day, month, weekday. Numbers, lists, ranges, names for month/weekday and positive steps are supported. Invalid trailing characters and additional separators are rejected. `5/10` means every ten units starting at five. A job runs at most once per scheduler tick; missed downtime executions are not replayed.

The schedule follows the runtime node's timezone, displayed with the next runs. Local times skipped during spring daylight-saving changes do not run; repeated times in autumn can occur twice. Pre/post/cleanup game commands require a running game. Post runs only after success. Cleanup also runs after a failed task while the agent remains available; use it to re-enable game saving, not as a guarantee across a host crash. For a stopped-server backup, leave those commands empty.

## Metrics

CPU is used vCPU and configured CPU limit; memory is working-set bytes and configured memory limit. No configured limit is shown as “no limit”, not host capacity. Bars reflect the assigned limit. Host-wide percentages belong in Host Status.

Disk is game data usage in MiB/GiB, with node free space separately. Disk sampling is cached for two minutes. Network is bytes per second. Older samples have no absolute resource record and are not relabeled as modern values. Missing measurements show “No data”.

## Archive extraction

Extraction first writes to a private staging directory. It validates the package and destination conflicts before replacing existing files. A durable extraction journal retains previous files during commit; normal failure or agent startup recovery rolls the operation back. Failed recovery blocks server mutations. Empty directories created while preparing a failed merge may remain. Links in ordinary packages are rejected explicitly; Native restore handles supported backup links. An archive cannot overwrite itself.

The maintenance lock lasts for the entire background extraction, not just the HTTP request. Backup, restore, power changes and other panel mutations cannot overlap it. Game processes are outside this lock; stop a game before replacing files that it actively writes.

## Recoverable browser drafts

In a globally identified server workspace, the text editor retains local drafts for up to 24 hours. Reopen the same file to recover the draft. If the remote version changed, compare and merge before saving; recovery never writes to the server automatically. Explicit discard, successful save and logout clear the relevant drafts. The browser keeps at most 20 records / 2 MiB total, with a 512 KiB limit per record including the baseline. A visible note reports unavailable or full browser storage. Direct runtime views without a global server identity retain in-memory editing only. See [UX progress](UX-PROGRESS.md).

## Ochrona danych w kandydacie 2.0.49

Podsumowanie miejsca, rekordy kontroli archiwów, ręczne sprzątanie z podglądem oraz limity historii edytora opisuje [raport etapu 3](DATA-PROTECTION-PROGRESS.md). Te funkcje wymagają aktualnego agenta. Kontrola struktury kopii nie zastępuje próby odtworzenia i uruchomienia gry.

## Backup protection

Opt-in automatic retention and NFS/SMB external copies for Native servers are
documented in [Backup protection](BACKUP-PROTECTION.md), including deployment
requirements, failure behavior, import and the isolated WAW2 recovery rehearsal.

## Integration API

Manage scoped tokens from the account menu. Read [API operation and retry rules](API-PROGRESS.md) before enabling automation. The [OpenAPI contract](openapi-v1.json) describes available endpoints. Keep one idempotency key per logical backup request and preserve it across lost responses. A 202 response is not a completed backup.
