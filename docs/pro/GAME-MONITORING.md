# Game monitoring — 2.0.56

This package adds **node-side A2S_INFO checks** for CS 1.6 / ReHLDS and compatible
Source games. Docker status continues to describe the container. Game monitoring
separately describes whether the game responds, its map, player count/capacity and
query latency. It does not execute console commands, restart servers or send external alerts.

## Configuration

Game Templates → Monitoring selects the A2S protocol and a declared UDP port key.
New installations inherit that profile. Existing immutable template snapshots are
not rewritten: Settings → Game monitoring can opt an existing server in and select
one of its allocated UDP ports, without reinstalling it.

Defaults: every 30 seconds, 90 seconds of startup grace, incident after 3 consecutive
failed checks. Allowed ranges: interval 10–300 seconds, grace 0–900 seconds, threshold
1–10. Saving configuration resets pending failures and closes an existing incident
as a configuration change, without claiming that the game recovered.

The backend and managed game containers must share the configured games network.
The worker inspects the actual container IP and uses the selected **container** UDP
port; it does not guess the published host port. This measures node-local game
availability, not public firewall/routing or the connection from a player's location.
No RCON credentials are required.

## State and history

- Before the threshold, the UI shows that the game response is being verified.
- At the threshold, one incident is written to Activity. Repeated failures do not
  flood Activity. A successful A2S response writes one recovery with elapsed time
  since confirmation of the incident. Time includes any intervening observation gap.
- Planned stops, installation/update/restore/backup operations and panel maintenance
  suppress probing. Startup grace follows Docker's actual start time, including
  after recreation. An unexpected stopped/missing container with desired state
  `running` counts as a failed check.
- Docker inspection or missing query configuration/network produces `unavailable`,
  not a false game outage. It resets pending failure counts but preserves an already
  confirmed incident until recovery or intentional suspension.
- Stale observations lose map, player count and latency after `3 × interval + 10`
  seconds. Missing data is never presented as zero players. Legitimate zero-player
  responses are shown as `0 / capacity`.
- SQLite migration `0006_game_monitoring` stores one row per server with configuration,
  revision and latest observation/incident. Server deletion cascades to that row.
  The existing Activity retention still applies (last 100 events per server).

The worker runs on both the local panel runtime and remote agents, regardless of
browser sessions. At most 8 probes run concurrently, with a 5-second Docker timeout
and 2.5-second UDP timeout. Oldest-due servers are preferred; a heavily loaded node
can therefore report stale data rather than claim a recent check. Settings revisions
and runtime rechecks prevent an obsolete in-flight result overwriting new settings.

## Compatibility and validation

Nodes advertise `capabilities.gameMonitoring = 1`. The install UI rejects monitoring
templates on older nodes. Update a runtime agent before enabling monitoring or
expecting the scheduler fixes on its servers. A central-panel update alone does not
upgrade remote runtime agents.
Templates without a monitoring profile retain their canonical representation/hash.

The A2S client handles Source and legacy GoldSrc info, challenge negotiation and
uncompressed split replies. Compressed split replies are explicitly unsupported
and reported as a query error; no automatic recovery action is taken.

Tests cover real local UDP exchanges/challenges/timeouts/splits, outage/recovery
state transitions, SQLite persistence and configuration races, worker concurrency,
maintenance, missing Docker observations, mobile settings and stale UI values.
Live Docker/CS integration still needs a staging node with an actual game server;
the local environment has no available Docker daemon. Before rollout, verify a
custom allocated port, stop/start grace, one actual query failure/recovery and an
agent restart on that staging node.

Protocol references: [Valve's A2S challenge announcement](https://steamcommunity.com/discussions/forum/14/2974028351344359625/)
and [Valve server query specification](https://developer.valvesoftware.com/wiki/Server_queries).
