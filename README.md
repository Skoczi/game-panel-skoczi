<div align="center">

# OVH Game Panel by Skoczi

**Independent community fork · Explicit IP allocations · Documented changes**

[![Skoczi CI](https://github.com/Skoczi/game-panel-skoczi/actions/workflows/skoczi-ci.yml/badge.svg)](https://github.com/Skoczi/game-panel-skoczi/actions/workflows/skoczi-ci.yml)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE-2.0.txt)
![Stage](https://img.shields.io/badge/stage-preview-orange)

[Documentation](docs/skoczi/README.md) · [Po polsku 🇵🇱](docs/skoczi/README.pl.md) · [Releases](https://github.com/Skoczi/game-panel-skoczi/releases) · [Upstream](https://github.com/ovh/game-panel)

</div>

Manage game servers through a React dashboard backed by Node.js, SQLite and Docker. Based on **OVHcloud Game Panel 1.5.0**, this fork adds operator-managed IPv4 allocations while keeping its differences easy to review.

**Maintained by Skoczi. Not an official OVHcloud product, release or support channel.** Original authorship and Apache 2.0 notices are preserved. OVHcloud names and marks belong to their respective owners.

## What's different?

| Area | Upstream 1.5.0 | Skoczi preview |
|---|---|---|
| Port allocation | Host port + container port | Optional **host IPv4** per TCP/UDP binding |
| Same port on different IPs | Port-only conflict checks | Allowed on distinct configured addresses |
| Multiple mappings to one container port | Last binding replaces previous binding | Every binding preserved |
| Game connection address | Panel hostname | Selected allocation IP; legacy hostname fallback |
| Operator control | No bind-IP allowlist | Backend-validated `GAMEPANEL_BIND_IPS` |
| Telemetry | On by default | **Opt-in** on fresh installs |
| Updates | Upstream one-click updater | Fork release notes; **manual reviewed updates** |
| Validation | Build checks | Regression tests + Linux Docker publishing CI |

Read the [changelog](CHANGELOG-SKOCZI.md), [change map](docs/skoczi/CHANGES.md) and [limitations](docs/skoczi/LIMITATIONS.md). Nothing automatically migrates existing Pterodactyl servers.

## Start here

1. Read the [installation guide](docs/skoczi/INSTALLATION.md). Use a fresh, disposable Linux VM.
2. Install the tagged preview; the standard installer provisions Docker and Traefik on **80/443**.
3. Add already-configured host addresses to the allowlist.
4. Select **Host IPv4** during installation or in container configuration.
5. Test a disposable game before moving real workloads.

> **Do not run the standard installer on an existing Pterodactyl/Nginx/production host.** It is not an isolated side-by-side installer. Backend Docker socket access is effectively host administrative access.

### Additional IPs in one example

In the installed panel's `/opt/gamepanel/deploy/.env`:

```dotenv
# Documentation addresses only — replace with your assigned host IPs.
GAMEPANEL_BIND_IPS=192.0.2.10,192.0.2.11
TELEMETRY_ENABLED=false
```

Allocate **192.0.2.10:27015/UDP** and **192.0.2.11:27015/UDP** independently. A wildcard binding on that UDP port overlaps both.

This publishes Docker ports; it does **not** provision provider IPs, MACVLANs, routing, virtual MACs, firewall rules or outbound source IPs. See the [complete IP guide](docs/skoczi/ADDITIONAL-IPS.md).

## Development

Node.js 22 LTS and npm; Linux Docker only for the opt-in integration test.

```bash
git clone https://github.com/Skoczi/game-panel-skoczi.git
cd game-panel-skoczi/backend
npm ci --ignore-scripts
npm test
npm run build
cd ../frontend
npm ci --ignore-scripts
npm run build
```

These build/test commands do not run the backend's native SQLite/bcrypt modules. A full runtime needs their normal installation steps; read [Development](docs/skoczi/DEVELOPMENT.md).

## Scope and privacy

Generic source and documentation only: no server configuration, deployment databases, certificates, SSH keys or game data. Never post credential-bearing logs or screenshots. Examples use reserved documentation addresses.

Catalogue/images still depend on upstream/external services. Telemetry off does not mean offline. Backups and game consoles depend on the selected provider: not every feature supports every external image.

## Contributing and attribution

- [Contribution guide](CONTRIBUTING-SKOCZI.md); report fork-specific issues here, not to OVHcloud support.
- Original project: [ovh/game-panel](https://github.com/ovh/game-panel), copyright OVH 2026.
- Modifications: Skoczi, documented in [CHANGELOG-SKOCZI.md](CHANGELOG-SKOCZI.md).
- [Original license notice](LICENSE) · [Full Apache 2.0 terms](LICENSE-2.0.txt) · [NOTICE](NOTICE)
