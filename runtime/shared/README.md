# Shared runtime and installer

These are generic Linux amd64 environments for compatible Steam games, not images
containing a particular game or ReHLDS modules. Game-specific recipes live in signed
Game Templates. Games with other dependencies may need a different shared base.

Build on a trusted Linux amd64 Docker builder. Obtain the official Valve SteamCMD
archive, review it and record its SHA-256, then place it here as
`steamcmd_linux.tar.gz` (ignored by Git). Review redistribution terms. A checksum
detects a changed file; it does not establish provenance on its own.

From the repository root:

```sh
docker build --platform linux/amd64 --target runtime \
  -t gamepanel-runtime:linux-v1 runtime/shared
docker build --platform linux/amd64 --target installer \
  --build-arg STEAMCMD_SHA256=YOUR_REVIEWED_SHA256 \
  -t gamepanel-installer:steamcmd-v1 runtime/shared
docker save -o gamepanel-shared-v1.tar gamepanel-runtime:linux-v1 gamepanel-installer:steamcmd-v1
```

Use `--build-arg BASE_IMAGE=debian@sha256:...` with a reviewed digest for release
builds. Package repositories are mutable: build once, record artifact checksum and
image IDs, then distribute that same artifact to each node using `docker load`.
The panel does not pull missing images automatically. Missing images are rejected
before the server or its port reservation is created.

Import `examples/game-templates/cs16-scripted.json` as a draft. It is a **Valve HLDS
example, not ReHLDS**. Its installation and explicit update scripts are editable in
Game Templates → Lifecycle. Startup and variables remain separate. Publish only for
a controlled test after both images are loaded. SteamCMD still downloads game files
from Valve and may update itself. Starting an installed game does not invoke SteamCMD.

For ReHLDS, extend the template's installation script to apply reviewed module
archives with pinned versions and hashes after the HLDS download. Those archives can
come from an operator-controlled artifact service or an optional assets image. Do
not copy the egg's `releases/latest`, blanket chmod, root ownership or destructive
cleanup blindly. Keep existing configurations and module-specific secrets on update.

This recipe is source, not a prebuilt/released image. Validate real installation,
client connection, stop/start, explicit update and file preservation on disposable
servers before rollout. It does not silently migrate or repair existing templates.
