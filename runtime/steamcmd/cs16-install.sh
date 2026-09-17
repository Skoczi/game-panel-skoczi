#!/bin/sh
# Game Panel native HLDS recipe. No LinuxGSM, curl, GitHub scripts or hlds_run.
set -eu
case "${1:-}" in
    install) validate=validate ;;
    update) validate= ;;
    *) echo 'Expected install or update' >&2; exit 2 ;;
esac
cd /opt/steamcmd
# Valve's app 90 can require repeated downloads. Bound attempts; never import
# third-party appmanifest files or treat the presence of one binary as success.
attempt=1
while [ "$attempt" -le 3 ]; do
    if ./linux32/steamcmd +force_install_dir /data +login anonymous \
        +app_set_config 90 mod cstrike +app_update 90 $validate +quit; then
        if [ -x /data/hlds_linux ] && [ -s /data/cstrike/dlls/cs.so ] && [ -s /data/cstrike/maps/de_dust2.bsp ]; then
            mkdir -p /data/.steam/sdk32
            cp /opt/steamcmd/linux32/steamclient.so /data/.steam/sdk32/steamclient.so
            echo 'Native HLDS files verified.'
            exit 0
        fi
    fi
    echo "SteamCMD attempt $attempt did not produce a complete HLDS installation." >&2
    attempt=$((attempt + 1))
done
echo 'HLDS installation incomplete; existing data has not been deleted.' >&2
exit 1
