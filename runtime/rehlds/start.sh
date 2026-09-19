set -euo pipefail
cd /data/serverfiles
[[ "$MAX_PLAYERS" =~ ^[0-9][0-9]?$ ]] && (( 10#$MAX_PLAYERS >= 1 && 10#$MAX_PLAYERS <= 32 )) || ( echo 'Player limit must be 1-32'; exit 2 )
[[ "$MAP" =~ ^[A-Za-z0-9_-]+$ ]] || ( echo 'Invalid map name'; exit 2 )
# GoldSrc config syntax does not safely quote these characters. Never evaluate
# user input as shell code or permit it to introduce another game command.
[[ "$SERVER_NAME" != *\"* && "$SERVER_NAME" != *\\* && "$SERVER_NAME" != *';'* && "$SERVER_NAME" != *$'\n'* && "$SERVER_NAME" != *$'\r'* ]] || ( echo 'Server name cannot contain quotes, backslashes, semicolons or line breaks'; exit 2 )
# Stock Steam server.cfg contains its own hostname. Keep the owner's config
# untouched, then apply the template variable on startup and every map change.
printf 'exec server.cfg\nhostname "%s"\n' "$SERVER_NAME" > cstrike/gamepanel-startup.cfg
export LD_LIBRARY_PATH=/data/serverfiles:/data/serverfiles/bin
exec ./hlds_linux "$@"
