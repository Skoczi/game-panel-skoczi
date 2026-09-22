# Game icons and list presentation

Server lists combine the game icon and server name in their first column, followed
by Server IP, Server status, Server metrics, Power and Management. Card layouts are
unchanged. When a running server has monitoring enabled, its game observation and
map/player data replace the duplicate Running badge. Clicking this status still
opens history. Runtime errors, stopped servers and unavailable nodes retain their
runtime status; servers without monitoring retain their existing status badge.

Game Templates → General provides an icon library, Automatic and image upload.
The library includes separate CS 1.6, Source, GO and CS2 artwork plus TF2 and Garry's
Mod. Steam artwork is bundled locally; the browser never contacts Steam to display
an icon. Unknown games receive a generic gamepad. Asset attribution is recorded
in frontend/public/game-icons/SOURCES.md.

Uploads accept PNG, JPEG or WebP up to 2 MiB, normalized to a transparent 64 × 64 PNG
(up to 16 KiB). Optional template `icon` contains a library ID or the PNG data URL.
The icon travels with template export/import and the immutable installation snapshot.
Existing templates without the field preserve their canonical hashes. Changes to a
template apply to subsequent installations; existing server snapshots stay unchanged
and automatically recognized games still receive their default icons.

Nodes advertise `capabilities.templateIcons = 1`; installation with an explicit icon
is blocked on earlier agents before dispatch. Updating panel and agents is required
to install templates with explicit icons. Selecting Automatic omits the icon field.
