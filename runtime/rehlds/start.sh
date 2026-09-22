set -euo pipefail
cd /data/serverfiles
[[ "$MAX_PLAYERS" =~ ^[0-9][0-9]?$ ]] && (( 10#$MAX_PLAYERS >= 1 && 10#$MAX_PLAYERS <= 32 )) || ( echo 'Player limit must be 1-32'; exit 2; )
[[ "$MAP" =~ ^[A-Za-z0-9_-]+$ ]] || ( echo 'Invalid map name'; exit 2; )
[[ "$CFG" =~ ^[A-Za-z0-9_-]+\.cfg$ ]] || ( echo 'Config must be a .cfg filename without directories'; exit 2; )
export LD_LIBRARY_PATH=/data/serverfiles:/data/serverfiles/bin
exec ./hlds_linux "$@"
