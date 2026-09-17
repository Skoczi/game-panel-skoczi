# Skoczi changelog

This file describes **fork changes only**. [CHANGELOG.md](CHANGELOG.md) records upstream releases.

## 1.5.0-skoczi.1 — preview — 2026-09-17

Base: OVHcloud Game Panel **1.5.0**, commit `d0cbfcf19210ef44428c00656a6bbb599fd23861`.

### Added
- Optional `hostIp` for every TCP/UDP mapping, persisted in existing port JSON.
- Administrator-maintained `GAMEPANEL_BIND_IPS` IPv4 allowlist.
- Authenticated address discovery, installation/settings selectors and allocation-aware address copying.
- Regression tests, opt-in Linux Docker integration CI, English documentation and Polish overview.
- Browser component tests for IP selection, missing addresses and API errors.

### Fixed
- Distinct IPs can reuse a protocol/port; wildcard overlaps remain conflicts.
- Multiple host bindings to one container port are appended rather than overwritten.
- Strict integer port parsing rejects booleans, floats and trailing junk.
- Host IPs survive JSON storage and edits/recreation.

### Changed
- Independent fork identity in login/navigation/page title.
- Fork release metadata; one-click updates explicitly disabled during preview.
- Install/update scripts no longer pull upstream updater images for fork versions.
- Telemetry defaults off. Existing explicit telemetry choices are preserved.
- Full Apache license included, original copyright preserved, modifications identified.

### Compatibility
No database schema migration. Missing hostIp preserves legacy Docker default behavior.
IPv4 only; no automatic host networking, IP quotas, outbound source-IP policy or Pterodactyl migration.
Preflight does not replace Docker/kernel checks or scan every host process.
Fresh-host installation and game/client acceptance must precede production deployment.
