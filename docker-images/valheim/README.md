# Valheim Docker Image

This directory contains the Valheim dedicated server image used by OVHcloud Game Panel.

The image installs and runs a Valheim dedicated server through SteamCMD (Steam app id `896660`).

## ✅ Capabilities

| Capability | Support |
| --- | --- |
| Console commands | Not supported |
| Hot backup while running | Native (game-managed) |
| Cold backup while stopped | Not supported |
| Restores | Supported |
| Health check | Supported |
| Mods | BepInEx (server-side), via `/app/install-bepinex.sh` |

## ⚙️ Runtime model

Important paths:

- `/data`: persistent data path;
- `/data/server`: Valheim installation directory (SteamCMD);
- `/data/save`: world saves and the game's automatic backups (`-savedir`; both are directories under `worlds_local/`);
- `/run/valheim`: temporary runtime state.

Default exposed ports:

- `2456/udp` (game)
- `2457/udp` (Steam query / A2S)

With `-crossplay` the players reach the server through the PlayFab relay instead, so the game port
is never bound and neither port needs to be published.

Valheim has no configuration file: every option is a launch argument, built by the image from
the runtime inputs below. The server binary ships its shared libraries in `./linux64` (no rpath)
and initializes Steamworks with the *client* app id, so the launcher sets `LD_LIBRARY_PATH` and
`SteamAppId=892970` from the install directory, exactly like the bundled `start_server.sh`. On
shutdown the launcher sends `SIGINT` so the world is saved.

## 🔧 Runtime inputs

Boolean inputs accept `true` / `false` (and `1`, `yes`, `on` / `0`, `no`, `off`), case-insensitive.

| Input | Default | Allowed values | Purpose |
| --- | --- | --- | --- |
| `VALHEIM_SERVER_NAME` | `Valheim server` | any string | Server name shown in the community browser (`-name`). |
| `VALHEIM_WORLD_NAME` | `Dedicated` | any string | World save name (`-world`); a new world is generated if it does not exist. |
| `VALHEIM_SERVER_PASSWORD` | *(empty)* | min 5 chars when set | Join password (`-password`). **Required when `VALHEIM_PUBLIC=1`** (the container refuses to start otherwise); optional (may be empty) when `VALHEIM_PUBLIC=0`. Not generated. |
| `VALHEIM_PUBLIC` | `1` | `0`, `1` | Community browser visibility (`-public`): `1` listed (password required), `0` not listed / joinable by IP. |
| `VALHEIM_PORT` | `2456` | `1024`–`65535` | UDP game port (`-port`). |
| `VALHEIM_START_PARAMS` | *(empty)* | any launch args | Extra raw launch arguments (e.g. `-crossplay`, `-preset`, `-modifier ...`, `-backups`/`-backupshort`/`-backuplong`). Values must not contain spaces. |
| `VALHEIM_UPDATE_ON_START` | `false` | boolean | Run a SteamCMD update on every start. |
| `VALHEIM_VALIDATE_ON_START` | `false` | boolean | Validate installed files via SteamCMD on start. |
| `HEALTHCHECK_REQUIRE_BIND` | `true` | boolean | Require the UDP game port to be bound for the container to be healthy. |
| `HEALTHCHECK_PORT` | `2456` | `1024`–`65535` | UDP game port the health check expects the server to bind. With `-crossplay` it expects the Steam query port (`+ 1`) instead, the only port the server still binds. |
| `STOP_TIMEOUT_SECONDS` | `60` | integer seconds | Grace period after `SIGINT` before the server is force-killed on stop. |

## 🛠️ Operational scripts

| Script | Purpose |
| --- | --- |
| `/app/restore.sh <backup-name>` | Restores a native backup (a `<name>` directory from `worlds_local/`) as the current world; the server must be stopped. The world directory is **replaced**, since a leftover newer generation is the one the game would load back. Refuses a backup holding no complete generation (no `_main.<n>.ok`). Staging + rollback on failure. |
| `/app/install-bepinex.sh [version]` | Installs/updates the BepInEx mod loader (BepInExPack for Valheim, from Thunderstore) into the install directory; the server must be stopped. `version` defaults to `latest`. |
| `/app/healthcheck.sh` | Reports container health to Docker. |

The dedicated server has no native command interface, so there is no `send-command` script;
admin actions are performed in-game by players listed in `adminlist.txt`.

**Backups are managed by the game itself.** Valheim writes automatic, timestamped world backups
(`<world>_backup_auto-<timestamp>/` directories) into `worlds_local/`, next to the world itself,
tunable through the `-backups` / `-backupshort` / `-backuplong` launch arguments (via
`VALHEIM_START_PARAMS`). Each one is a full copy of the last generation the game flushed to disk,
so there is no point in triggering a backup on demand.

## 🧩 Mods

Mods are **not installed by default**. Install the **BepInEx** mod loader on demand with
`/app/install-bepinex.sh [version]` (server stopped); it downloads the BepInExPack for Valheim from
Thunderstore into the install directory. When BepInEx is present, the launcher automatically enables
it (via Unity Doorstop) at startup. Mod `.dll` files go in `BepInEx/plugins/`, their configs in
`BepInEx/config/`. A restart is required for changes to take effect.
