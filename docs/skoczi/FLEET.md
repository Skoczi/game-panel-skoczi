# Server workspace and access — Revision 8

Users work with **servers**, not execution hosts. Game Servers lists all servers assigned to the signed-in account, across locations. Each card shows the name, location, node label and observed state. Search matches names and locations. Opening a card resolves placement and connects the existing console, file manager and controls automatically. Users do not get a node selector, Nodes, global Settings or Host Status.

Administrators see the complete inventory. **Manage nodes** opens infrastructure administration; **Nodes → Open servers** opens the runtime workspace used for provisioning. The node selector exists only in that administrative workspace. Returning to Game Servers closes that context.

## Assign a server

1. Create the account in User Administration without global installation or user-management permissions.
2. Open **Game Servers → Access** on the intended server and select the account.
3. Viewer grants status/metrics access. Operator adds power, command and logs. File manager adds file read/write and logs. These are editable presets, not global roles.
4. Select additional per-server permissions and save. Wildcards and global permissions are not assignable here.
5. Revoke access removes membership entirely. Unchecking operations alone retains read-only membership.

Existing local memberships are reused. Remote memberships live in the panel database, not agent-local user accounts. Root administrators retain access. Provider support still determines which operations a game offers.

Terminal access permits commands inside the game container; file access can expose configuration secrets. Edit, environment, deletion and restore are powerful permissions. This release is not an independent hostile-tenant sandbox or a replacement for host isolation.

## Identity and routing

- The registry assigns a stable UUID per server; links use `?server=UUID`.
- Runtime rows have a random 128-bit identity assigned by a SQLite migration/insert trigger. Inventory uses node ID plus that identity, not a recyclable numeric ID.
- Existing game IDs, containers, files and memberships stay in place. Reusing an ID after rebuilding a database cannot inherit old remote memberships. Unknown runtime identity is rejected.
- Opening a link resolves its node and runtime ID before activating the workspace. A per-tab reload closes old sockets and discards runtime caches. Use separate tabs for simultaneous server workspaces.
- The browser never receives agent credentials. Its requested UUID is checked against the authenticated account and node on every remote HTTP request.
- The panel signs a short-lived **protocol 2** single-server capability. The agent checks signature, exact method/path, node audience, nonce and runtime identity, then applies operation-specific runtime permissions. Global operations and member management are not delegated.
- WebSocket snapshots/events/metrics are filtered. Host metrics and foreign-server subscriptions are rejected. Console sessions also check their owner's identity.

## Revocation and failures

New HTTP requests check membership immediately. Remote sockets recheck the account, node credential and grants about every five seconds and close on change. Local sockets refresh membership/account checks on the same bound. Already admitted commands and transfers can finish; revocation is not rollback. Download links are single-use, expire after 60 seconds, and recheck access and runtime identity on redemption.

Inventory refreshes roughly every 30 seconds, at most four remote reads in parallel, with a 10-second deadline. Only display metadata is retained centrally—no environment variables or host paths. Failed/malformed inventory never deletes known records or declares games stopped. Disabled, unreachable or stale nodes display **unknown**, their last observation and a disabled Open action. A successful complete snapshot can mark missing servers absent. Requests never fall back to Local.

The registry persists; reachability does not. After restart, cards can briefly show unknown during the first read. Administrators can refresh explicitly. Agents without runtime identities must be upgraded before appearing in the workspace; the legacy administrator runtime remains available during a staged upgrade. User access fails closed against protocol 1 agents.

## Upgrade

Upgrade agents and panel to Revision 8 together, preserving databases and identities. Back up consistent databases before the additive runtime-identity migration. See [Nodes](NODES.md) and [Installation](INSTALLATION.md). This feature does not move, restart or reassign games; normal runtime startup reconciliation still applies.

Mutation-journal fingerprints now include delegated actor/scope. Keys recorded by older versions may conflict after upgrade: inspect the outcome instead of blindly generating another key.

## Migration boundary

The global ID, membership and placement revision are a foundation, **not an implemented migration engine**. There is no move action or automatic placement scheduler. A future migration must reserve destination IPs/ports, check provider/storage compatibility, quiesce writes, verify transfer checksums, enforce one active runtime, switch placement atomically and support rollback. Do not edit placements manually.

## API

| Endpoint | Access |
|---|---|
| `GET /api/fleet` | Assigned servers; all for root |
| `GET /api/fleet/:uuid/context` | Authorized placement and effective server permissions |
| `POST /api/fleet/refresh` | Root; bounded inventory refresh |
| `GET /api/fleet/:uuid/members` | Root; assignments and assignable permissions |
| `PUT /api/fleet/:uuid/members/:userId` | Root; replace permissions |
| `DELETE /api/fleet/:uuid/members/:userId` | Root; revoke membership |

Remote HTTP uses bearer authentication plus `X-GamePanel-Server: UUID`. Node ID, UUID and runtime path must agree. WebSockets use `/api/nodes/:nodeId/ws?server=UUID` with the existing first-frame bearer exchange. Resolve context rather than guessing numeric IDs. Changes are recorded in `fleet_audit`, without credentials.
