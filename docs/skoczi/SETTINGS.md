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
- **Show announcements** controls the news carousel. Disabled means no browser news request, not just a hidden banner.
- Footer: **Game Panel by Skoczi**, with the compact revision on a separate line below (e.g. **skoczi.0.05**). It is derived from the package version; the full technical version remains in the tooltip and update dialog.

Visibility updates after saving, on page reload or when another browser tab regains focus. Legal notices remain available. Both sections default to visible on upgrade.

## Branding & login page

- **Site name** (required, max. 80 characters) appears in the sidebar, login heading and browser tab title.
- **Subtitle** (max. 120) appears below the name. Leave it blank to hide it.
- **Login description** and **Login footer text** accept up to 240 characters each. Empty text hides that line; **Show login footer** can hide the footer independently.
- **Logo** is shared by the sidebar and login screen. Use an HTTPS image URL or upload PNG, JPEG or WebP up to 256 KiB. **Remove logo** returns to text-only branding. An image that cannot load is hidden without blocking sign-in.
- Uploaded images are encoded in the settings row and included with the database backup. SVG/HTML uploads and non-HTTPS remote URLs are rejected. Remote URLs load in the visitor's browser, without a referrer; the backend never downloads them. Use an upload to avoid third-party image requests.

The editor has a login preview. **Save changes** publishes it without restarting or rebuilding. All branding is public before login: do not put credentials, private URLs or other secrets in these fields. Text is escaped, not interpreted as HTML. The panel's versioned fork attribution and legal/license notices remain available.

News and the new branding fields receive defaults when upgrading from .3. Existing IP policy, Follow Us and Trustpilot switches are preserved.

## Storage and upgrades

The backend creates a single-row `panel_settings` SQLite table at startup. On the first run, it imports `GAMEPANEL_IP_PORTS`, or the older `GAMEPANEL_BIND_IPS` list if no port policy exists. Later environment edits do not override saved settings. Settings load before the HTTP listener and task runners start; invalid saved settings fail startup instead of enabling unrestricted publishing.

The panel runs one backend process against its database. Save requests include a revision number. A stale or concurrent save returns **409** and leaves the form available for review; use **Reload** to fetch the newer configuration.

Include the database in backups. Before downgrading to an environment-only version, export/reapply the desired IP policy to its environment; older releases ignore the settings table.

When downgrading **.4 to .3**, restore the matching pre-upgrade database as well as the source/images: .3 rejects the new appearance fields. Changes made since that backup would be lost, so plan and export them before downgrading.

## API

- `GET /api/system/settings` — root only; returns revision, appearance, network and assignments.
- `PUT /api/system/settings` — root only; accepts revision, appearance and network. Validation errors return 400; conflicts return 409.
- `GET /api/system/appearance` — authenticated users; appearance fields only.
- `GET /api/branding` — public, `Cache-Control: no-store`; the same appearance fields for pre-login rendering. No network settings, assignments or revision.
- `GET /api/system/bind-addresses` — authenticated users; current effective IP/port policy for game forms.

Example save body (documentation address):

```json
{
  "revision": 1,
  "appearance": {
    "showFollowUs": false, "showTrustpilot": false, "showNews": false,
    "siteName": "Example Games", "siteSubtitle": "Community servers", "logo": "",
    "loginDescription": "Sign in to manage your servers",
    "showLoginFooter": true, "loginFooter": "Example Games"
  },
  "network": {
    "restrictPorts": true,
    "allocations": [
      { "ip": "192.0.2.10", "alias": "Game node", "tcp": "27015-27030", "udp": "27015-27030" }
    ]
  }
}
```
