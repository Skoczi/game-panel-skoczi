# Nodes and Game Panel Agent

Multi-node preview: protocol 1 for administration, protocol 2 for scoped server delegation. Built on the OVHcloud Game Panel runtime; node control and agent packaging are additions in the Skoczi Edition.

## What runs where

```text
Browser ── HTTPS / WebSocket ── Panel (users, branding, node registry)
                                 ├── Local runtime → local Docker
                                 ├── HTTPS / WSS → Agent A → Docker A + files + SQLite A
                                 └── HTTPS / WSS → Agent B → Docker B + files + SQLite B
```

Each runtime owns its servers, files, transfers, schedules, operation journal and IP/port allocations. The panel maintains a central UUID per server backed by a durable runtime identity. Opening a server resolves placement automatically; node switching is confined to the administrator runtime workspace. Context changes reload the tab, close sockets and clear cached runtime data. Requests never fall back to Local.

Existing installations keep their Local runtime. This release does not adopt existing Docker containers, migrate servers, move files or remove the panel's Docker dependency. Nodes are managed by **root administrators only**; ordinary users access assigned servers through scoped delegation. See [Server workspace and access](FLEET.md). Automatic placement and cross-node migration are not implemented.

## Requirements

- A separate Linux Docker host with Docker Engine and Compose v2+, Python 3, sufficient disk/RAM and a working system clock.
- A reviewed checkout of this release on the node. The installer builds the backend image locally; it does not download or execute an unversioned shell installer.
- Two reachable HTTPS origins: panel and agent. The panel must reach the agent; the agent must reach the panel for enrollment and heartbeat. Use valid certificates. A private CA is supported by `GAMEPANEL_NODE_CA` in both runtime environments (mount the CA file read-only).
- A reverse proxy on the agent host. The installer publishes its API only on `127.0.0.1:18082`; it does not edit nginx, certificates, firewall, SSH, other Compose projects or Docker daemon settings.

The Docker socket gives the agent host-level authority. Labels prevent accidental cross-instance operations; they are **not a security boundary against a compromised host administrator or malicious game image**. Do not grant root panel accounts to untrusted customers. Prefer a dedicated game host.

## Install a node

1. In **Nodes → Add node**, enter a name, location and agent HTTPS origin, for example `https://node.example.com`. This is the management endpoint, not a game-server IP allocation.
2. On the selected node, from the reviewed release checkout:

   ```bash
   sudo python3 deploy/agent/agent.py install \
     --root /srv/gamepanel-agent \
     --panel https://panel.example.com \
     --node NODE_UUID_FROM_PANEL
   ```

   The image is built first. Paste the one-time enrollment token at the hidden prompt. Tokens expire after 15 minutes; if the build takes longer, generate a new enrollment in the panel. Never put tokens in command arguments, URLs or tickets.

3. Configure the agent HTTPS reverse proxy. Adapt the dedicated example below to an existing, valid certificate and your proxy layout. Do not replace unrelated virtual hosts.

   ```nginx
   server {
       listen 443 ssl;
       server_name node.example.com;
       ssl_certificate /etc/letsencrypt/live/node.example.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/node.example.com/privkey.pem;
       # Restrict management to the panel address/VPN at the firewall if possible.
       client_max_body_size 64m;
       location /api/ {
           proxy_pass http://127.0.0.1:18082;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_buffering off;
           proxy_request_buffering off;
           proxy_read_timeout 150s;
           proxy_send_timeout 150s;
       }
       location / { return 404; }
   }
   ```

   The panel reverse proxy must also forward WebSocket upgrades under `/api/nodes/`, without response/request buffering for file transfer routes. Existing `/api/` proxy rules can cover both. Do not cache `/api/`. Do not log authorization or `X-GamePanel-Node-Auth` headers, and redact `/api/node-download/` capability paths in access logs.

4. Check **Nodes**. A heartbeat arrives about every 15 seconds; after 60 seconds without one the node is shown offline. Heartbeat only establishes agent-to-panel reachability. Open the node's IP allocations or server list to check the reverse direction as well.
5. Configure **Nodes → IP allocations** before creating a game. New agents start with an empty, restrictive port policy. Add only IPs already configured on the host and permitted TCP/UDP ranges. The panel does not assign IP addresses to Linux or modify the host firewall.
6. Open servers for that node and create a small test server on a free port. Verify console, file edit, download, stop/start and reconnect before placing production games there.

`install` refuses an existing destination. Failed setup leaves its directory for inspection; it never recursively deletes it. After a consumed/lost enrollment response, revoke and issue another token. Do not rerun `install` over existing data.

## Operation

```bash
sudo python3 /srv/gamepanel-agent/agent.py status
sudo python3 /srv/gamepanel-agent/agent.py logs
sudo python3 /srv/gamepanel-agent/agent.py stop
sudo python3 /srv/gamepanel-agent/agent.py start
```

Stopping the agent stops management, metrics and the agent scheduler, **not running game containers**. Existing games keep their own Docker restart policies. Panel downtime does not stop the agent or its scheduler. Missed scheduled tasks follow the existing runtime scheduler behavior; this is not a distributed scheduler.

The public agent `/api/health` only reports process readiness and protocol. It exposes no node secrets or server inventory. A healthy process does not prove game health or successful central authentication.

### Revocation and re-enrollment

**Disable** stops new central requests and closes management sockets within approximately five seconds; already admitted operations may still finish. It does not stop games. **Re-enroll** revokes the old credential and generates another one-time token. Then run:

```bash
sudo python3 /srv/gamepanel-agent/agent.py reenroll
```

This replaces the credential atomically and restarts only the agent. The UUID, database and game data must remain together. Changing `JWT_SECRET` on the panel makes stored node credentials unreadable; re-enroll each agent after an intentional rotation.

### Upgrade and rollback

Back up the agent's `data`, `identity`, `runtime.env`, `compose.json` and `servers` before upgrades. SQLite copies must be consistent (stop the agent or use SQLite's backup API). Keep credentials private. Game file consistency is a separate concern: stop the relevant game or use its supported snapshot procedure.

From the **new reviewed release checkout**, run:

```bash
sudo python3 deploy/agent/agent.py upgrade --root /srv/gamepanel-agent
```

The image is built before changing the running agent. The previous Compose file is retained as `compose.previous-<random>.json`; only the agent service is recreated. The tool does not auto-delete old images or backups. Check status, heartbeat, console and file access after upgrading. It does not declare the upgrade healthy merely because Docker started the container.

For rollback, review the release's database compatibility first, stop the agent, restore the selected previous Compose file (and its matching database snapshot if required), then use `start`. Never restore a database over a running agent, and never downgrade its database blindly. Game containers are separate from the agent service.

## Request contract and failure behavior

Central routes require the normal panel bearer token and an enabled root account:

| Route | Purpose |
| --- | --- |
| `GET/POST /api/nodes` | List/register nodes |
| `PATCH /api/nodes/:uuid` | Enable/disable management |
| `POST /api/nodes/:uuid/credentials` | Revoke and issue one-time enrollment |
| `GET /api/nodes/:uuid/audit` | Last 100 enrollment/administration events |
| `/api/nodes/:uuid/runtime/api/servers/...` | Remote existing server API |
| `/api/nodes/:uuid/runtime/api/system/settings` | Remote allocations/settings |
| `GET /api/nodes/:uuid/runtime/api/operations/:key` | Mutation journal state; no cached response secrets |
| `/api/nodes/:uuid/ws` | Authenticated remote runtime WebSocket |

Enrollment and heartbeat use their own credentials, not a browser token. The agent refuses panel account, updater and node-registry routes. Its management requests have short-lived HS256 signatures bound to the node, method, exact path, actor and a one-use nonce. HTTPS validates the peer and protects the request body. The nonce cache is in-memory; restart clears it, but token expiry remains enforced. The panel encrypts stored node keys with AES-256-GCM and node-bound context.

For JSON mutations, send a stable `Idempotency-Key` of 16–128 ASCII letters, numbers, hyphens or underscores. Repeating the same key/body returns the saved HTTP response; different input returns 409. A crash between admission and response leaves an **uncertain** operation, never automatically executed again. Inspect game state and the operation journal before deciding on a new request. An installation's saved 201 response means *accepted*, not *installation completed*; inspect installation progress.

Binary file uploads use the existing chunk/session semantics, not the JSON operation journal. WebSocket terminal keystrokes are not durable/replayed. Download tokens are short-lived, single-use capabilities; the gateway issues its own opaque path. Requests are not automatically retried by the transport. Connections have bounded waits and buffers. A 503 after a mutation does not prove that the mutation was never executed.

The JSON journal currently retains admission records and cached responses without automatic pruning, to avoid replaying old keys. Monitor the SQLite file's growth and protect it as application data; cached responses may include operational secrets. There is no claim of exactly-once external effects across crashes.

## Verification and scope

The CI workflow includes protocol/store/journal unit tests, HTTP streaming tests, browser tests and a disposable Linux integration job that boots a central panel and agent against real Docker. It checks registration, a restricted game install, idempotency, independent inventories, files/download capabilities, WebSocket snapshots, agent/panel restarts, offline behavior and revocation.

This is an administrator preview, not a promise that every upstream game image or provider-specific operation has been certified on a remote node. Provider backups retain the original runtime's support matrix. SFTP, remote per-user delegation, fleet-wide quotas, HA control planes, automatic migration, and recovery of a lost host's game files are outside this release. Production rollout requires operator acceptance tests; passing CI does not replace them.

## Po polsku — najważniejsze

- **Nodes** dodaje niezależne hosty. **Local** pozostaje na dotychczasowym serwerze.
- Nowy node ma własne pliki, bazę, alokacje IP/portów i kontenery. Nic nie jest automatycznie przenoszone.
- Instalator uruchamia tylko agenta. HTTPS i adresy IP konfigurujesz świadomie na wybranym hoście.
- W tej wersji zdalne node'y są dostępne wyłącznie administratorom root. Uprawnienia zwykłych użytkowników nie są kopiowane między hostami.
- Awaria panelu nie wyłącza gier. Niedostępny agent nie przekierowuje poleceń na Local.
- Po niepewnym wyniku operacji najpierw sprawdź jej stan; nie ponawiaj jej z nowym kluczem w ciemno.
