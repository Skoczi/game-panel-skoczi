# Monitoring alerts and automatic recovery

This package extends node-side A2S monitoring. Notifications and automatic recovery are independently opt-in. A running container is not evidence of a responding game; an unreachable node is not evidence that its games stopped.

## Discord notifications

Panel Settings → Discord notifications stores one Discord webhook on the central panel. Only root administrators can read or change notification settings or send a test. Reads never return the saved webhook URL. Categories: game incidents/recoveries, node connection loss/recovery, backup/restore failures, failed/interrupted schedules, automatic restart attempts. Arbitrary console commands and backup error output are not forwarded.

Agents queue structured events in SQLite and relay batches with their authenticated 15-second heartbeat. The panel persists a node-scoped event ID before acknowledging the batch. Lost acknowledgments do not duplicate a queued notification. Pending events expire after 24 hours; delivery history is retained for seven days, and each agent retains at most 1,000 events. Events received while notifications/category are disabled are marked skipped, not replayed on enable. Changing the destination cancels queued messages for the old destination.

The panel sends at most one message per three seconds, honors Discord 429 retry delays, and stops after five rate-limited attempts. Requests use `wait=true` and disable all mentions. Ambiguous transport/server failures and panel shutdown during delivery are marked **unknown**, not blindly repeated. Check Discord for the event ID. Exactly-once delivery across a network failure cannot be guaranteed by Discord webhooks.

Node loss is confirmed after 90 seconds without a heartbeat, with a 90-second startup grace for the panel. Disabled/pending nodes are excluded. A prolonged panel shutdown cannot notify while the panel itself is offline; use external monitoring for that requirement.

## Per-server automatic recovery

Settings → Game monitoring → Automatic recovery. Defaults: **off**, a 300-second cooldown, at most two attempts per rolling hour. Incident failure threshold and startup grace remain the existing monitoring settings. Allowed limits: 60–3,600 second cooldown, 1–5 attempts, 900–86,400 second window.

Recovery requires a fresh, confirmed A2S failure, desired state running, unchanged monitoring revision/runtime and an owned container. A second Docker inspection prevents a redundant restart when Docker already restarted the process. Unavailable Docker/query configuration, paused containers, intentional stops, startup grace, native operations, server mutations and panel maintenance suppress recovery. The same mutation lock as manual power actions and schedules serializes recovery. Power permission is required to enable or modify an enabled recovery policy.

A restart attempt is persisted before the Docker call. Failed/interrupted attempts consume the limit; toggling settings and restarting the agent do not clear the budget. The common restart service is used, but automatic recovery does not apply pending configuration changes. Activity records the reason and result. Restart completion means that the request completed; a later successful A2S observation confirms game recovery.

## Compatibility / rollout

New capabilities: `monitoringRecovery: 1`, `alertRelay: 1`. Upgrade the panel and agents to enable remote notifications/recovery. Old agents retain ordinary monitoring and the UI hides recovery settings when the response does not advertise support. New agents keep unacknowledged events when paired with an old panel, within retention limits.

Migration `0007_monitoring_alerts` adds notification settings, the event queue, node incident state and restart attempts. No server is opted into automatic restart by migration. Take database/configuration snapshots and retain previous image IDs before deployment; rollback must restore the pre-migration database as well as images.

Protocol sources: [Discord webhook API](https://docs.discord.com/developers/resources/webhook#execute-webhook), [Discord rate limits](https://docs.discord.com/developers/topics/rate-limits).
