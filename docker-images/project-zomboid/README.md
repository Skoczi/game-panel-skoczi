# Project Zomboid Docker Image

This directory contains the Project Zomboid dedicated server image used by OVHcloud Game Panel.

The image installs and runs a Project Zomboid dedicated server through SteamCMD (Steam app id
`380870`). The server ships its own bundled JRE and is launched through its `start-server.sh`.

## ✅ Capabilities

| Capability | Support |
| --- | --- |
| Install / update via SteamCMD | Supported (with automatic retry on the transient SteamCMD "Missing configuration" error) |
| Steam branch selection | Supported (via `PZ_BRANCH`) |
| Console commands | Supported (stdin, via `/app/send-command.sh`) |
| Hot backup while running | Supported |
| Cold backup while stopped | Supported |
| Restores | Supported (server must be stopped) |
| Health check | Supported |
| Mods | Supported (Steam Workshop; panel-managed) |

## ⚙️ Runtime model

Important paths:

- `/data`: persistent data path;
- `/data/server`: Project Zomboid installation directory (SteamCMD);
- `/data/zomboid`: server runtime data, relocated via `-cachedir` (config `Server/`, saves `Saves/`,
  player DB `db/`, logs `Logs/`, the game's own native backups under `backups/`, and `mods/` for
  local/manual mods — created at startup so the game's mod watcher does not error);
- `/backups`: panel-managed backup archives (see Operational scripts);
- `/run/project-zomboid`: temporary runtime state (stdin FIFO, PID file).

Default exposed ports:

- `16261/udp` (game)
- `16262/udp` (direct/Steam)

The server is a supervised Java process launched through `start-server.sh`. Its console reads from a
stdin FIFO, so on shutdown the launcher sends the `quit` command (which saves the world and exits)
before falling back to a forced kill after `STOP_TIMEOUT_SECONDS`.

Project Zomboid requires an admin password to start non-interactively: `PZ_ADMIN_PASSWORD` is passed
to the server as `-adminpassword` at launch (the container refuses to start if it is empty).

## 🔧 Runtime inputs

Boolean inputs accept `true` / `false` (and `1`, `yes`, `on` / `0`, `no`, `off`), case-insensitive.

| Input | Default | Allowed values | Purpose |
| --- | --- | --- | --- |
| `PZ_ADMIN_PASSWORD` | *(required)* | any string | Admin account password (`-adminpassword`). The container refuses to start if empty. |
| `PZ_ADMIN_USERNAME` | `admin` | any string | Admin account username (`-adminusername`). |
| `PZ_SERVERNAME` | `servertest` | any string | Server config-set identifier (`-servername`); determines the config file prefix (`servertest.ini`, …). Not the browser display name. |
| `PZ_BRANCH` | *(none)* | e.g. `unstable` | Steam beta branch (`-beta`). |
| `PZ_START_PARAMS` | *(empty)* | any launch args | Extra arguments appended to `start-server.sh`. Values must not contain spaces. |
| `PZ_UPDATE_ON_START` | `false` | boolean | Run a SteamCMD update on every start. |
| `PZ_VALIDATE_ON_START` | `false` | boolean | Validate installed files via SteamCMD on start. |
| `HEALTHCHECK_PORT` | `16261` | `1024`–`65535` | UDP game port the health check expects the server to bind. |
| `HEALTHCHECK_REQUIRE_BIND` | `true` | boolean | Require the UDP game port to be bound for the container to be healthy. |
| `STOP_TIMEOUT_SECONDS` | `90` | integer seconds | Grace period after `quit` before the server is force-killed on stop. |

## 🛠️ Operational scripts

| Script | Purpose |
| --- | --- |
| `/app/send-command.sh <command>` | Sends a command to the running server console (via stdin), e.g. `players`, `save`, `servermsg`. |
| `/app/backup.sh` | Creates a timestamped `.tar.gz` in `/backups` of the world (`Saves/Multiplayer/<servername>`), the user DB (`db/<servername>.db`) and the server config (`Server/`). Hot (`save` + flush) if the server is running, cold otherwise. Excludes the game install and `Workshop/`. |
| `/app/restore.sh <backup>` | Restores a backup archive over the current world/DB/config (staging + rollback on failure). Requires the server to be stopped; does not stop/start it. |
| `/app/resolve-mods.sh <workshopId…>` | Downloads the given Steam Workshop items via SteamCMD (one batched session) and prints a JSON array `[{ "workshopId", "modIds":[…] }]` resolved from each item's `mod.info`. Used by the panel to link Workshop ids to their internal mod ids. Downloaded payloads are pruned afterwards; the Steam client cache is kept under `/data/.gamepanel/steamcmd` for warm restarts. |
| `/app/healthcheck.sh` | Reports container health to Docker. |

## 🧩 Mods

Project Zomboid mods come from the **Steam Workshop**. The active mod list is configured in the server
config (`<servername>.ini`) through two related keys:

- `WorkshopItems=` — the numeric Steam Workshop item ids to download;
- `Mods=` — the internal mod-folder ids the game actually loads (one Workshop item can provide several).

The panel manages this list (it writes both keys from a single source of truth,
`/data/.gamepanel/pz-mods.json`) — edit it while the server is stopped, since Project Zomboid rewrites
its config files on shutdown. When mods are added, the panel resolves each Workshop id to its internal
mod id(s) automatically via `/app/resolve-mods.sh` (so the user only supplies Workshop ids). On start,
the dedicated server downloads the configured Workshop items automatically, and connected clients sync
them. `/data/zomboid/mods` holds local/manual mods.

To keep the first mod resolution fast, the entrypoint pre-warms the SteamCMD client cache under
`/data/.gamepanel/steamcmd` once on first boot (gated on a `.prewarmed` marker, masked by the initial
install); later boots skip it.

A restart is required for changes to take effect.
