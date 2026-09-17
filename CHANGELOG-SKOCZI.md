# Skoczi changelog

This file describes **fork changes only**. [CHANGELOG.md](CHANGELOG.md) records upstream releases.

## Revision 9 follow-up — remote realtime and IP dropdown

- Corrected the agent nginx example to proxy both `/api` (WebSocket) and `/api/…` (HTTP). A trailing-slash-only proxy redirects the WebSocket handshake and prevents realtime progress updates.
- Replaced the host IPv4 native select with the shared themed dropdown, including keyboard controls, portal positioning, restricted-default handling and preservation of unavailable saved addresses.

## 1.5.0-skoczi.9 — node settings and login theme (preview) — 2026-09-17

- Reordered navigation to Game Servers, User Administration, Nodes, Panel Settings, Host Status and Resources. Renamed the global settings page to Panel Settings; permission-based visibility is unchanged.

- Moved IP/port allocation editing out of global Settings into **Nodes → Node settings → IP allocations**, including Local. Added a per-node overview and a direct link to its server workspace; appearance remains central.
- Added a panel-wide IP ownership registry, serialized allocation updates, durable reservations and explicit retry of unconfirmed agent writes. Existing allocations are discovered before saving; the same address cannot be newly assigned to another node through the panel. Direct settings writes cannot bypass the coordinator.

- Fixed **Nodes → Local → Open local servers**, including reopening the currently selected administrator runtime. Local needs no additional agent.
- Added root-only node deletion with an exact-name confirmation. Never-enrolled nodes can be removed directly; previously connected nodes must be disabled, reachable and empty. Tracked servers (including missing records) block removal. Tokens are invalidated, audit history retained, and host files/containers are untouched.

- Added a separate login-page theme (Light, Dark or System preference) in Branding & login page, with live preview and no changes to signed-in users' theme preferences. Existing installations retain the light login page.

- Replaced the four workspace filter/sort/group native selects with the shared Resources dropdown, including its selected-state styling, keyboard/typeahead navigation, and light/dark mobile layouts.

- Added personal drag-and-drop server ordering, including keyboard and touch handles.
- Added game/type and status filters, game/type groups, name/type/location/status sorting and reset controls.
- Remembered layout per account in the current browser without changing node placement or other users' views.
- Added catalogue identifiers to fleet metadata, preserving registry identities and existing access assignments.

## 1.5.0-skoczi.8 — server workspace and delegated access — 2026-09-17

- Added one Game Servers workspace across locations. Users see assigned servers and location labels, without node switching or host administration.
- Added central server UUIDs, durable runtime identities, per-server access management and viewer/operator/file-manager presets.
- Added single-server protocol 2 capabilities for remote HTTP, files, console and WebSocket operations. No agent credential reaches the browser; global permissions are not delegated.
- Restricted local and remote server reads, metrics and events to assigned servers. Revocation closes live sockets and invalidates unused download links.
- Added bounded inventory collection with unknown/offline state and no fallback to a different runtime.
- Added identity-reuse, permissions and browser tests; extended real-Docker CI to exercise ordinary users across separate runtimes.
- This release does not move games or implement migration. See [workspace and access](docs/skoczi/FLEET.md).

### Administrator node selector (included from post-Revision 7 patches)

- Replaced the native execution-node select with a custom sidebar dropdown: a host icon in the trigger, status indicators, location labels, selected-state checkmark and a scrollable runtime list.
- Simplified list rows: no host icons, separate name/location/status lines and a shorter pending label for narrow sidebars.
- Added keyboard navigation, type-to-select, outside-click/Escape dismissal and reduced-motion support. Switching still requires confirmation and retains the per-tab runtime boundary.
- Added browser coverage for selection, cancellation, unavailable nodes, Local-only inventory and open mobile/dark menus.

## 1.5.0-skoczi.7 — multi-node administrator preview — 2026-09-17

- Added **Nodes** and a per-tab execution-node selector. Local servers remain on their existing runtime; remote requests never fall back to Local.
- Added one-time enrollment, encrypted per-node credentials, heartbeat status, disabling/re-enrollment and administration audit records.
- Added an agent mode sharing the existing game runtime. Agents own their SQLite databases, files, schedules, allocations and node-labelled Docker containers/networks.
- Added authenticated HTTP streaming, single-use download gateway capabilities and a WebSocket bridge for remote runtime subscriptions and terminal traffic.
- Added durable JSON mutation admission with stable idempotency keys. Interrupted requests become uncertain and are not automatically replayed.
- Added a scoped agent installer, re-enrollment and image upgrade tooling. It does not change host proxy, firewall, SSH or unrelated containers. Fresh agents start with no allowed published ports.
- Added protocol, enrollment, journal, transport and browser tests, plus a real-Docker central/agent CI job.
- Updated the Docker client dependency and its UUID override; production dependency audits report no known vulnerabilities at release verification time.
- Preserved stored branding, users and local server IDs. Node tables are additive; agents refuse databases belonging to another node or unadopted existing servers.

**Scope:** root administrators only for remote nodes. No automatic migration, cross-node user delegation, fleet-wide server table or automatic placement. Provider-specific features retain the upstream support matrix. Read [Nodes](docs/skoczi/NODES.md) before installation; production acceptance tests are a separate step.

## 1.5.0-skoczi.6 — preview — 2026-09-17

- Renamed the fork to **Game Panel · Skoczi Edition**, with a visible **Based on OVHcloud Game Panel** link below the sidebar revision.
- Display versions as **v1.5.0 · Revision 6**; package metadata, tags and update checks retain `1.5.0-skoczi.6`.
- Updated mobile branding and fresh-install defaults. Saved site names, logos, subtitles, login footers and network settings are not overwritten.
- Directed fork issue reports to this repository. Original authorship and license notices remain intact.

## 1.5.0-skoczi.5 — preview — 2026-09-17

- Split the sidebar footer into two lines: **Game Panel by Skoczi**, then **skoczi.0.05**.
- Added compact display revisions (`1.5.0-skoczi.4` → `skoczi.0.04`). Full package versions remain in update checks, the update dialog and the footer tooltip.
- No database or configuration changes.

## 1.5.0-skoczi.4 — preview — 2026-09-17

- Added an announcements switch. When disabled, the carousel is not mounted and the browser does not request news.
- Added site name, subtitle, shared sidebar/login logo, login description and footer text/visibility in Settings, with a preview.
- Logos support HTTPS URLs or PNG/JPEG/WebP uploads up to 256 KiB stored in SQLite. SVG uploads and executable URL schemes are rejected; the backend does not fetch image URLs.
- Site name updates the browser title. Fixed white login branding text being overridden by the UI theme.
- Added public, non-cacheable `GET /api/branding` for the login screen. It exposes appearance only, never IP allocations, accounts or secrets.
- Existing settings receive the new defaults once; IP rules and previous visibility switches are preserved. Branding changes need no rebuild.

**Downgrading to .3 requires the matching database backup:** its settings validator does not understand the new appearance fields. Keep the backup made before upgrading. Legal/license notices and versioned panel attribution remain unchanged.

## 1.5.0-skoczi.3 — preview — 2026-09-17

- Added root-only **Settings** navigation and API.
- Added IP/alias/TCP/UDP allocation editing and a table of saved server bindings.
- Prevented removal or narrowing of allocations used by existing servers.
- Persisted global settings in SQLite, seeded once from the previous environment configuration. Saves apply without restarting the backend.
- Added revision checks to reject concurrent overwrites.
- Added Follow Us and Trustpilot visibility switches; legal notices remain available.
- Changed the footer to **Game Panel by Skoczi** with the package version.
- Added SQLite persistence, policy safety, authorization and browser settings tests.

Upgrade creates `panel_settings`. After initialization, Settings replaces environment values as the source of allocation rules. Back up the database; see [Settings](docs/skoczi/SETTINGS.md) for downgrade notes. No live server deployment is included.

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
