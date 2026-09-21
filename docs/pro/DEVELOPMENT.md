# Local development

The backend is TypeScript/Express with SQLite, Docker operations and agent transport. The frontend is React/Vite. `runtime/` contains the existing Native recipes. Do not regenerate installed snapshots when editing templates.

Run `npm ci`, `npm test` and `npm run build` in `backend`; run `npm ci`, `npm run build` and `npm run test:ui` in `frontend`. Playwright uses a local Vite server and headless Chromium. Existing screenshot calls require `PLAYWRIGHT_SCREENSHOTS=1`; omit it for background checks without captures.

Meaningful regressions for this release are in `cron.test.ts`, `native-schedules.test.ts`, `native-backups.test.ts`, `native-restore.test.ts`, `atomic-file.test.ts` and `resources.test.ts`. The recorded release results are in [VALIDATION-2.0.49.md](VALIDATION-2.0.49.md). They cover the actual scheduler/backup connection, filesystem restore, rollback on a simulated failed swap, malicious archive entries, byte limits and stale saves.

Docker acceptance is separate: `npm run test:docker` with the environment required by each integration fixture. Passing mocked/unit/UI tests does not establish a working game install, game-client connection or backup consistency on WAW1.

Keep feature changes small; use AppButton, AppInput, AppToggle, AppModal and ConfirmationModal. Add a release note when behavior changes. Do not insert credentials, database files or deployment environment files into Git.
