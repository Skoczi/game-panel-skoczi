# Game Panel PRO 2.0.58 — candidate

Game monitoring can now notify administrators through Discord and optionally restart an unresponsive game. Automatic restart remains off for every existing server until explicitly enabled.

- Central Discord settings with event categories, hidden saved webhook, explicit test and delivery history.
- Durable agent event relay, node-scoped deduplication, bounded retention and rate-limit handling. Uncertain delivery is shown explicitly instead of generating blind duplicate retries.
- Notifications for game outage/recovery, node connection loss/recovery, backup/restore failure, schedule failure/interruption and recovery actions.
- Per-server restart cooldown and rolling attempt limit. Attempts survive process restarts and configuration changes. Planned stops, maintenance, observation gaps and runtime changes suppress automatic actions.
- Shared lifecycle and mutation lock for manual and automatic restart. Automatic recovery does not apply pending server configuration.
- Activity includes the reason and outcome of each attempt. A successful restart request is followed by an independent A2S check before claiming game recovery.

Panel and agents require an update. Migration `0007_monitoring_alerts` requires a pre-update database snapshot for rollback. Discord webhook configuration is optional; no messages are sent until enabled. The release candidate has not been published on GitHub.

See [behavior, limits and rollout notes](MONITORING-ALERTS.md).

## Native Game Config

- Settings and configuration files now share the existing Game Config tab, with grouped
  controls, mobile layout, change review and permission-aware editing.
- Templates can declare their own fields; CS 1.6 / ReHLDS includes a ready-made preset.
- Versioned file saves retain comments and custom cvars. Conflicts preserve the draft,
  passwords are masked in review, and idle forms refresh external file changes.
- Game hostname comes from the active CFG; the panel label stays independent.
  New ReHLDS startup scripts no longer overwrite hostname. Existing known startup
  scripts are adapted when the container is recreated on a panel start/restart.

The Game Config changes are currently local and tested; they have not yet been
deployed or included in a GitHub release. See [configuration and compatibility](NATIVE-GAME-CONFIG.md).
