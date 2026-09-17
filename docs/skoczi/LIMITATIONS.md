# Limitations and operational boundaries

This is a feature preview, not a hardened hosting platform or an independent security audit.

## Networking
- IPv4 selectors only; no IP provisioning, interface management or provider automation.
- No per-user IP ownership/quotas, source-IP routing policy or tenant isolation.
- Legacy default bindings may publish broadly. The allowlist does not prohibit the legacy option.
- Preflight checks panel records and Docker bindings, not every host socket; races may still fail at container creation.
- Game-specific network/firewall behavior requires real client tests.

## Privilege and authentication
- The backend controls the Docker socket. A compromised privileged panel can compromise the host.
- The standard installer creates a user in the Docker group; this is not low-privilege sandboxing.
- Upstream authentication/session/permission architecture is retained. This revision does not add MFA or redesign session revocation.
- Do not expose administration to untrusted tenants simply because IP selectors now exist.

## Deployment
- Standard standalone install uses Traefik and ports 80/443. It must not replace an existing production reverse proxy.
- No automatic Pterodactyl migration, shared-volume import or production rollback promise.
- Fork automatic updates are disabled. Manual updates require reviewed tags and backups.
- Catalogue, images and optional integrations still contact external services. Telemetry is separately opt-in.

## Providers
Backups, console integration and supported operations vary by provider/image. External Docker images are not guaranteed the same capabilities as native adapters. CPU/RAM settings do not constitute a complete quota/isolation system.

## Verification
Unit/mocked tests and Linux Docker binding CI cover the added allocation behavior. They do not certify the complete root installer, certificate renewal, game installs, UDP gameplay, load behavior or all upgrade paths.

Review each CI run and release notes. Test one disposable game on a separate host before production.
