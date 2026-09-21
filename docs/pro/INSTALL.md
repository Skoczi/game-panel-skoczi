# Install Game Panel PRO 2.0.53

No prior OVHcloud Game Panel installation is needed. This release contains the panel, frontend, runtime agent code and its deployment tools. The installer builds our source locally; it does not pull an upstream panel or updater image.

## New Linux host

Use a supported Debian or Ubuntu host with root access, Git and a domain pointing to the host. The installer checks the distribution, installs Docker/Compose when necessary and configures Traefik with Let's Encrypt. Ports 80/443 must be available. Game ports are configured separately. Allow space for source builds, game data and rollback copies. Building the frontend uses a 4 GiB Node heap; allow at least 6 GiB available RAM for the build (8 GiB host RAM recommended when games also run). Runtime memory usage is separate from this build requirement.

```sh
git clone --branch v2.0.53 --depth 1 https://github.com/Skoczi/game-panel-skoczi.git
cd game-panel-skoczi
sudo bash deploy/install.sh
```

Enter the panel domain, administrator username/password and certificate email when prompted. The default root is `/opt/gamepanel`. A non-empty root is rejected; installation never overwrites an existing panel. Telemetry is off unless explicitly enabled.

The installer builds the backend, frontend and local `gamepanel-pro-updater:2.0.53` image. Successful installation requires an HTTP health check. It prints the URL and configuration paths, not the password.

For a different root use `sudo bash deploy/install.sh --app-root /opt/game-panel-pro`. Keep the checkout outside that root. See `deploy/install.sh` for noninteractive `GP_*` inputs; keep passwords out of shell history and source control.

## Upgrade OVHcloud Game Panel 1.5.0

The supported automatic migration is the standard upstream Compose layout:

```text
/opt/gamepanel/
├── app/                 existing source
├── deploy/
│   ├── .env             existing secrets and settings
│   └── compose.yml      backend, frontend, traefik
├── data/                SQLite and panel state
└── servers/             game data
```

Clone the release into a separate directory, then inspect the existing installation:

```sh
sudo python3 deploy/upgrade.py check --app-root /opt/gamepanel --project-name gamepanel
```

This command reads configuration and container metadata without changing the installation. Custom service definitions, build contexts or mounts are rejected. Existing custom WAW deployments need their reviewed deployment procedure; do not force them through this installer.

Finish uploads, installations and backups, and ask other operators to stop making changes before upgrading 1.5.0. The upstream panel does not implement the new maintenance barrier. Keep an independent backup of the installation and game data.

```sh
sudo bash deploy/update.sh --app-root /opt/gamepanel --project-name gamepanel
```

The updater:

1. Preserves existing source, deployment configuration and exact old image IDs, with retention tags.
2. Builds the candidate before stopping the working panel.
3. Checks space and active transfer/install jobs. PRO versions with the maintenance protocol also block new writes and wait for current requests/server operations.
4. Stops only backend/frontend and copies the stopped panel data, including SQLite. Game containers, Traefik and game directories remain in place.
5. Starts the new version and checks backend version/health plus frontend HTTP.
6. Restores the saved source, data, environment and pinned images if switching or health checks fail.

Accounts, password hashes, memberships and existing game records are retained by the database migration. The JWT secret, domain and unrelated settings remain intact. Legacy providers and backup layouts are not silently converted into Native layouts. Review [compatibility](FEATURES.md) before enabling Native backups on an old installation.

## Updates from the panel

Open **Version & changelog**, check GitHub and select **Update to …**. Confirm the target version. The browser may disconnect while backend/frontend restart; do not submit a second update during reconnection. Status survives reload.

The updater accepts published stable `2.0.X` releases only from `Skoczi/game-panel-skoczi`. Each release must include `game-panel-pro-VERSION.tar.gz` and `SHA256SUMS`. The archive is checked before extraction; traversal paths, links and oversized archives are rejected. No upstream updater image is downloaded.

This option is enabled by the standalone installer and supported migration. Installations with remote nodes use coordinated manual updates so the panel cannot silently leave agents behind. Custom deployments stay manual unless adapted and tested. There is no unattended scheduled update.

## Rollback and recovery

The updater prints a snapshot path under `pro-update-backups`. Keep that directory and the rollback image tags. To restore a complete snapshot:

```sh
sudo bash deploy/rollback.sh --app-root /opt/gamepanel --project-name gamepanel \
  --snapshot /opt/gamepanel/pro-update-backups/EXACT-SNAPSHOT-DIRECTORY
```

Rollback restores panel state from the snapshot; later panel changes will no longer be current. The replaced state is retained inside the snapshot for inspection. It does not roll back game files or stop game containers. Do not use `docker compose down -v` or delete recovery journals as an update step.

A hard host interruption can leave the transaction incomplete. Inspect `manifest.json` and run rollback from a complete snapshot before removing `data/.panel-upgrade`. If recovery fails, maintenance remains enabled. Never remove that marker simply to bypass an unresolved recovery failure.

Managed update source and logs are retained in `pro-releases/`. Snapshots contain secrets and are created with private permissions. Copy them securely; never attach them to a GitHub issue.
