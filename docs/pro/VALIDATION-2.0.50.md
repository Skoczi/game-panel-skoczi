# Validation — Game Panel PRO 2.0.50

Release work follows the local 2.0.49 candidate (`475521d`). No WAW production deployment was performed.

## Checks

- **146 backend tests:** includes the real upstream v1.5.0 SQL schema, migration of accounts/memberships/game records, scoped update capability, stable-release filtering and duplicate update rejection.
- **167 browser tests:** includes offline installed changelog, unmanaged-installation behavior and confirmation/single submission for a managed update.
- **5 deployment tests:** complete source copy without local secrets, custom-layout rejection, restoration after failed health checks, archive traversal/link rejection and checksum/repository enforcement.
- TypeScript backend and production frontend builds.
- A real Docker Compose transaction with small HTTP fixture services verifies migration 1.5.0 → 2.0.50 and rollback, retained panel/game files, exact old image reuse and an unchanged proxy container.

The deployment transaction fixture does not claim to run the full upstream UI. Database compatibility is separately checked against the original v1.5.0 schema. The full panel/agent integration uses the actual backend image.

## Standalone build correction

The installer previously omitted documentation/runtime inputs from the source copy. It now copies the complete build context. Fresh installation refuses an existing non-empty destination. The frontend Docker build exceeded Node's default 2 GiB heap in the Linux test; the build now explicitly allows 4 GiB. See installation RAM guidance in [INSTALL.md](INSTALL.md).

## Deployment limits

No production host, external agent or real game client was upgraded by this work. Test the target installation before exposing it to operators. Managed updates are limited to the standard standalone layout and installations without remote nodes. Custom Compose layouts are rejected, not rewritten.

The updater downloads only stable releases from `Skoczi/game-panel-skoczi`, requires our source/checksum assets, keeps rollback snapshots private and never restarts game containers as part of the deployment transaction. A successful source release is not evidence of a successful WAW rollout.
