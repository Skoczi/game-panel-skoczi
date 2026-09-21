# Game Panel PRO 2.0.52

- File Editor saves directly, including when the game changed the file after opening it. Writes remain atomic; the previous contents are kept in file history within its size and retention limits.
- Native backups and restore preserve internal relative symlinks with missing targets, including the optional `libSDL2.so` link in existing CS 1.6 servers. Unsafe links remain blocked.
- File history has a padded modal, a clear empty state and shorter controls. Loading a version still requires Save to apply it.
- Backup name and retention fields have visible borders and spacing. The archive list comes first; storage details, legacy archives and operation metadata are expandable.
- Files is now File Editor. Removed the extra server context strip; disabled power buttons retain their tooltips.
- Compact node selector with location and availability on one row. All nodes remains the default.
- One Game Servers view: node links and installation shortcuts open the shared list with that node selected. The old runtime list is removed.
- Long names wrap within the name column; CPU and RAM values keep their units on one line. Console buttons and the quick-console heading use shorter labels.
- Matching page and tab headings, with a compact loading state.
- Removed Resources, announcements, Follow Us and Trustpilot from the panel and its settings.
- Configurable favicon: HTTPS URL or PNG, ICO, JPEG and WebP upload. The default icon now uses Game Panel PRO styling.
- Root administrators can edit user access across every node. Failed permission reads block saving, and grants use the global server identity.

Update the panel and agents together, agents first. Game containers do not need a restart. The settings record gains a favicon field; retain a database snapshot alongside previous images and configuration for rollback.

Validation: 149 backend tests, 176 browser tests, and production builds for backend and frontend. Docker runtime and deployment checks also run in CI.
