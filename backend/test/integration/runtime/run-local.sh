#!/bin/sh
# Run from any directory. Only a newly created disposable container is removed.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../../../.." && pwd)
cd "$root"
name="gp-acceptance-$(date +%s)-$$"
image=gamepanel-acceptance:local
created=false
cleanup() {
  if [ "$created" = true ]; then docker rm -fv "$name" >/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
docker info >/dev/null
docker build -f backend/test/integration/runtime/Dockerfile -t "$image" .
docker run --privileged --label gamepanel.acceptance=true -d --name "$name" "$image" --storage-driver=overlay2 --host=unix:///var/run/docker.sock
created=true
docker exec "$name" sh -ec '
  attempt=0
  until docker info >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    [ "$attempt" -lt 60 ] || exit 1
    sleep 1
  done
  docker build -f backend/Dockerfile -t gamepanel-agent:ci .
  cd backend
  npm test
  npm run build
  GAMEPANEL_STORAGE_FAULT_TEST=1 npx tsx --test test/integration/storage-faults.test.ts
  GAMEPANEL_NODE_DOCKER_TEST=1 npx tsx --test test/integration/nodes.test.ts
'
