set -euo pipefail
cd /data/serverfiles
[[ "$MAX_PLAYERS" =~ ^[0-9][0-9]?$ ]] && (( 10#$MAX_PLAYERS >= 1 && 10#$MAX_PLAYERS <= 32 )) || ( echo 'Player limit must be 1-32'; exit 2; )
[[ "$MAP" =~ ^[A-Za-z0-9_-]+$ ]] || ( echo 'Invalid map name'; exit 2; )
[[ "$SERVER_NAME" != *\"* && "$SERVER_NAME" != *\\* && "$SERVER_NAME" != *';'* && "$SERVER_NAME" != *$'\n'* && "$SERVER_NAME" != *$'\r'* ]] || ( echo 'Server name cannot contain quotes, backslashes, semicolons or line breaks'; exit 2; )
[[ "$CFG" =~ ^[A-Za-z0-9_-]+\.cfg$ ]] || ( echo 'Config must be a .cfg filename without directories'; exit 2; )
config="cstrike/$CFG"
[[ ! -L "$config" ]] || ( echo 'Config must not be a symbolic link'; exit 2; )
[[ -f "$config" ]] || touch "$config"
# Keep the owner's settings; update only hostname and remove an exact self-include.
[[ -e "$config.bak" ]] || cp -p -- "$config" "$config.bak"
tmp=$(mktemp "cstrike/.hostname.XXXXXXXX")
trap 'rm -f -- "$tmp"' EXIT
cp -p -- "$config" "$tmp"
written=0
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" =~ ^[[:space:]]*[Hh][Oo][Ss][Tt][Nn][Aa][Mm][Ee][[:space:]] ]]; then
    (( written )) || printf 'hostname "%s"\n' "$SERVER_NAME"
    written=1
  elif [[ "$line" =~ ^[[:space:]]*exec[[:space:]]+\"?"$CFG"\"?[[:space:]]*$ ]]; then
    continue
  else
    printf '%s\n' "$line"
  fi
done < "$config" > "$tmp"
(( written )) || printf 'hostname "%s"\n' "$SERVER_NAME" >> "$tmp"
mv -- "$tmp" "$config"
trap - EXIT
export LD_LIBRARY_PATH=/data/serverfiles:/data/serverfiles/bin
exec ./hlds_linux "$@"
