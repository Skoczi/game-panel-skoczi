# Development and testing

## Source policy
Start from this repository, not a copy of a live deployment. Keep runtime data outside the source tree. Use documentation addresses (192.0.2.0/24) in examples, loopback in integration tests.

## Local checks
Use Node.js 22 LTS:
```bash
cd backend
npm ci --ignore-scripts
npm test
npm run build
cd ../frontend
npm ci --ignore-scripts
npm run build
```

The tests isolate database/daemon dependencies; ignored install scripts are adequate for these checks. To run the actual backend, install normal native dependencies in an appropriate development environment using the upstream runtime instructions and generic environment values. Never copy production JWT secrets or databases.

## What the tests cover
- Allowlist parsing, unsupported values and unknown addresses.
- Strict port validation.
- Per-IP TCP/UDP ranges, malformed policy and wildcard/missing-IP bypass attempts.
- Policy checks before panel start/restart and before stopping a container for recreation.
- SQLite settings persistence/reload, allocation safety, concurrent revisions and root-only settings routes.
- Distinct-address reuse and conservative wildcard conflicts.
- Multiple Docker bindings for one container port.
- Stored JSON compatibility with old records.
- Database/Docker conflict service behavior with explicit test doubles.
- Stable fleet identity, recycled runtime IDs, additive identity migration and per-server grants.
- Protocol 2 delegation, rejection of global/wildcard permissions and cross-server WebSocket filtering.

## Browser component tests
Browser selector tests use intercepted API responses, with no live panel or credentials:
```bash
cd frontend
npm ci --ignore-scripts
npx playwright install chromium
npm run test:ui
```
These exercise IP selection, port ranges, forbidden ports, stale addresses, settings editing, sidebar visibility, authorization-dependent navigation, save conflicts and mobile layout. They are component-level tests, not a full authenticated UI end-to-end run.

Fleet fixtures additionally cover automatic server routing, no fallback on outage, administrator assignments, live permission refresh/revocation, ordinary-user navigation and responsive light/dark layouts.

## Real Docker integration
**Disposable Linux host only.** It pulls Node.js Alpine and creates a uniquely named container, publishes TCP and UDP 28080 on 127.0.0.2 and 127.0.0.3, inspects both bindings and tests HTTP plus UDP echo on both IPs. It removes only its own test container in a finally block. This is a transport check, not a game-protocol test.

```bash
cd backend
GAMEPANEL_DOCKER_TEST=1 npm run test:docker
```

Without the environment opt-in it skips. GitHub Actions runs this test on its isolated runner. If port 28080 is occupied, use a clean runner; do not stop production containers.

## Manual acceptance before deployment

### Multi-node CI

On a disposable Linux runner, build `docker build -f backend/Dockerfile -t gamepanel-agent:ci .`, then run `GAMEPANEL_NODE_DOCKER_TEST=1 npx tsx --test test/integration/nodes.test.ts` from `backend`. This opt-in test uses two empty databases and real nginx test containers, never production data. It reserves loopback ports 32181, 32182, 32280 and 32281. CI is the default environment for this test.

Two users receive different servers with the same numeric runtime ID. The test checks scoped HTTP controls/files/downloads, console sessions, live local/remote revocation, isolation from foreign containers, restarts, replay and unavailable nodes. It does not test a production game migration.

Unit tests also cover node credential encryption, audience/method/path binding, replay rejection, enrollment races, operation-journal recovery and streamed HTTP responses. Browser fixtures cover enrollment token handling, selected-node routing and disabled/mobile states. They do not replace acceptance of each actual game provider on the destination host.

### Operator acceptance
1. Install on a fresh VM using your own test credentials.
2. Add two assigned host IPs to the allowlist and confirm both selectors.
3. Create two disposable servers with the same host port, different IPs.
4. Confirm duplicate IP/protocol/port is refused.
5. Test TCP/UDP with real clients as the game requires.
6. Edit an IP, confirm expected restart/recreation and verify Docker HostIp.
7. Refresh/restart the panel and verify settings remain.
8. Enable per-IP ranges: verify host port 8080, missing IP and a forbidden protocol are rejected. With policy unset, verify legacy no-IP behavior.
9. Remove a selected IP from the allowlist; confirm it is not silently widened.
10. Verify the independent login/navigation identity on desktop and mobile.

Record results without posting real addresses, tokens, credentials or game content.
