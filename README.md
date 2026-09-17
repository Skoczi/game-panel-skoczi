<div align="center">

# Game Panel · Skoczi Edition

**One server workspace · Remote nodes · Per-server access · Panel branding**

[![Skoczi CI](https://github.com/Skoczi/game-panel-skoczi/actions/workflows/skoczi-ci.yml/badge.svg)](https://github.com/Skoczi/game-panel-skoczi/actions/workflows/skoczi-ci.yml)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE-2.0.txt)
![Stage](https://img.shields.io/badge/stage-preview-orange)

[Documentation](docs/skoczi/README.md) · [Po polsku 🇵🇱](docs/skoczi/README.pl.md) · [Releases](https://github.com/Skoczi/game-panel-skoczi/releases) · [Upstream](https://github.com/ovh/game-panel)

</div>

Game server panel built with React, Node.js, SQLite and Docker. Based on **OVHcloud Game Panel 1.5.0**, with host IPv4 selection and separate TCP/UDP port ranges for each address.

**Maintained by Skoczi. Not an official OVHcloud product, release or support channel.** Original authorship and Apache 2.0 notices are preserved. OVHcloud names and marks belong to their respective owners.

## What's different?

| Area | Upstream 1.5.0 | Skoczi preview |
|---|---|---|
| Execution hosts | Panel host | Local runtime + enrolled remote agents |
| Game definitions | Mixed upstream catalogs and code defaults | Root-only Game Templates: versioned definitions, import/export and signed Local/remote installation (schema v1) |
| User workspace | Runtime-local server list | Assigned servers across locations, automatic routing, central access management |
| Node operations | Local runtime | Per-node files, allocations and schedules; HTTP/WebSocket gateway; durable JSON operation journal |
| Port allocation | Host port + container port | Optional **host IPv4** per TCP/UDP binding |
| Same port on different IPs | Port-only conflict checks | Allowed on distinct configured addresses |
| Multiple mappings to one container port | Last binding replaces previous binding | Every binding preserved |
| Game connection address | Panel hostname | Selected allocation IP; legacy hostname fallback |
| Operator control | No bind-IP allowlist | Allowed IPs and TCP/UDP ranges in Settings, enforced by the backend |
| Global settings | No allocation editor | Root-only Settings: IPs, aliases, ranges, server assignments and sidebar visibility |
| Branding | Fixed identity and login footer | Site name, logo, login text/footer and announcements switch, with live preview |
| Telemetry | On by default | **Opt-in** on fresh installs |
| Updates | Upstream one-click updater | Fork release notes; **manual reviewed updates** |
| Validation | Build checks | Regression tests + Linux Docker publishing CI |

Read the [changelog](CHANGELOG-SKOCZI.md), [change map](docs/skoczi/CHANGES.md) and [limitations](docs/skoczi/LIMITATIONS.md).

### Remote nodes

Use **Nodes** to register an agent with a one-time token, then install it on a separate Linux Docker host. No existing games are moved. Each node has its own runtime data and allowed IP/port ranges. [Installation, operation and failure contract](docs/skoczi/NODES.md).

Administrators manage nodes; users open assigned servers without switching hosts. See [Server workspace and access](docs/skoczi/FLEET.md) for permissions and failure behavior. Automatic placement and migration are not implemented. The agent requires verified HTTPS and host-level Docker access.

## Start here

1. Read the [installation guide](docs/skoczi/INSTALLATION.md). Use a fresh, disposable Linux VM.
2. Install the tagged preview; the standard installer provisions Docker and Traefik on **80/443**.
3. Open **Settings** and add IPs/port ranges for addresses already assigned to the host.
4. Select **Host IPv4** during installation or in container configuration.
5. Test a disposable game before moving real workloads.

> The standard installer occupies ports **80/443**. Use a separate test host if those ports already serve other applications. Backend Docker socket access grants host administrative capabilities.

### Additional IPs in one example

Open **Settings → IP allocations**, add an IPv4 and its TCP/UDP ranges, enable restrictions and save. No backend restart is needed. [Settings guide](docs/skoczi/SETTINGS.md).

For first-start environment seeding, `/opt/gamepanel/deploy/.env` can contain:

```dotenv
# Documentation addresses only — replace with your assigned host IPs.
GAMEPANEL_IP_PORTS='{"192.0.2.10":{"tcp":"27015-27030","udp":"27015-27030"},"192.0.2.11":{"tcp":"27015-27020","udp":"27015-27020"}}'
TELEMETRY_ENABLED=false
```

Allocate **192.0.2.10:27015/UDP** and **192.0.2.11:27015/UDP** independently. With this configuration, host port **8080** and wildcard bindings are refused. Container ports are independent of host port ranges.

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

Do not commit deployment configuration, databases, keys or game data. Examples use reserved documentation addresses.

Catalogue/images still depend on upstream/external services. Telemetry off does not mean offline. Backups and game consoles depend on the selected provider: not every feature supports every external image.

## Contributing and attribution

- [Contribution guide](CONTRIBUTING-SKOCZI.md); report fork-specific issues here, not to OVHcloud support.
- Original project: [ovh/game-panel](https://github.com/ovh/game-panel), copyright OVH 2026.
- Modifications: Skoczi, documented in [CHANGELOG-SKOCZI.md](CHANGELOG-SKOCZI.md).
- [Original license notice](LICENSE) · [Full Apache 2.0 terms](LICENSE-2.0.txt) · [NOTICE](NOTICE)
