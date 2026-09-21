# Game Panel PRO 2.0.53

- Renamed Startup & Settings to Settings, including the settings heading and modal navigation.
- Added Delete server at the bottom of Settings, gated by server.delete. Confirm the exact server name before removing its runtime, files and local backups.
- Successful deletion returns to the shared fleet with the chosen node scope. Remote deletion retains the global server identity and node routing.
- Permission failures remain visible; an unconfirmed deletion requires checking the fleet before another attempt.

Panel update only. Agents 2.0.52 are compatible; no agent or game restart is required. No database migration.
