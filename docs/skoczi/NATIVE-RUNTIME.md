# Native Runtime (preview)

Native templates move game lifecycle orchestration into this fork. Schema 2 stores installation steps, startup arguments and explicit update steps in an immutable, signed template snapshot. The agent runs them locally in Docker. It does not fetch LinuxGSM, an upstream game catalog, or startup scripts from GitHub.

This does **not** make every game independent of its publisher. SteamCMD and game binaries remain Valve software; SteamCMD may update itself during installation/update. A first installation or an explicit update still needs the game's download service. Ordinary start/restart uses files already installed. Existing LinuxGSM/OVH installations keep their existing behavior and dependencies; they are not silently migrated.

## What is implemented

- **Game Templates → Lifecycle** edits startup argv, install/update commands or Bash scripts, a shared installer image, timeouts, working directory and stop signal.
- A step contains either `argv` (legacy direct execution) or `script` (up to 16 KiB of LF-only Bash source). Scripts belong to the immutable, hash-checked, signed template version. The agent copies source into a non-root-owned temporary file inside a fresh maintenance container, then executes `/bin/bash --noprofile --norc -e -u -o pipefail`. Source is not interpolated, placed in process arguments, written to the host filesystem or persisted in the game volume. Read declared variables through quoted environment values such as `"${MAP}"`, not `{{MAP}}`. Scripts are administrator code, not a sandbox for untrusted users. Installer logs remain step-level; do not print credentials.
- Optional `lifecycle.installerImage` selects a shared installation/update environment, independent of `runtime.image` used to run the game. Omit it to retain the old same-image behavior. Both images must be preloaded on the target node. Their Linux/architecture checks and exact image-ID resolution happen **before creating the server or reserving its ports**. Both IDs are saved; explicit updates use the original installer ID and fail closed if it was removed. Images are not silently rebuilt or pulled by the panel.
- Nodes advertise `templateScriptsProtocol: 1`. The UI blocks script/installer-image templates on older agents. Older backend validators also reject the new fields. Existing schema-1 and schema-2 command templates retain their canonical hashes and behavior; no published definition is rewritten.
- Native commands override the image entrypoint and run with a numeric, non-root UID/GID. Arguments are not parsed by a shell. `{{VARIABLE}}` expands once into an argument; port variables always contain the container port, not the public mapped port. Secret variables may be passed as environment values, not argv placeholders.
- Images must already be present on the node. Installation resolves and stores the exact local image ID. Recreation fails if that image is unavailable instead of falling back to a different tag. A first install from a mutable tag still selects whichever bytes are currently loaded on that node: distribute the same reviewed image to all nodes.
- Install/update steps use separate containers with only the server's declared volumes, no published ports or Docker socket, dropped capabilities, no-new-privileges, 2 GiB RAM, two CPU cores and a 256-PID limit. There are at most eight steps per operation; each times out after at most one hour. Networking remains available to download game files; this is not an egress sandbox.
- The running game also has dropped capabilities, no-new-privileges and a 512-PID limit. Its CPU/RAM limits are the instance's configured limits.
- **Server settings → Container Config → Native Runtime** lets a root administrator request an update after stopping the server and confirming a backup. Updates use the installed snapshot and pinned installer image (the exact game image for old servers without a separate installer pin). They leave the server stopped. Installation steps are never replayed by start/restart/recreation.
- Mutating server requests and scheduled operations cannot overlap native maintenance. Timeouts/failures remove the maintenance container, not game data. If cleanup fails, changes remain blocked until agent recovery. On agent restart, interrupted maintenance is stopped, recorded as failed and never automatically replayed. Inspect files and complete an explicit update before starting an interrupted server; failed first installations may need a fresh test instance.
- Activity records step names and outcomes. Raw installer output is not streamed or copied into public errors, and maintenance containers are removed after completion/failure. Game process logs use the existing console. This is step-level reporting, not a live installer terminal.

The local runtime and remote agent use the same path. Agents advertise `nativeRuntimeProtocol: 1`; the UI refuses to send native installs to older agents. Schema 1 remains supported unchanged.

## Build the CS 1.6 runtime

For panel-owned script source and generic shared bases, see [Shared runtime and installer](../../runtime/shared/README.md) and import [Scripted HLDS example](../../examples/game-templates/cs16-scripted.json) as a draft. This separate example does not overwrite the older built-in native template. It downloads Valve HLDS, not ReHLDS modules. Shared base images still need to be built and loaded once per node; they need not contain game-specific installer code.

The separate **Counter-Strike 1.6 · Native (preview)** template is seeded as a **draft**. It installs Valve HLDS, not ReHLDS, AMX Mod X, MetaMod or community modules. It is not a production-ready certification of CS 1.6 support. Verify a real installation and client connection before publishing it for users.

Use a trusted Linux amd64 builder with Docker. Obtain the SteamCMD Linux archive from Valve's official distribution, review its provenance and record its SHA-256. Place it at `runtime/steamcmd/steamcmd_linux.tar.gz` (git-ignored). See [Valve's SteamCMD documentation](https://developer.valvesoftware.com/wiki/SteamCMD). Do not commit or redistribute publisher binaries without reviewing their terms.

Build from the repository root, replacing the example argument with your recorded 64-character checksum:

```sh
docker build --platform linux/amd64 \
  --build-arg STEAMCMD_SHA256=YOUR_RECORDED_SHA256 \
  -t gamepanel-runtime:steamcmd-v1 runtime/steamcmd
docker image inspect gamepanel-runtime:steamcmd-v1 --format '{{.Id}}'
docker save -o gamepanel-runtime-steamcmd-v1.tar gamepanel-runtime:steamcmd-v1
```

The build verifies the supplied archive's checksum; it does not authenticate an archive from an untrusted source. `BASE_IMAGE` can be overridden with a reviewed Debian Bookworm digest. Base OS packages are installed during the build, not game startup. Rebuilding from mutable package repositories is not guaranteed to produce identical bytes; distribute and retain the built image artifact and its checksum.

Load that same artifact on **each intended node**, then compare image IDs:

```sh
docker load -i gamepanel-runtime-steamcmd-v1.tar
docker image inspect gamepanel-runtime:steamcmd-v1 --format '{{.Id}}'
```

The recipe is our repository-owned `runtime/steamcmd/cs16-install.sh`. It runs the local SteamCMD executable for app 90 / `cstrike`, bounds retries at three, and checks for the server binary, game library and default map. It does not fetch third-party appmanifest files. Installation uses Steam validation; the update step intentionally omits `validate`, but updates can still replace files. **Take a backup before updating.** No automatic game-file rollback is implemented.

Startup directly executes `/data/hlds_linux`, not LinuxGSM or `hlds_run`. `MAP` and `MAX_PLAYERS` are configurable environment-backed arguments. The profile publishes one UDP game port. Additional game configuration, including RCON, remains in the game's configuration files. SteamCMD caching is not an offline game repository.

## Trust and limits

Publishing a native template grants execution of its reviewed commands **inside that server's container**. This is administrator-controlled code, not a safe format for blindly importing untrusted recipes. Bash scripts are stored in the panel; command steps can still use helpers packaged in reviewed images. Review recipes before publishing, quote input values, pin artifact versions and checksums, and avoid fetching executable scripts from mutable remote URLs. Imported documents are always drafts and never execute at import time.

Pterodactyl egg scripts are not drop-in compatible: change `/mnt/server` to the declared data mount, remove root-only ownership/package installation (put dependencies into the shared installer image), and replace blanket `chmod 777`, destructive cleanup and moving `latest` downloads. Startup variables stay in the runtime environment; sensitive values must be secret variables, never hardcoded script text. An explicit update must preserve existing configuration and secrets. Publisher download services such as Steam remain required for installation/update.

No automatic conversion of eggs, migration of LinuxGSM data, per-variable user edit permissions, managed ReHLDS releases, game binary mirror, signed artifact registry, live installer log viewer, or automatic rollback is included in this preview. Docker Engine administrators can bypass panel locks; one agent process must own each runtime database.

## Acceptance tests before production

1. Install a disposable native template on Local and a remote node. Verify image ID, effective user, exact command and node-owned volumes.
2. Stop/start and restart without access to external catalogs. Check that install markers/files are not recreated.
3. Stop the game, back up its files, run explicit update and check Activity. It must remain stopped.
4. Exercise installer failure, timeout, agent interruption, concurrent update/power/delete and a moved/missing image tag. No foreign containers or existing game data may be removed.
5. For HLDS: verify actual client connection, query/RCON, selected public port, map/slot settings and persistence. Generic Docker tests do not prove game compatibility.
