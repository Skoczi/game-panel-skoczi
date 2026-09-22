# Game Panel PRO 2.0.56

Game monitoring now distinguishes a running container from a responding game.
Scheduled tasks on one server no longer block tasks on other servers, and interrupted
tasks cannot silently replay after an agent restart.

## Game monitoring

- Node-side A2S checks run even when every browser is closed. Supported responses
  include CS 1.6 / ReHLDS and compatible Source games.
- Show game response state, map and player count/capacity in server cards, the server
  list and the console overview, separately from Docker status. Details include query
  latency and the last check time; stale data is cleared rather than presented as live.
- Choose an allocated UDP query port in Settings, with per-server check interval,
  startup grace and failure threshold. Defaults are 30 seconds, 90 seconds and 3 failures.
- Game templates can define an A2S profile referencing a UDP port key. Existing
  servers can opt in without reinstalling or rewriting their immutable templates.
- Activity records one confirmed incident and one recovery, including elapsed time.
  Planned operations suppress probing; Docker inspection failures are reported as
  missing observations, not game outages. Monitoring settings and current incident
  state survive a backend/agent restart. Fresh installations create the same
  monitoring schema as upgraded runtimes.
- Probes have bounded timeouts and concurrency. Checks use the node's internal game
  network and do not certify public Internet reachability. There are no automatic
  restarts or external alerts in this release.

## Scheduler reliability

- Dispatch independently across servers, with up to 20 concurrent tasks per runtime
  and a serial queue for each server. Busy servers retain due tasks until available.
- Resolve the current container before cleanup, including after a restart has
  recreated the container or failed partway through.
- On startup, mark unfinished tasks **Interrupted** and disable their schedules.
  Some commands may already have run: inspect the result before explicitly enabling
  the task again. Re-enabling schedules the next future run without replaying the
  interrupted occurrence.
- Reject changes and deletion while a task runs. The interface shows interrupted
  task details and disables conflicting controls. Configuration edits preserve
  execution results committed concurrently.

## Updating and compatibility

This release adds SQLite migration `0006_game_monitoring`. Keep a snapshot of each
runtime database, deployment configuration and current images before upgrading.
The updater's rollback source archive is not a backup of your data. A database with
the new migration ledger requires matching application code or the pre-update
database snapshot for rollback.

The panel and each node have independent runtimes. A panel-only update improves
the central/local runtime; remote servers receive the new scheduler and monitoring
only after their node agent is updated to 2.0.56. Existing remote operations remain
available. Monitoring-template installation checks `capabilities.gameMonitoring`.

Installations with remote nodes or a custom Compose layout retain their reviewed
manual update procedure; this release does not bypass the built-in updater gate.
Update backend/frontend without restarting game containers. An in-progress
scheduled task should finish before the runtime is replaced.

Upgrading from 2.0.54 also includes the [2.0.55 changes](RELEASE-2.0.55.md):
FastDownload, CPU binding, game-console schedules and server-management UI updates.

## Validation

Local validation passed 207 backend tests, 44 targeted browser tests and both
production builds before release preparation. Tests include real UDP challenge and
split-response exchanges, SQLite reopen/configuration races, worker concurrency,
mobile settings and fleet data scoping. Live deployment verification must also
check service health, the migration ledger, game-container continuity and the
target node's network/query path.

See [monitoring details and limitations](GAME-MONITORING.md).
