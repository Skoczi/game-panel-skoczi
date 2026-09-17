# Game Templates

Game Templates is the fork's central, root-administrator-only installation catalog. It is shared by Local and remote nodes. It does not replace Docker images, LinuxGSM, or the existing game-specific OVH adapters.

## First installation

1. Update the panel backend/frontend and the target agent together. The target must advertise `templatesProtocol: 1` on its health endpoint. Older agents are rejected before an installation is submitted.
2. In **Nodes → Node settings → IP allocations**, configure addresses and allowed port ranges that already exist on that host. Enable port restrictions for enforcement. No host interfaces or firewall rules are created.
3. Open **Game Templates**. The bundled **Counter-Strike 1.6** definition starts as a draft; review it before publishing.
4. Publish the saved version. Select **Install server**, choose the node, an allocated IPv4 address and a host port. Adjust memory/CPU limits for the game; the form starts at 1024 MiB and one CPU, not a universal game recommendation.
5. Open the node's server workspace to follow installation logs. “Server created” means the asynchronous installation was accepted, not that the game is ready.
6. Verify an actual client connection, query, RCON if configured, stop/start and data persistence before using the server for players.

Nothing in these steps migrates or restarts an existing server. Legacy installation remains available during this transition.

## Editor

- **General:** name, description, maintainer and source attribution.
- **Runtime:** LinuxGSM, supported OVH image adapters or an external image; image tag/digest, catalog identifier, architectures, and external image execution identity. LinuxGSM/OVH presets help fill the definition; they are copied, not continuously synchronized.
- **Network:** named ports, TCP/UDP, container port, suggested host port and optional environment/LinuxGSM port-setting key. One row can represent multiple roles on the same protocol and port.
- **Variables:** string, integer or boolean environment variables, required values, public defaults and secret fields. Boolean values are `true` or `false`. Provider-specific string variables may require their own spelling, e.g. `EULA=TRUE`.
- **Storage:** named, server-owned directories mapped into the container. Raw host paths, privileged/system paths and the Docker socket are not accepted. Some OVH adapters add mandatory mounts.
- **Versions:** inspect and compare saved definitions, install a published version or disable it for future installations.
- **JSON:** advanced editing of the same validated schema, not an executable script editor.

Use an image digest to pin the runtime image. A versioned definition with a mutable tag does **not** guarantee the same image bytes on future installs. The existing runtime records the resolved image separately. Fork package revisions are not used as tags for upstream OVH images.

## Versions and publication

Every save creates a new immutable draft version. There is no in-place modification of a published document. Concurrent/stale version saves are rejected. To revise an older version, copy its desired fields into a draft based on the latest version, or duplicate it as a new template.

Publication is a root-admin trust decision: the selected image will execute on a Docker host. It is **not** an image security certification. Disabled versions cannot issue new installation authorizations; create a new draft to republish. Previously issued authorizations expire after 120 seconds, so disabling is not an immediate revocation of those short-lived tickets.

Existing servers keep an installation-time snapshot (`id`, `version`, SHA-256, definition) in provider metadata. Credentials supplied during installation are not part of that snapshot. Publishing a new version never updates running containers, files, ports or environment variables. Subsequent authorized manual server configuration changes remain separate from the original snapshot.

Definitions are stored in `game_template_versions`; publication/disable events in `game_template_audit`. Back up the panel database using the normal consistent backup procedure. The seed uses insert-if-absent and never overwrites administrator revisions or re-enables a disabled definition.

## Local and remote execution

The panel issues an HS256 authorization containing a normalized definition, hash and protocol number. It is bound to the selected node, has a separate issuer from login/node authentication, and expires in 120 seconds. The browser submits that ticket with the instance's name, selected IP/port bindings, variable values and resource limits.

The target runtime verifies the ticket and supported architecture, constructs the install request from the verified definition, and runs the existing port policy/conflict checks and provider installer. Client-supplied image/env/mount overrides cannot replace the ticket's definition. Remote installs do not refetch a possibly different LinuxGSM catalog to resolve the template's image.

Use the same compatible panel/agent release. There is no fallback to Local if a remote request fails. If an installation response is lost, the UI blocks immediate resubmission and asks the administrator to inspect the target node first. The existing agent operation journal handles at-most-once admission; this is not an automatic retry queue or a distributed exactly-once guarantee.

## CS 1.6 networking

The bundled profile publishes **one UDP port** for game traffic, query and GoldSrc RCON. It does not publish TCP “Query” or UDP “Client”. The container port defaults to 27015; the host port is independently selectable from node allocations.

The installer writes the numeric container port to LinuxGSM `common.cfg` using the `port` setting. Changing the public mapping to `27020 → 27015` does not require changing the game's internal port to 27020. Only numeric port assignments are generated by this integration.

The remote hostname fix separates the kernel hostname (at most 63 ASCII characters, with a deterministic hash suffix when needed) from the full Docker container name. Existing Docker names and ownership labels are retained. Existing failed containers need a reviewed reconfiguration/recreation; upgrading an agent alone does not rewrite their Docker configuration.

## Import/export and security

Import accepts **Game Templates schema v1 JSON**, at most 32 KiB. Imports are always drafts. Unknown fields, duplicate bindings, invalid paths and secret defaults are rejected. Export contains only the template document: no node credentials, selected IPs, instance port assignments, generated host paths or installation-time variable values.

Descriptions, author/source and non-secret defaults are public exported text. Review them before sharing: the panel cannot determine that a value disguised as an ordinary string is a password or private infrastructure detail. Do not place deployment data in these fields. Variables named like credentials must be marked secret and secret defaults must be empty.

No remote URL fetching is performed when importing a document. Import does not execute scripts or pull images. The runtime image itself is executable, trusted administrator-selected code; Docker access is a high-privilege boundary, not a sandbox for untrusted third-party templates.

## Scope of schema v1

Included: central catalog, structured editor, draft/publish/disable, immutable versions and comparisons, duplication, JSON import/export, explicit per-node allocations, typed environment variables, resource limits at installation, signed runtime resolution and a CS 1.6 profile.

Not included yet:

- Direct egg import or compatibility with another panel's install/startup scripts.
- Arbitrary shell install scripts, custom lifecycle hooks or custom healthcheck editing. Existing providers/images still own lifecycle and readiness behavior.
- Automatic selection of free allocations or automatic placement across nodes.
- Bulk migration/adoption of legacy servers into templates, template upgrade jobs or automatic rollback of game files.
- Central fleet-wide template usage counts; snapshots live with the runtime's server records.
- A packaged ReHLDS image or every provider's specialized installer dialog. Games requiring Steam account credentials or advanced provider-specific setup should continue through the existing installer until those inputs have a reviewed template adapter.

## Verification before deployment

Automated checks cover schema rejection, secret defaults, typed values, signed-ticket audience/expiry/hash checks, immutable versions, stale saves, root-only HTTP access, explicit remote bindings, old-agent rejection, mobile/dark UI and long-hostname generation. These checks do not substitute for a Linux Docker game installation test.

Acceptance checklist: use disposable Local and remote instances; test approved/disallowed ports, unavailable agents, node isolation, real game connection/query/RCON, file persistence after restart, and a database rollback rehearsal. Never use production servers as disposable test fixtures.
