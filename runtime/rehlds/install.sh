#!/bin/bash
set -euo pipefail
# Panel-owned recipe; no remote shell scripts are executed.
[[ "$MAX_PLAYERS" =~ ^[0-9]{1,2}$ ]] && (( MAX_PLAYERS >= 1 && MAX_PLAYERS <= 32 )) || { echo 'Player limit must be 1-32'; exit 2; }
[[ "$MAP" =~ ^[A-Za-z0-9_-]+$ ]] || { echo 'Invalid map name'; exit 2; }
test ! -e /data/serverfiles/hlds_linux || { echo 'Existing installation detected; refusing to overwrite it'; exit 2; }
test ! -e /data/hlds_linux || { echo 'Legacy flat installation detected; migrate or use a new server'; exit 2; }
mkdir -p /data/serverfiles /data/log
stage=$(mktemp -d /tmp/rehlds.XXXXXXXX)
curl --fail --location --proto '=https' --tlsv1.2 --retry 3 --connect-timeout 20 --max-time 180 \
  https://eserv.pl/runtime-assets/rehlds/rehlds-bin-3.15.0.896.zip -o "$stage/rehlds.zip"
printf '%s  %s\n' 997baeb7ef3842dab3e034d82dc651ebfe560c23b158adce660a6b97976b4e2b "$stage/rehlds.zip" | sha256sum -c -
# Extract only reviewed files from the verified archive, outside the server data.
unzip -q "$stage/rehlds.zip" 'bin/linux32/engine_i486.so' 'bin/linux32/hlds_linux' 'bin/linux32/filesystem_stdio.so' -d "$stage"
cd /opt/steamcmd
complete=0
for attempt in 1 2 3; do
  if ./linux32/steamcmd +force_install_dir /data/serverfiles +login anonymous +app_set_config 90 mod cstrike +app_update 90 -beta steam_legacy validate +quit; then
    if [[ -s /data/serverfiles/cstrike/dlls/cs.so && -s /data/serverfiles/cstrike/maps/de_dust2.bsp && -s /data/serverfiles/valve/valve.rc ]]; then complete=1; break; fi
  fi
  echo "Incomplete Steam download, attempt $attempt/3"
done
(( complete == 1 )) || { echo 'Steam download incomplete; installation stopped'; exit 1; }
install -m 755 "$stage/bin/linux32/engine_i486.so" /data/serverfiles/engine_i486.so
install -m 755 "$stage/bin/linux32/filesystem_stdio.so" /data/serverfiles/filesystem_stdio.so
install -m 755 "$stage/bin/linux32/hlds_linux" /data/serverfiles/hlds_linux
mkdir -p /data/.steam/sdk32
install -m 644 linux32/steamclient.so /data/.steam/sdk32/steamclient.so
if [[ ! -f /data/serverfiles/cstrike/server.cfg ]]; then
  printf '%s\n' '// Managed by the server owner through Game Config.' 'sv_lan 0' 'log on' > /data/serverfiles/cstrike/server.cfg
fi
touch /data/serverfiles/cstrike/banned.cfg /data/serverfiles/cstrike/listip.cfg
[[ -f /data/serverfiles/cstrike/mapcycle.txt ]] || printf '%s\n' de_dust2 > /data/serverfiles/cstrike/mapcycle.txt
printf '%s\n' 'ReHLDS 3.15.0.896' > /data/serverfiles/.gamepanel-engine-version
echo 'ReHLDS installed. No automatic updates or third-party plugins enabled.'
