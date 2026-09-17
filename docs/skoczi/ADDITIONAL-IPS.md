# Additional IPv4 addresses

## Scope

Each TCP/UDP mapping can select a host IPv4 independently of the panel's domain. Docker publishes the port on that address.

IPs must **already exist on the Docker host**, including persistence, provider routing/virtual MAC requirements and firewall rules. The backend container cannot reliably discover host interfaces, so the operator maintains an allowlist.

This feature does not configure MACVLANs, netplan/networkd, firewalls, provider IP assignments, outbound routing or source IPs.

## Configure

Examples use reserved documentation addresses. Substitute your assigned host IPs.

1. Verify them on the host with `ip -br address`.
2. Use `sudoedit /opt/gamepanel/deploy/.env`:
   ```dotenv
   GAMEPANEL_BIND_IPS=192.0.2.10,192.0.2.11
   ```
3. Apply the backend environment:
   ```bash
   sudo docker compose -f /opt/gamepanel/deploy/compose.yml up -d --no-deps --no-build backend
   ```
4. Reload the page, then open installation or **Container configuration → Ports → Host IPv4**.
5. Select IPs for both protocols as required. Save and follow the existing recreation confirmation: changing bindings can interrupt a running game.

Custom deployments must pass the variable into the **backend container**, not merely the host shell. Do not edit generated Compose output.

## Rules

| Existing | Requested | Result |
|---|---|---|
| 192.0.2.10:27015 UDP | 192.0.2.11:27015 UDP | Allowed |
| 192.0.2.10:27015 UDP | 192.0.2.10:27015 UDP | Conflict |
| 192.0.2.10:27015 UDP | 192.0.2.10:27015 TCP | Allowed |
| Wildcard:27015 UDP | 192.0.2.11:27015 UDP | Conflict |
| 192.0.2.10:27015 UDP | Wildcard:27015 UDP | Conflict |

Saved allocations (including stopped servers) and inspected Docker bindings are checked, excluding the edited server. Host-network containers and arbitrary host processes are not fully scanned. Docker/kernel remain authoritative, including concurrent request races.

**Docker default** omits HostIp, preserving legacy behavior: usually all interfaces, subject to Docker/network defaults. Preflight conservatively treats missing IP, `0.0.0.0`, `::` and IPv4-mapped IPv6 as overlaps. IPv6 selection is not supported.

The allowlist is global, not per-user allocation/quota enforcement. Users with install/edit permissions can select any allowed IP or the legacy default. This is not untrusted-tenant network isolation.

## API

Existing authenticated create/edit APIs accept this ports fragment:

```json
{
  "ports": {
    "tcp": [{ "hostIp": "192.0.2.10", "host": 27015, "container": 27015, "label": "Game TCP" }],
    "udp": [{ "hostIp": "192.0.2.10", "host": 27015, "container": 27015, "label": "Game UDP" }]
  }
}
```

Omit hostIp or use an empty string for legacy behavior. Arbitrary IPs, wildcard strings, CIDRs, hostnames and IPv6 are rejected. Host ports still must exceed 1024.

Authenticated `GET /api/system/bind-addresses` returns:
```json
{ "addresses": ["192.0.2.10", "192.0.2.11"] }
```

No schema migration is needed. Removing an allowlisted address does not revoke existing bindings; the UI retains the saved address, and attempts to resave it fail until corrected.

## Verify

For the exact game container:

```bash
sudo docker inspect CONTAINER_NAME --format '{{json .HostConfig.PortBindings}}'
```

Check HostIp for TCP and UDP. Test from another machine with the actual game client. Inspection alone does not verify routing, firewall or game readiness.

## Troubleshooting

- **No options:** check the backend environment, recreate backend, reload UI.
- **Not configured:** restore the saved IP to the allowlist or explicitly choose a valid IP.
- **Unexpected conflict:** a wildcard or stopped server may reserve the allocation.
- **Cannot assign requested address:** an allowlist entry does not provision the IP on the host.
- **Game unreachable:** check provider routing, persistent addresses and firewall. Games normally listen on container interfaces/0.0.0.0, not host public IPs.
- **CDN:** ordinary HTTP proxying does not carry arbitrary game TCP/UDP. Explicit allocations show direct game IPs; legacy bindings retain hostname fallback.
- **Conservative suggested port:** upstream automatic suggestions remain global. After choosing a different IP, manually enter the desired port; the backend check is address-aware.
