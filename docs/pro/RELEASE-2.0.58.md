# Game Panel PRO 2.0.58

Game monitoring can now notify administrators through Discord and optionally restart an unresponsive game. Automatic restart remains off for every existing server until explicitly enabled.

- Central Discord settings with event categories, hidden saved webhook, explicit test and delivery history.
- Durable agent event relay, node-scoped deduplication, bounded retention and rate-limit handling. Uncertain delivery is shown explicitly instead of generating blind duplicate retries.
- Notifications for game outage/recovery, node connection loss/recovery, backup/restore failure, schedule failure/interruption and recovery actions.
- Per-server restart cooldown and rolling attempt limit. Attempts survive process restarts and configuration changes. Planned stops, maintenance, observation gaps and runtime changes suppress automatic actions.
- Shared lifecycle and mutation lock for manual and automatic restart. Automatic recovery does not apply pending server configuration.
- Activity includes the reason and outcome of each attempt. A successful restart request is followed by an independent A2S check before claiming game recovery.

Panel and agents require an update. Migration `0007_monitoring_alerts` requires a pre-update database snapshot for rollback. Discord webhook configuration is optional; no messages are sent until enabled.

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

Update the panel and node agents together to enable Game Config on remote servers.
Existing game containers adopt the corrected startup script on their next panel
start/restart; updating the panel itself does not restart games.
See [configuration and compatibility](NATIVE-GAME-CONFIG.md).

## Validation

Backend tests cover configuration parsing, conflict handling, template compatibility,
monitoring and recovery. Browser checks cover desktop/mobile forms, independent
panel aliases, manual config edits and startup settings. Backend and frontend
production builds pass.
