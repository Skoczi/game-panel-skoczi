#!/usr/bin/env bash
# Copy the complete build context without local state or development artifacts.
sync_project_sources() {
  [[ "$(cd "$SOURCE_ROOT" && pwd -P)" != "$(cd "$APP_SOURCE_DIR" && pwd -P)" ]] || return 0
  tar -C "$SOURCE_ROOT" -cf - \
    --exclude='.git' --exclude='node_modules' --exclude='dist' \
    --exclude='.env' --exclude='.env.*' --exclude='test-results' --exclude='playwright-report' \
    --exclude='*.db' --exclude='*.sqlite*' --exclude='*.pem' --exclude='*.key' \
    backend frontend deploy docs runtime examples docker-images .dockerignore LICENSE LICENSE-2.0.txt NOTICE CHANGELOG.md README.md \
    | tar -C "$APP_SOURCE_DIR" -xf -
}
