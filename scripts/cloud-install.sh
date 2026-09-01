#!/usr/bin/env bash
# Prepare a Cloud Agent VM to build and drive this app.
#
# Cursor runs this as `install` while taking a Build, from the repository root. It has to
# be idempotent: a Build may run it against a disk that already has Rust, Electron, and a
# sibling `bravebot`. Disk state is what survives; exported variables do not, so anything
# later turns need (the sibling name, the GTK libraries) has to be on disk.
#
# The agent itself is not started here. Electron is a window, and the agent starts it when
# it drives.
set -euo pipefail

if [ "$(uname -s)" != Linux ]; then
  echo "scripts/cloud-install.sh is for the Cloud Agent Ubuntu VM, not $(uname -s)" >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# --- system libraries Electron and Xvfb need ------------------------------------------

sudo apt-get update -y

# Ubuntu 24.04 renamed several packages with a t64 suffix; 22.04 still has the old names.
# Try the current names first and fall back, so a Build does not die on the distro's age.
if ! sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb \
    libnss3 \
    libgbm1 \
    libxss1 \
    libx11-xcb1 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libasound2t64 \
    libgtk-3-0t64 \
    libatk1.0-0t64 \
    libatk-bridge2.0-0t64 \
    libcups2t64 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation
then
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    xvfb \
    libnss3 \
    libgbm1 \
    libxss1 \
    libx11-xcb1 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libasound2 \
    libgtk-3-0 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libpango-1.0-0 \
    libcairo2 \
    fonts-liberation
fi

# --- Rust 1.88+ (edition 2024) --------------------------------------------------------

if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.cargo/env"
fi
if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.88
  # shellcheck source=/dev/null
  . "$HOME/.cargo/env"
fi
rustup toolchain install 1.88
rustup default 1.88

# --- Node 22+ -------------------------------------------------------------------------

# Ubuntu 24.04 ships Node 18, which is under the floor, so the packages come from
# NodeSource. Their own instructions pipe `setup_22.x` into a root shell; this adds their
# key to a keyring and pins a source to it instead. Nothing off the network is executed —
# `curl` feeds `gpg --dearmor` — and apt then checks every nodejs package against that key
# on this install and on every later one, which the setup script never did.
node_major() { node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0; }
if ! command -v node >/dev/null 2>&1 || [ "$(node_major)" -lt 22 ]; then
  # The setup script used to pull these in on its own; doing the keyring by hand means
  # asking for them, and a minimal image has neither.
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates gnupg
  # `install -d` rather than `mkdir -p`: the mode is the point, and 24.04 has the
  # directory already while 22.04 does not.
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | sudo gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

# --- sibling `bravebot` ---------------------------------------------------------------
# Cargo.toml points at ../../../bravebot/crates/* from crates/bravebot-bridge, which is a
# directory named `bravebot` sitting next to this checkout. GitHub calls the repository
# `brave-bot`. BRAVEBOT_DIR is what build-bridge.sh reads; it does not rewrite the path
# deps. A Cloud Agent started against this repo alone will not have the sibling until we
# put it there.

parent="$(cd .. && pwd)"
if [ -e "$parent/bravebot/crates/agent" ]; then
  echo "bravebot already at $parent/bravebot"
elif [ -e "$parent/brave-bot/crates/agent" ]; then
  ln -sfn "$parent/brave-bot" "$parent/bravebot"
  echo "symlinked $parent/brave-bot -> $parent/bravebot"
else
  if [ ! -w "$parent" ]; then
    echo "cannot write $parent/bravebot — Cargo path deps need a sibling named bravebot" >&2
    exit 1
  fi
  git clone --depth 1 https://github.com/brave-experiments/brave-bot.git "$parent/bravebot"
fi
export BRAVEBOT_DIR="$parent/bravebot"

# --- this repo ------------------------------------------------------------------------

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

# build-bridge.sh uses SERVICES_KEY_AICHAT when Cloud Secrets have set it, and otherwise
# produces the unconfigured binary. Inference then fails; listing sessions does not.
npm run bridge

# A missing .so is the usual reason Electron dies on a Cloud VM, and Playwright then
# reports a launch timeout. Fail the Build here with the library name.
electron_bin="$root/node_modules/electron/dist/electron"
if [ -x "$electron_bin" ]; then
  missing="$(ldd "$electron_bin" | awk '/not found/ {print}' || true)"
  if [ -n "$missing" ]; then
    echo "electron is missing libraries:" >&2
    echo "$missing" >&2
    exit 1
  fi
fi

echo "cloud-install: rustc $(rustc --version), node $(node --version), bravebot at $BRAVEBOT_DIR"
