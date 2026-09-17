# What Skoczi changed

Baseline: [OVHcloud 1.5.0](https://github.com/ovh/game-panel/tree/d0cbfcf19210ef44428c00656a6bbb599fd23861).
Git ancestry is retained so changes can be reviewed.

## Additional IPs, end to end

```text
Administrator: GAMEPANEL_BIND_IPS
       ↓
Authenticated API → Host IPv4 selector
       ↓
Port JSON: { hostIp, host, container, label }
       ↓
Protocol / address / port overlap check → Docker HostIp
       ↓
Connection display and copy actions use the allocation IP
```

| Files | Modification |
|---|---|
| backend/src/utils/bindAddresses.ts | Allowlist and conservative overlap checks |
| backend/src/utils/ports.ts | Optional IP, strict ports, address-aware duplicates |
| backend/src/utils/docker/portBindings.ts | Pure binding builder; preserve multiple mappings |
| backend/src/utils/docker/containers.ts | Pass HostIp; inspect other containers' HostIp |
| backend/src/services/hostPortAvailability.ts | Compare stored and Docker allocations by address/protocol/port |
| backend/src/routes/system.ts | Authenticated address discovery |
| frontend/components/HostIpSelect.tsx | Shared selector; saved IPs never silently cleared |
| Installation/settings components | Preserve hostIp in create/edit payloads |
| App/types/table/card/dialog components | Carry and display full allocation data |
| deploy/lib/render-compose.sh | Pass allowlist to backend container |

## Distribution
Fresh-install telemetry is opt-in. Release metadata points to the fork; automatic updates and upstream updater image pulls are disabled in the preview. UI branding distinguishes the fork. Apache attribution and original changelog remain. Tests and documentation accompany the change.

## Intentionally unchanged
Runtime architecture, authentication model, Docker socket access, permissions, catalogue/providers and general backup implementation are upstream-derived.
This is **not a comprehensive security rewrite** or a replacement for Pterodactyl quotas/tenant isolation.

## Review the diff
```bash
git diff d0cbfcf19210ef44428c00656a6bbb599fd23861..v1.5.0-skoczi.1 -- backend frontend deploy
```

See [limitations](LIMITATIONS.md) and the [release history](../../CHANGELOG-SKOCZI.md).
