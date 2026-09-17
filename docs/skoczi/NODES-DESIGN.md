# Multi-node execution design

Status: Revision 7 administrator preview; production rollout and operator acceptance are separate steps.

## Runtime boundary

The control panel owns login, node registration and authorization to enter a node.
Each node owns its runtime database, Docker containers, files, installation state,
scheduled tasks and backups. The existing runtime is shared by the local node and
the agent; game-specific adapters are not reimplemented over SSH.

A server identity is `(node UUID, runtime server ID)`, not a globally unique integer.
The browser switches the entire runtime context and discards cached server state.
Runtime requests and WebSockets are explicitly routed; an unavailable agent NEVER
falls back to local execution. Central branding, accounts and node administration
remain on the control panel. The local runtime remains backwards compatible.

## Trust boundary

Node administrators can control Docker and therefore the node host. Remote node
access is initially restricted to panel root administrators. Do not present this
as untrusted-tenant isolation. Agents accept only short-lived, audience-, method-
and path-bound signed requests from their enrolled panel. They have no public login,
user administration, panel updater or raw Docker API. Enrollment is one-time and
expires. Node credentials are encrypted at rest using a separate derived key.

HTTPS verification is mandatory for remote origins. HTTP loopback is available
only under an explicit integration-test switch. Requests never follow redirects.
The reverse proxy must support HTTP streaming and WebSocket upgrades. Large game
files stream through the panel with backpressure, rather than being JSON/base64
encoded or retained in RAM. No credentials are sent to the browser or game images.

## Failure contract

- Panel down: games and node-local schedules continue; central management unavailable.
- Node unreachable: explicit 503; no automatic replay of a mutation.
- Connection lost after mutation: operation state may be unknown; inspect before retry.
- JSON mutation retries reuse an idempotency key; the agent persists the result.
- Agent restart with an unfinished request: mark uncertain, never blindly execute again.
- Reconnect sockets: reauthenticate, reconstruct subscriptions, do not replay commands.
- Revoked/disabled nodes: central HTTP and live socket access are denied.

## Rollout

Keep the existing production services unchanged. Verify a disposable local Docker
runtime and a separate agent through the same panel, including files, console,
backups supported by the selected provider and outage behavior. Publish a preview
only after automated checks; production-host validation is a separate stage.
