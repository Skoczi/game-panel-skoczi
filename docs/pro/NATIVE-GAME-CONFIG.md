# Native Game Config

The existing Game Config tab now contains **Settings** and **Configuration files**.
The first preset is CS 1.6 / ReHLDS: identity, password and voice, round timings,
team rules and starting money. Other games retain their configuration file cards
unless their native template declares a form.

## Names and startup

- The panel label (`FFA`, `COD MOD`, `Deathrun`) remains independent of the game name.
- `hostname` in the active CFG is the source of the game name. The form reads and
  writes that file; no database alias or container name changes.
- Returning to the browser or waiting 20 seconds refreshes an unchanged form from
  the file. A dirty form is never silently refreshed; a conflicting save requires
  reloading before another attempt.
- The ReHLDS startup script no longer writes hostname, and new templates omit the
  old `SERVER_NAME` variable. Historical template snapshots and hashes stay intact.
- Runtime creation normalizes only the exact former panel-owned hostname-writing
  script. The current WAW2 template was checked read-only and matches this adapter;
  its other startup arguments, including custom parameters, are preserved.
- Existing containers retain their original Docker command until recreation. On
  the next panel start/restart, affected containers are recreated once with the
  corrected command. Automatic recovery preserves unrelated pending settings.
  Docker restarting an old container directly does not run this panel migration:
  complete the controlled compatibility restart during deployment before relying
  on hostname persistence. Arbitrary custom scripts are not rewritten.

## Files and saving

Values describe the file, not live cvars. Save never sends commands or restarts a
game. The game applies values when it next executes this file (normally a map
change or restart for server.cfg); other files/plugins may subsequently override them.

The configurator uses existing file read/write permissions, ETags, atomic saves
and file history. Review shows only changed settings and masks password values.
Absent keys are not filled with guessed defaults. A changed key replaces its last
simple assignment; prior assignments, comments, unrelated commands, spacing, BOM
and line endings are preserved. New keys append to the file.

Compound commands, block comments, unfinished quotes or complex assignments use
the file editor instead. The form accepts UTF-8 text up to 1 MiB. Quotes, backslashes,
semicolons and control characters in newly entered values are rejected. Missing
file versions disable saving; unconfirmed writes require a fresh read.

## Template contract

Optional `gameConfig` contains `format: "valve-cfg"`, a declared configuration file
`root` and `path`, and sections with `id`, `label`, `description`, and fields. Fields
have `key`, `label`, `description`, `type` (text/password/number/boolean/select), and
`apply` (map-change/restart). Numeric bounds/increments and select options are optional
where applicable. Maximum: 8 sections / 64 fields; existing 32 KiB template limit.
Use `gameConfig: false` to explicitly disable a form.

Game Templates → Game Config offers a CS 1.6 preset and section/field editing.
Publishing creates a new immutable version. Old CS 1.6 / ReHLDS snapshots with
a declared `cstrike/server.cfg` get a compatibility preset without modification.
The backend resolves the effective `+servercfgfile` argument (including `CFG` and custom parameters) to the active file; pending configuration is not used.
Templates with other paths use their declared file explicitly.

`GET /api/servers/:id/game-config` requires file read access and returns the resolved
definition only. Existing versioned file endpoints perform reads/writes. Agents
advertise `capabilities.gameConfigEditor = 1`; update the panel and agents together.
No database migration is required. Rebuild `backend` before running
`node runtime/rehlds/build-template.mjs` to regenerate the example template.

The default vanilla CS field ranges are informed by the non-REGAMEDLL_ADD branches
of [ReGameDLL_CS cvar handling](https://github.com/rehlds/ReGameDLL_CS/blob/master/regamedll/dlls/multiplay_gamerules.cpp).
Custom game DLLs may expose wider ranges; edit the template profile or use the file editor.
