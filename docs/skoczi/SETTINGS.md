# Global settings

**Settings** is visible only to the root administrator. A user with ordinary server or user-management permissions cannot read or change the global configuration through its API.

## IP allocations

Open **Nodes → Node settings → IP allocations** for the chosen node. Local has the same entry; no extra agent is required. Global Settings now edits appearance only. Existing policies remain on their original runtime; this change does not move addresses, ports or game servers.

1. Add the host IPv4 and an optional label.
2. Enter comma-separated ports or inclusive ranges separately for TCP and UDP, e.g. `27015-27030,28015`.
3. Click **Add to list** (or **Update entry** when editing).
4. Enable **Restrict published ports to these allocations** to enforce ranges and require explicit IP selection.
5. Click **Save changes**.

Blank protocol ranges deny that protocol. An empty restricted list denies all port publishing. With restrictions disabled, legacy Docker-default bindings and unrestricted host ports above 1024 remain available.

The assigned-port table lists stored server bindings, including stopped servers. It does not scan arbitrary host services. Removing an assigned IP or narrowing a range around an assigned port is rejected; first change the server binding. Existing servers are not stopped by a settings save.

This is allocation management, not IP provisioning: configure interfaces, provider routing and firewall rules on the host separately. [Policy details](ADDITIONAL-IPS.md).

### Cross-node ownership

The panel reserves each configured IPv4 for one node, regardless of its TCP/UDP ranges. This is this panel's allocation policy, not a claim that all networks prohibit shared/overlapping addresses. Separate private address spaces, NAT/anycast and shared-IP multi-host setups are not modeled here.

Before saving, the panel reads the existing allocations of Local and all previously enrolled nodes. If another node is unavailable or has revoked credentials, the save fails closed until its configuration can be verified. Never-enrolled nodes have no runtime to inspect. Existing duplicate configurations are reported, not silently rewritten.

Updates are serialized by the single panel backend. SQLite tables `node_ip_claims` and `node_allocation_updates` retain ownership and the original pending request. An uncertain response keeps the old and requested addresses reserved. **Retry pending save** repeats the same operation ID against the agent's durable request journal; it does not issue a new request ID. A confirmed rejection releases only the attempted, unused addresses. An agent operation marked `uncertain` requires operator investigation; the panel does not force-clear it or assume failure. Node deletion is blocked while its allocation save is pending.

Release an address in its original node and successfully save before assigning it elsewhere. Existing server bindings still prevent release or narrowing their port ranges. Direct root edits to agent databases/configuration are outside this coordination mechanism; manage allocations through this panel. Save never configures host interfaces, routing or firewalls.

## Appearance

- **Show Follow Us** controls the sidebar social links.
- **Show Trustpilot** controls the sidebar review badge.
- **Show announcements** controls the news carousel. Disabled means no browser news request, not just a hidden banner.
- Footer: **Game Panel · Skoczi Edition**, then **v1.5.0 · Revision 9**, followed by a **Based on OVHcloud Game Panel** link to the original repository. The version line separates the upstream base from the fork revision. The technical version (`1.5.0-skoczi.9`) remains in package metadata, tags, update checks and tooltips.

Fresh installations use **Skoczi Edition** as the subtitle and credit OVHcloud in the login footer. Upgrades preserve saved branding, including custom names, subtitles and footers; edit those in Settings if desired.

Visibility updates after saving, on page reload or when another browser tab regains focus. Legal notices remain available. Both sections default to visible on upgrade.

## Branding & login page

- **Login page theme** selects Light (the original blue background and white form), Dark, or System preference. The live preview follows the selection. System preference reacts to the visitor's OS theme, not the panel's saved theme. This does not change signed-in users' appearance preferences. Existing settings gain Light once on upgrade; all saved branding and allocations remain unchanged.

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
- `PUT /api/system/settings` — root only; on the panel, accepts revision, appearance and the unchanged network snapshot. Network changes must use the node endpoint. The agent's signed internal endpoint continues to accept its own policy updates.
- `GET /api/nodes/:id/allocations` — root only; selected node's revision, network, assignments and pending-save flag. `:id` may be `local`.
- `PUT /api/nodes/:id/allocations` — root only; accepts `{ "revision": 1, "network": { "restrictPorts": true, "allocations": [] } }`. Enforces cross-node ownership and preserves that runtime's appearance fields.
- `POST /api/nodes/:id/allocations/retry` — root only; explicitly retries the previously persisted request with the same operation ID.
- `GET /api/system/appearance` — authenticated users; appearance fields only.
- `GET /api/branding` — public, `Cache-Control: no-store`; the same appearance fields for pre-login rendering. No network settings, assignments or revision.
- `GET /api/system/bind-addresses` — authenticated users; current effective IP/port policy for game forms.

Example node-allocation save body (documentation address):

```json
{
  "revision": 1,
  "network": {
    "restrictPorts": true,
    "allocations": [
      { "ip": "192.0.2.10", "alias": "Game node", "tcp": "27015-27030", "udp": "27015-27030" }
    ]
  }
}
```
