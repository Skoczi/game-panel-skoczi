# Limitations and operational boundaries

The fork currently changes IPv4/port allocation and release defaults.

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
- Upstream authentication/session/permission architecture is retained. This revision does not add MFA or redesign session revocation.
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
