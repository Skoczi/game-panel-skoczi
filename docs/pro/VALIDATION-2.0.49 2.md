# Validation — Game Panel PRO 2.0.49

Date: 2026-09-20. Local working tree based on Revision 49 (`679c161f5637f83da356f3943e23a0ef6e40b15c`). No production deployment or GitHub release was performed.

## Audit verification

The original code confirmed the audit findings: Native backups required a stopped container while the scheduler required running; cron parsed numeric prefixes; the file route wrote without a version check; server metrics used host percentages; Native restore had no route; touched editor/Native controls used native browser dialogs or raw controls. These paths were changed in this candidate.

The requested backup scope was then refined: allow online backups, place them beside the game's directories in `data/backups`, and archive only `serverfiles`. This supersedes the audit's proposed all-mount, stopped-only Native backup behavior.

## Results

| Check | Result |
| --- | --- |
| Backend regression | 115 passed, 0 failed |
| Frontend Playwright regression | 125 passed, 0 failed, headless |
| Backend TypeScript build | Passed |
| Frontend TypeScript / Vite production build | Passed; existing large-chunk warning remains |
| Existing WAW2 upgrade49 unit suite | Earlier local verification: 11 passed, including simulated rollback; deployment scripts unchanged |
| Whitespace / patch checks | `git diff --check` passed |

Filesystem tests use real temporary directories and tar/gzip streams. Stage A completion tests additionally cover protected paths and symlink aliases, two interrupted restore filesystem states, asynchronous job persistence, permission checks on HTTP job status, late-invalid archive entries without destination changes, rollback during extraction commit, failure cleanup commands, and custom backup name validation. They exercise offline/online archive scope, scheduler-to-backup execution, malformed archives, external links, supported internal links, restore rollback, preservation of logs and original data, stale edits, concurrent saves and UTF-8 byte limits. Database tests exercise both the fresh metrics schema and additive migration without losing existing rows.

UI regressions include custom backup naming, invalid-name rejection, cancel without submission, 202/background completion, retained operation status after reload, legacy archive warnings and fallback when an old agent does not support job status. The audio fixture now contains valid PCM/WAV audio instead of PNG bytes. UI regressions also cover draft preservation, conflict comparison and conditional retry, refusal to save through an agent without file versions, shared confirmations, responsive layouts, absolute metrics, version checks and bundled changelog when GitHub is unavailable. Screenshots are opt-in; the final regression run did not enable them. No desktop capture or window switching was used.

GitHub repository identity was checked read-only: `Skoczi/game-panel-skoczi`, public, default branch `main`. Source publication, release/tag creation, repository renaming and production rollout remain pending the larger update.

## Acceptance still required before deployment

- Acceptance on target WAW runtimes and a real game client, particularly game-specific consistency of online backups. Local Linux Docker/agent acceptance is recorded below.
- Coordinated WAW1 agent update; terminal access to WAW1 is not yet configured.
- Verification of ownership, available space and backup scope on the actual Native server.
- Preservation and explicit recovery procedure for older all-mount archives in `.native-backups`.
- Candidate deployment bundle tied to the reviewed commit and a fresh pre-upgrade database/image rollback copy.

Local green tests do not claim that these production acceptance steps have happened. Existing deployment scripts were inspected and tested; none was run against a host.

## Stage A completion

See [implementation status](STAGE-A.md). No game recipe or profile was added or changed. Template-catalog changes in this pass only replace browser confirmations with the shared modal.

Recovery tests simulate the on-disk states at interruption points; they are not a physical power-loss test. Docker status is mocked in archive tests. Final UI tests ran headlessly with screenshots disabled. Builds retain the existing large-bundle warning; no desktop capture, production command or GitHub publication was used.

## Later stability acceptance — 20 September 2026

The Linux gate described above was subsequently exercised locally in an isolated Docker-in-Docker runtime (Linux/aarch64). All 116 backend tests, 3 actual filesystem fault tests and the complete real panel/agent scenario passed. Native acceptance covers live/offline backup, owner preservation, bounded disk space, dropped HTTP response replay and SIGKILL at three restore rename checkpoints. See [stability report](STABILITY-PROGRESS.md) for the exact limits and repeatable runner. Production/game-specific acceptance and physical power-loss behavior remain separate.

## History: stability complete, UX in progress

- Repeatable Linux acceptance runner completed successfully from a fresh disposable environment: **116/116** backend tests, **3/3** real filesystem fault tests, **1/1** comprehensive real panel/agent scenario. Its test container and anonymous volumes were removed by the runner.
- Frontend: **138/138** headless UI tests, including draft recovery and remote-version conflicts. Production frontend build passed; backend build also passed inside Linux acceptance.
- `git diff --check` passed. Existing bundle-size warning remains.
- Stage 1 is complete locally. Stage 2 has delivered its first draft-recovery change; remaining UX work is tracked separately. No deployment, source publication or new game/template implementation was performed.

## Etap 2 — druga partia (21.09.2026)

Pełny zestaw frontendu: **146/146**. Weryfikuje również blokady Native restore, odzyskanie stanu operacji po przerwie, kontekst we wszystkich zakładkach i dostępność wspólnych potwierdzeń na mobile w obu motywach. Bez screenshotów, wdrożenia i zmian agenta w tej partii. Szczegóły: [UX-PROGRESS.md](UX-PROGRESS.md).

## Odbiór lokalny etapu 3 — 21.09.2026

161/161 testów UI w headless Chromium, 130/130 testów backendu, 3/3 testy awarii magazynu i 1/1 pełna integracja Linux panel–agent. Build frontendu i backendu zakończony poprawnie. Bez zrzutów ekranu i bez wdrożenia. Etap 3 zamknięty lokalnie; zewnętrzny magazyn kopii i odbiór WAW pozostają osobnymi warunkami wdrożenia.

## Odbiór lokalny etapu 4 — 21.09.2026

143/143 testów backendu, 165/165 UI, build obu aplikacji oraz Linux 143/3/1. Szczegóły API, ograniczeń i semantyki ponowień: [raport etapu 4](API-PROGRESS.md).

## Odbiór lokalny etapu 5 — 21.09.2026

166/166 UI oraz 4/4 po wizualnej korekcie modalu API; build frontendu poprawny. Trzy serie pomiarowe, każda po trzy próby, bez błędów JavaScript. Konfiguracja rzeczywistego lokalnego Nginx sprawdzona przez HTTP: gzip, cache zasobów z hashem, brak utrwalania index.html i fallback SPA. Szczegóły: [wydajność i przygotowanie wydania](PERFORMANCE-PROGRESS.md). Backend nie zmienił się od odbioru 143/3/1 etapu 4. Użytkownik dopuścił już screenshoty; sprawdzono lokalne widoki w obu motywach. Nadal bez wdrożenia, tagu i publikacji GitHub.
