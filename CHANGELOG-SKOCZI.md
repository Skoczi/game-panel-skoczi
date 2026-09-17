# Skoczi changelog

This file describes **fork changes only**. [CHANGELOG.md](CHANGELOG.md) records upstream releases.

## 1.5.0-skoczi.2 — preview — 2026-09-17

- Added `GAMEPANEL_IP_PORTS`: separate allowed TCP/UDP host port ranges per IPv4.
- Restricted configurations require a concrete IP for every binding; missing protocols deny publishing.
- Backend validates install/edit mappings, Docker creation, panel start/restart and recreation. Recreation checks run before stopping the old container.
- IP selectors show allowed ranges and flag invalid host ports. Saved addresses are not silently changed.
- Added policy parser, bypass, lifecycle, recreation and browser tests. Docker integration now runs with a restricted policy.
- Shortened descriptions and updated English/Polish setup documentation.

Unset `GAMEPANEL_IP_PORTS` preserves the previous allowlist/default behavior. Existing running containers are not stopped when policy changes; direct Docker operations and Docker-managed restarts are outside panel enforcement. No production deployment or database migration is included.

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
IPv4 only; no automatic host networking, IP quotas or outbound source-IP policy.
Preflight does not replace Docker/kernel checks or scan every host process.
Fresh-host installation and game/client acceptance must precede production deployment.
