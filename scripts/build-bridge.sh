#!/usr/bin/env bash
# Build bua-rpc, with the agent's credentials baked in where they can be found.
#
# brave-user-agent captures its backend credentials at COMPILE time (see
# crates/config/build.rs upstream). That is deliberate: a release binary is built where
# the secrets are and used anywhere, so it does not demand them again from every
# directory it starts in.
#
# It matters more for a GUI than for the CLI. `bua` is run from a terminal, and that
# terminal usually has direnv loaded, so an unconfigured binary still finds what it needs
# in the environment. An app launched from Finder or `npm run dev` has no such
# environment, so an unconfigured build fails at the first inference request with
# "SERVICES_KEY_AICHAT is not set and was not built in".
#
# So: build through direnv when the agent checkout has an allowed .envrc, and say plainly
# what will happen when it does not.

set -uo pipefail

AGENT="${BUA_AGENT_DIR:-$HOME/repos/brave-user-agent}"

build() { cargo build -p bua-bridge "$@"; }

if [ ! -d "$AGENT" ]; then
  echo "warning: no agent checkout at $AGENT (set BUA_AGENT_DIR)." >&2
  echo "         Building without credentials; inference will fail at run time." >&2
  build "$@"
  exit $?
fi

if [ -n "${SERVICES_KEY_AICHAT:-}" ]; then
  # Already in a configured shell. Nothing to add.
  build "$@"
  exit $?
fi

if command -v direnv >/dev/null 2>&1 && [ -f "$AGENT/.envrc" ]; then
  if direnv exec "$AGENT" true 2>/dev/null; then
    echo "building with credentials from $AGENT/.envrc" >&2
    direnv exec "$AGENT" cargo build -p bua-bridge "$@"
    exit $?
  fi
  echo "warning: $AGENT/.envrc is not allowed. Run: direnv allow $AGENT" >&2
fi

cat >&2 <<'MSG'
warning: building bua-rpc WITHOUT backend credentials.

  The app will start, list sessions, and open them. The first inference request will
  fail with "SERVICES_KEY_AICHAT is not set and was not built in".

  To fix: copy .envrc.example to .envrc in the agent checkout, run `direnv allow` there,
  then build again.
MSG
build "$@"
