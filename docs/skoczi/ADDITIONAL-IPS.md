# Host IPs and allowed ports

Each TCP/UDP mapping selects a host IPv4 and host port. The container port is independent. Addresses must already be configured on the Docker host, including persistent interfaces and provider routing. The panel does not provision IPs or firewall rules.

## Configure per-IP ranges

On a standard installation, edit `/opt/gamepanel/deploy/.env`:

```dotenv
GAMEPANEL_IP_PORTS='{"192.0.2.10":{"tcp":"27015-27030,28015","udp":"27015-27030"},"192.0.2.11":{"udp":"28015-28020"}}'
```

Replace documentation addresses with assigned host IPs. Each protocol accepts comma-separated ports and inclusive ranges within **1025–65535**.

- First IP: TCP 27015–27030 and 28015; UDP 27015–27030.
- Second IP: UDP 28015–28020; no TCP publishing.
- Host port 8080 is refused on both. A permitted host port can still map to container port 8080.

Apply the environment and reload the panel:

```bash
sudo docker compose -f /opt/gamepanel/deploy/compose.yml up -d --no-deps --no-build backend
```

The Compose file must contain the new variable (new installs and the fork updater render it). For custom deployments, pass `GAMEPANEL_IP_PORTS` into the **backend container**. Setting it only in the host shell has no effect.

Open installation or **Container configuration → Ports → Host IPv4**. Select an IP for each mapping. The UI shows allowed ports for that protocol; the backend rejects invalid requests even if the UI is bypassed.

## Policy rules

| Configuration | Result |
|---|---|
| `GAMEPANEL_IP_PORTS` is unset or blank | Legacy behavior: optional IP from `GAMEPANEL_BIND_IPS`; no per-IP range restrictions |
| Valid JSON policy | Its keys replace `GAMEPANEL_BIND_IPS`; explicit IP required on every published port |
| Missing protocol or empty string | That protocol is denied on the IP |
| `{}` | No port publishing allowed |
| Invalid JSON, address or range | Validation fails; no unrestricted fallback |

Wildcards, IPv6, CIDRs, hostnames, reversed ranges, noninteger ports and unknown protocol keys are rejected. IP/port rules are shared across panel users; there are no per-user allocations.

Checks apply to install/edit mappings, Docker container creation, recreation, and panel start/restart. Recreation validates before stopping the old container. **Changing policy does not stop existing running containers.** Correct old bindings before their next panel start/restart or recreation. Direct Docker commands and Docker-managed automatic restarts do not pass through panel validation. Use host firewall rules if network-level enforcement is required.

Without the new policy, legacy **Docker default** remains available and usually binds all interfaces. Use `GAMEPANEL_IP_PORTS` to prohibit that option. No database migration is required; addresses are stored in existing port JSON.

## Conflicts

The same port can be used on two distinct IPs, and TCP and UDP are independent. A duplicate IP/protocol/port or overlapping wildcard is refused. Saved allocations, including stopped servers, and inspected Docker bindings are checked; the edited server is excluded.

Host-network containers and arbitrary host processes are not fully scanned. Docker/kernel checks still handle actual bind conflicts and concurrent requests.

## API

The authenticated create/edit APIs accept:

```json
{
  "ports": {
    "tcp": [{ "hostIp": "192.0.2.10", "host": 27015, "container": 8080, "label": "Game TCP" }],
    "udp": [{ "hostIp": "192.0.2.10", "host": 27015, "container": 27015, "label": "Game UDP" }]
  }
}
```

`GET /api/system/bind-addresses` requires authentication and returns parsed rules:

```json
{
  "addresses": ["192.0.2.10"],
  "requireExplicitIp": true,
  "portsByIp": {
    "192.0.2.10": {
      "tcp": [{ "from": 27015, "to": 27030 }],
      "udp": []
    }
  }
}
```

In legacy mode, `requireExplicitIp` is `false` and `portsByIp` is `null`.

## Verify and troubleshoot

Inspect the exact container, then test with a real client from another machine:

```bash
sudo docker inspect CONTAINER_NAME --format '{{json .HostConfig.PortBindings}}'
```

- **No addresses:** check the backend environment, recreate the backend and reload the page.
- **Not configured:** restore the saved IP to the policy or select a permitted one. The UI never silently replaces it.
- **Port outside range:** check the host port and protocol, not the container port. Automatic port suggestions are not policy-aware; enter a permitted port manually.
- **Conflict:** a stopped server or wildcard binding may reserve the allocation.
- **Cannot assign address:** adding an IP to the policy does not configure it on the host.
- **Unreachable game:** check provider routing, persistent addresses and firewall. Games normally listen on container interfaces, not the host's public IP.
- **CDN:** an ordinary HTTP proxy does not carry arbitrary game TCP/UDP traffic.
