#!/usr/bin/env bash
#
# Public-playground supervisor.
#
# The demo is deliberately open — no auth, anyone can write, delete, supersede, break it. That is
# only safe because it is disposable: this loop re-seeds the vault and wipes app state on a fixed
# interval, and again whenever the app exits. A defaced or emptied vault heals itself.
#
# It restarts the whole app process rather than mutating a running vault, so the reset is atomic:
# no half-written files, no index race, no leftover tokens a visitor created. Because the container
# has NO persistent volume, a Railway restart resets everything too — the interval just guarantees
# it happens even if nobody restarts it.
set -u

cd /app || { echo "[demo] /app missing — is this built FROM the engram-app image?"; exit 1; }

export VAULT_DIR="${VAULT_DIR:-/demo-vault}"
export ENGRAM_DATA_DIR="${ENGRAM_DATA_DIR:-/demo-data}"
export AUTH_DISABLED="true"            # open dashboard — this is the whole point of a playground
export GIT_SYNC_ENABLED="false"        # never push the demo vault anywhere
export ENGRAM_DISABLE_GIT_SYNC="1"     # and skip the boot git-sync entirely
export NODE_ENV="production"

# How often to wipe back to the seed. Default 6h — short enough that launch-day graffiti doesn't
# linger, long enough that someone mid-exploration isn't reset out from under. Override on Railway.
RESET_INTERVAL_SECONDS="${RESET_INTERVAL_SECONDS:-21600}"

reseed() {
  rm -rf "$ENGRAM_DATA_DIR"
  mkdir -p "$ENGRAM_DATA_DIR"
  /demo/seed.sh "$VAULT_DIR"
}

echo "[demo] reset interval: ${RESET_INTERVAL_SECONDS}s · vault: $VAULT_DIR"

# Reset on SIGTERM so a graceful Railway shutdown still leaves a clean slate for next boot.
trap 'kill "${APP:-0}" 2>/dev/null; exit 0' TERM INT

while true; do
  reseed
  bun run start &
  APP=$!
  echo "[demo] app started (pid $APP), next reset in ${RESET_INTERVAL_SECONDS}s"

  # Sleep in the background so a crash is noticed immediately instead of after the full interval.
  sleep "$RESET_INTERVAL_SECONDS" &
  TIMER=$!
  wait -n "$APP" "$TIMER"

  # Whichever fired first, tear the app down and loop into a fresh reseed.
  kill "$APP" "$TIMER" 2>/dev/null
  wait "$APP" 2>/dev/null
  echo "[demo] cycling — reseeding"
  sleep 2
done
