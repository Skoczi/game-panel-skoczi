# Limitations and operational boundaries

The fork adds IPv4/port allocation, branding, remote agents and a central server workspace.

## Remote nodes
- Infrastructure administration is root-only; users receive per-server delegation. Automatic placement and migration are not implemented.
- Runtime databases remain node-local. Central IDs, memberships and inventory do not replicate game data. Opening a different server reloads the context; use separate tabs for simultaneous workspaces.
- The panel still has its Local runtime and Docker dependency. Agents reuse the upstream runtime and provider support matrix.
- HTTPS origins, enrollment and explicit IP allocations are required. The agent installer does not configure host networking, TLS or firewalls.
- Durable JSON admission does not mean exactly-once external effects. Interrupted operations can be uncertain. Terminal input and binary transfers are not covered by that journal.
- See [Nodes](NODES.md) for deployment, revocation, retention and outage behavior.

## Networking
- IPv4 selectors only; no IP provisioning, interface management or provider automation.
- No per-user IP ownership/quotas, source-IP routing policy or tenant isolation.
- With port restrictions disabled in Settings, legacy default bindings may publish broadly. Enabled restrictions require explicit allowed IPs and ports.
- Policy changes do not stop running containers. Direct Docker operations and Docker-managed restart policies bypass panel validation; use a host firewall for network-level enforcement.
- Preflight checks panel records and Docker bindings, not every host socket; races may still fail at container creation.
- Game-specific network/firewall behavior requires real client tests.

## Privilege and authentication
- The backend controls the Docker socket. A compromised privileged panel can compromise the host.
- The standard installer creates a user in the Docker group; this is not low-privilege sandboxing.
- Upstream account authentication is retained; scoped agent capabilities and visibility/revocation checks are added, not MFA or an independent hostile-tenant sandbox.
- Do not expose administration to untrusted tenants simply because IP selectors now exist.

## Deployment
- Standard standalone install uses Traefik and ports 80/443. It must not replace an existing production reverse proxy.
- No automatic server migration or shared-volume import.
- Fork automatic updates are disabled. Manual updates require reviewed tags and backups.
- Catalogue, images and optional integrations still contact external services. Telemetry is separately opt-in.

## Providers
Backups, console integration and supported operations vary by provider/image. External Docker images are not guaranteed the same capabilities as native adapters. CPU/RAM settings do not constitute a complete quota/isolation system.

## Verification
Tests cover policy validation, Docker bindings and the IP selector. Full installation, certificate renewal, game protocols and upgrades require testing on a separate host.

Review each CI run and release notes. Test one disposable game on a separate host before production.
