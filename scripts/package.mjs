// Build a packaged app for this machine.
//
// Everything the app needs at run time is already in `out/` — the main process, the preload
// and the renderer, all bundled — so packaging is mostly a matter of saying what to leave
// behind. What has to be *added* is the agent: `Bridge.binaryPath()` looks for
// `bravebot-rpc` in `process.resourcesPath` when `app.isPackaged`, and falls back to the
// `cargo` output only in development. So the binary is copied in as a resource, and the
// packaged app is the only build where that path is ever taken.
//
// On macOS the bundle is named here, which is also the only way the menu bar gets the right
// word in a release: AppKit reads it from `CFBundleName` before any of our code runs.
// `scripts/name-dev-app.mjs` does the same job for `npm run dev` by renaming Electron's own
// bundle; this does it properly, by building one of our own. Linux has no equivalent: the
// window manager titles the frame, and the executable is simply called Brave Bot.
//
// Credentials: a bundle built from a development checkout carries a `bravebot-rpc` that reads
// its credentials from the environment, which a double-clicked app does not have. It will
// start, list sessions and open them, and fail at the first inference request. That is the
// documented degraded mode, not a packaging fault — a real release has to be built with the
// credentials present. See the README.
import { packager } from '@electron/packager'
import { existsSync, readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

const AGENT = 'target/debug/bravebot-rpc'
if (!existsSync(AGENT)) {
  console.error(`no agent binary at ${AGENT} — run \`npm run bridge\` first`)
  process.exit(1)
}
if (!existsSync('out/main/index.js')) {
  console.error('no bundle in out/ — run `electron-vite build` first')
  process.exit(1)
}

const platform = process.platform
if (platform !== 'darwin' && platform !== 'linux') {
  console.error(`packaging is not set up for ${platform}`)
  process.exit(1)
}

const paths = await packager({
  dir: '.',
  out: 'dist',
  name: 'Brave Bot',
  appVersion: version,
  platform,
  arch: process.arch === 'arm64' ? 'arm64' : 'x64',
  overwrite: true,
  prune: true,
  asar: true,
  extraResource: [AGENT],
  ...(platform === 'darwin' ? { appBundleId: 'dev.bravebot.ui' } : {}),
  // What not to carry. `target` is the Rust build directory and is gigabytes of object
  // files; `src` and `crates` are sources whose output is already in `out/`. Leaving any of
  // them in would ship the whole workshop with the furniture.
  ignore: [
    /^\/src($|\/)/,
    /^\/crates($|\/)/,
    /^\/target($|\/)/,
    /^\/docs($|\/)/,
    /^\/dist($|\/)/,
    /^\/scripts($|\/)/,
    /^\/\.git($|\/)/,
    /^\/\.cargo($|\/)/,
    /^\/Cargo\.(toml|lock)$/,
    /^\/tsconfig\.json$/,
    /^\/electron\.vite\.config\.ts$/,
  ],
})

for (const path of paths) console.log(`packaged: ${path}`)
