# Contributing to the Skoczi fork

Thanks for improving this independent community edition.

1. Open an issue describing the behavior, expected outcome and sanitized reproduction.
2. Branch from this fork's main branch.
3. Keep changes focused and add regression tests.
4. Update CHANGELOG-SKOCZI.md and the relevant docs/skoczi guide.
5. Run backend tests/build and frontend build. Networking changes need the disposable Linux Docker test.
6. Submit a pull request explaining compatibility, security implications and what was not tested.

Preserve Apache attribution and identify modifications. Do not claim official OVH endorsement.

## Never publish
Runtime .env files, database snapshots, certificates/private keys, SSH material, tokens, real host inventories or private game data. Use example.com and reserved documentation IP ranges.
Review the Git diff and history, not only .gitignore. If a secret is exposed, revoke/rotate it: deleting a file does not remove it from history.

Report potential security vulnerabilities privately using GitHub private vulnerability reporting when available; do not paste exploits against a live deployment or credentials in a public issue.

For clean tests see [Development](docs/skoczi/DEVELOPMENT.md). Upstream changes should be reviewed and integrated intentionally; do not blindly overwrite fork behavior with upstream update scripts.
