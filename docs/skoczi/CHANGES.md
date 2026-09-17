# What Skoczi changed

Baseline: [OVHcloud 1.5.0](https://github.com/ovh/game-panel/tree/d0cbfcf19210ef44428c00656a6bbb599fd23861).
Git ancestry is retained so changes can be reviewed.

## Additional IPs, end to end

```text
Administrator: Settings (database; environment seeded on first startup)
       ↓
Authenticated API → Host IPv4 selector
       ↓
Port JSON: { hostIp, host, container, label } → allowed range check
       ↓
Protocol / address / port overlap check → Docker HostIp
       ↓
Connection display and copy actions use the allocation IP
```

| Files | Modification |
|---|---|
| backend/src/utils/bindAddresses.ts | Allowlist and conservative overlap checks |
| backend/src/utils/portPolicy.ts | Range parsing and backend policy checks |
| backend/src/services/globalSettings*.ts | Persistent settings, allocation usage checks and revision protection |
| frontend/components/GlobalSettings.tsx | Root-only allocation and appearance editor |
| frontend/contexts/BrandingContext.tsx, components/PanelBrand.tsx | Live shared identity, logo, browser title and login appearance |
| backend/src/routes/branding.ts | Public appearance-only endpoint, without allocation data |
| backend/src/utils/ports.ts | Optional IP, strict ports, address-aware duplicates |
| backend/src/utils/docker/portBindings.ts | Pure binding builder; preserve multiple mappings |
| backend/src/utils/docker/containers.ts | Pass HostIp; inspect other containers' HostIp |
| backend/src/services/serverReconfiguration.ts | Validate policy before stopping a running container |
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
No per-user IP ownership, quotas or authentication changes.

## Review the diff
```bash
git diff d0cbfcf19210ef44428c00656a6bbb599fd23861..v1.5.0-skoczi.3 -- backend frontend deploy
```

See [limitations](LIMITATIONS.md) and the [release history](../../CHANGELOG-SKOCZI.md).
# Multi-node additions in Revision 7

- `backend/src/nodes/`: registry, encrypted credentials, one-time enrollment, request signatures, HTTP/WebSocket routing and download capabilities.
- `backend/src/agent/`: enrolled runtime identity and durable JSON mutation admission. Reuses existing OVHcloud runtime providers instead of reimplementing game adapters.
- `backend/src/utils/docker/ownership.ts`: node-specific labels; container/network reconciliation respects ownership.
- `frontend/components/Nodes.tsx`, `NodeSelector.tsx`: registration, status, enable/revoke actions, node allocations and explicit per-tab selection.
- `deploy/agent/agent.py`: scoped build, install, re-enrollment and upgrade; no host proxy/firewall/SSH changes.
- `docs/skoczi/NODES.md`: installation, trust boundaries, failure behavior and preview limitations.
