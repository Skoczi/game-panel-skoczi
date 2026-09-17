# Global settings

**Settings** is visible only to the root administrator. A user with ordinary server or user-management permissions cannot read or change the global configuration through its API.

## IP allocations

1. Add the host IPv4 and an optional label.
2. Enter comma-separated ports or inclusive ranges separately for TCP and UDP, e.g. `27015-27030,28015`.
3. Click **Add to list** (or **Update entry** when editing).
4. Enable **Restrict published ports to these allocations** to enforce ranges and require explicit IP selection.
5. Click **Save changes**.

Blank protocol ranges deny that protocol. An empty restricted list denies all port publishing. With restrictions disabled, legacy Docker-default bindings and unrestricted host ports above 1024 remain available.

The assigned-port table lists stored server bindings, including stopped servers. It does not scan arbitrary host services. Removing an assigned IP or narrowing a range around an assigned port is rejected; first change the server binding. Existing servers are not stopped by a settings save.

This is allocation management, not IP provisioning: configure interfaces, provider routing and firewall rules on the host separately. [Policy details](ADDITIONAL-IPS.md).

## Appearance

- **Show Follow Us** controls the sidebar social links.
- **Show Trustpilot** controls the sidebar review badge.
- Footer: **Game Panel by Skoczi · v&lt;version&gt;**, sourced from the frontend package version.

Visibility updates after saving, on page reload or when another browser tab regains focus. Legal notices remain available. Both sections default to visible on upgrade.

## Storage and upgrades

The backend creates a single-row `panel_settings` SQLite table at startup. On the first run, it imports `GAMEPANEL_IP_PORTS`, or the older `GAMEPANEL_BIND_IPS` list if no port policy exists. Later environment edits do not override saved settings. Settings load before the HTTP listener and task runners start; invalid saved settings fail startup instead of enabling unrestricted publishing.

The panel runs one backend process against its database. Save requests include a revision number. A stale or concurrent save returns **409** and leaves the form available for review; use **Reload** to fetch the newer configuration.

Include the database in backups. Before downgrading to an environment-only version, export/reapply the desired IP policy to its environment; older releases ignore the settings table.

## API

- `GET /api/system/settings` — root only; returns revision, appearance, network and assignments.
- `PUT /api/system/settings` — root only; accepts revision, appearance and network. Validation errors return 400; conflicts return 409.
- `GET /api/system/appearance` — authenticated users; returns only the two visibility switches.
- `GET /api/system/bind-addresses` — authenticated users; current effective IP/port policy for game forms.

Example save body (documentation address):

```json
{
  "revision": 1,
  "appearance": { "showFollowUs": false, "showTrustpilot": false },
  "network": {
    "restrictPorts": true,
    "allocations": [
      { "ip": "192.0.2.10", "alias": "Game node", "tcp": "27015-27030", "udp": "27015-27030" }
    ]
  }
}
```
