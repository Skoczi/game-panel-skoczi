# Game Panel PRO 2.0.57

The server list now places the game icon beside the server name and presents a
single status column. Template authors can select a game icon or upload their own.

## Server list

- Six columns: Server name (with game icon), Server IP, Server status, Server metrics,
  Power and Management. The separate game-name column has been removed.
- When a running server has game monitoring enabled, the game observation, map and
  player count replace the duplicate Running badge. Clicking the status still opens history.
- Stopped servers, runtime errors and unavailable nodes retain their runtime status.
  Servers without monitoring retain their existing status badge.
- Card layouts remain unchanged. Long names wrap within the name column.

## Template icons

- Game Templates → General includes Automatic, a built-in icon library and custom upload.
- Separate icons for CS 1.6, Counter-Strike: Source, CS:GO and CS2; also TF2 and Garry's Mod.
- Game icons are bundled locally from official Steam artwork. No third-party image
  requests are made when opening the panel. Unknown games have a generic gamepad icon.
- Upload PNG, JPEG or WebP up to 2 MiB. The editor converts the image to a 64 × 64 PNG
  stored with the immutable template, including export/import and node installation.
- Templates without an explicit icon keep their existing canonical hashes. Changing
  a template applies to new installations; existing snapshots are not rewritten.

## Updating

Update the panel and node agents to 2.0.57 before installing templates with explicit
icons. Agents advertise `capabilities.templateIcons = 1`; older agents are rejected
before installation is sent. Automatic icons work without changing existing templates.
No new database migration is included. Game containers do not need to restart.
Custom Compose deployments retain their reviewed update procedure and rollback snapshots.

## Validation

Backend template tests cover icon validation, immutable hashes and signed node tickets.
Browser checks cover list and card behavior, icon assets, mobile upload/save, long names,
node scoping and older-agent rejection. Backend and frontend production builds pass.

See [game icon behavior](GAME-ICONS.md) and [artwork sources](../../frontend/public/game-icons/SOURCES.md).
