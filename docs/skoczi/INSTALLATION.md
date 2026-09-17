# Installation and manual upgrades

## Before you begin

**Preview: use a fresh test VM.** The standard installer does not integrate with an existing reverse proxy.

The inherited standard installer requires root on systemd-based Debian/Ubuntu, installs Docker/Compose, creates a local `gamepanel` user with Docker group membership (host-admin-equivalent), deploys Traefik on **80/443**, and builds backend/frontend from source. Default installation root: `/opt/gamepanel`.

Do not run it on a host already serving production traffic. A separate database does not isolate Docker or host privileges.

You need a domain, direct DNS resolving to the test host, inbound HTTP/HTTPS and sufficient game resources. The inherited installer checks DNS against the host IP; proxied DNS may fail that check. Enable a CDN later if appropriate. HTTP proxying does not conceal game allocation IPs or erase DNS history.

## Install a pinned preview

Review the script first. On the **fresh test host**:

```bash
sudo apt update
sudo apt install git
git clone --branch v1.5.0-skoczi.8 https://github.com/Skoczi/game-panel-skoczi.git
cd game-panel-skoczi
sudo bash deploy/install.sh --telemetry-disabled
```

Enter your domain, admin credentials and Let's Encrypt email. The project supplies no deployment-specific accounts or secrets.

```bash
sudo docker compose -f /opt/gamepanel/deploy/compose.yml ps
sudo docker compose -f /opt/gamepanel/deploy/compose.yml logs --tail 50 backend frontend
```

Sign in and create one disposable server. Check start/stop, restart, persistence and a real client connection. [Configure additional IPs](ADDITIONAL-IPS.md).

CI tests builds and Docker IP publishing. Test certificate renewal and your chosen games on the target environment.

## Manual upgrades

The in-panel updater is disabled so it cannot launch an upstream updater against a fork installation.

For a future reviewed release:
1. Read release notes and compatibility warnings.
2. Back up database, environment and game data; verify recovery.
3. Fetch tags in a clean source checkout, select the desired fork tag and inspect the diff.
4. On a standard standalone installation only, run `sudo bash deploy/update.sh` from that checkout.
5. Verify panel health and actual game bindings.

The inherited updater creates an update backup, rebuilds and regenerates Compose. **Do not use it blindly for a custom reverse proxy or side-by-side deployment.** Those require a reviewed deployment-specific procedure.

Preserve `GAMEPANEL_BIND_IPS` and `GAMEPANEL_IP_PORTS`. Do not repoint `GAMEPANEL_REPOSITORY_URL` to upstream while depending on fork features. Explicit existing telemetry settings are preserved; review them.

Version 1.5.0-skoczi.3 seeds allocation rules from these environment values once, then stores them in the database. Further edits use **Settings**. Back up the database and review [Settings storage/downgrade notes](SETTINGS.md).

Version .4 adds public branding and extends the stored appearance schema. It preserves existing rules and switches. Downgrading to .3 also requires the corresponding pre-upgrade database backup.

## Rollback

Keep the previous source tag and matching database/configuration backup. An upstream build does not understand the allocation UI and may discard host IPs during later edits.
No automated production rollback is claimed for this first preview. Rehearse recovery on the disposable host.
