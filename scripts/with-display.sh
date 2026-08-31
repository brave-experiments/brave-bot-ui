#!/usr/bin/env bash
# Run a command in front of a display.
#
# The drivers launch a real Electron window. macOS always has one, and a Linux desktop
# already exported $DISPLAY. A Cloud Agent VM or a CI box often has neither, and Electron
# then dies before the first assertion. xvfb-run is the fallback; if there is already a
# display we leave it alone. The demo is not wrapped — it films the screen it is on.
set -euo pipefail

if [ "$(uname -s)" = Darwin ] || [ -n "${DISPLAY:-}" ]; then
  exec "$@"
fi

if command -v xvfb-run >/dev/null 2>&1; then
  exec xvfb-run -a "$@"
fi

echo "no DISPLAY and no xvfb-run; install xvfb or run this on a machine with a screen" >&2
exit 1
