# bravebot-ui

A macOS interface to `bravebot` — the prompt-injection-resistant coding agent — in
a window instead of a terminal.

The app does not drive a terminal and does not parse one. It talks to a small Rust library
in this repository, `bravebot-bridge`, which depends on the agent as an ordinary Cargo
dependency and exposes it as a protocol. The agent itself is **never modified**: zero
files, zero new crates, zero refactors. That is a hard constraint on the design, not an
aspiration.

Sessions are the same sessions. The bridge reads and writes the records under `~/.bravebot`
that the terminal client uses, so a session begun in the app resumes with `bravebot --resume`,
and one begun in a terminal shows up in the app.

## Why a subprocess

The agent runs as a child process (`bravebot-rpc`) speaking newline-delimited JSON, rather than
being linked into Electron as a native addon. The deciding reason is the security model:
across a pipe, "the interface died" *is* a closed pipe, which the protocol already defines
as a refusal — it follows from the shape of the thing rather than from code remembering to
handle it. In-process, a renderer crash and an agent crash are one event, and there is no
surviving side left to refuse anything.

The full argument, and the alternative that was rejected, is in
[`docs/phase-0-rpc-protocol.md`](docs/phase-0-rpc-protocol.md) §1.1.

## What it looks like

Three columns, each side one resizable and foldable:

- **Sessions** — everything under `~/.bravebot/sessions`, newest first, and a button to start a
  new one against any directory.
- **Transcript** — the conversation, with the turn's tool calls gathered into runs that
  fold away, diffs for writes awaiting approval, and confined content shown as what it is
  rather than as text the model read.
- **Context** — what the session has touched: the plan, files read, writes and how far each
  got, and anything quarantined.

The two side columns fold to nothing from a chevron at either end of the transcript's
header, and their widths and fold states survive a relaunch.

## Layout

```
crates/bravebot-bridge/        the Rust library and the bravebot-rpc binary
  src/bridge.rs           session store access, turn driving, the Confirmer/Reporter/Sink
  src/wire.rs             the JSON projections of the protocol
  src/bin/bravebot-rpc.rs      read stdin, frame stdout, nothing else
  tests/                  eight integration suites, including the refusal guarantees
src/main/                 Electron main: one window, one child process, a narrow channel
src/preload/              the only thing the renderer can reach
src/renderer/             the React app
src/shared/               types both sides agree on
scripts/                  the bridge build, a live smoke test, and the app drivers
docs/                     the protocol design
```

## Prerequisites

- **macOS.** The window uses `hiddenInset` traffic lights and `sidebar` vibrancy.
- **Rust 1.88+** (`edition = "2024"`). This matches the agent's own floor; building against
  its crates with an older toolchain fails in *its* sources, which is a confusing place to
  discover a version problem.
- **Node 22+** and npm. Electron 44, React 19.
- **A checkout of `bravebot` as a sibling directory.** `crates/bravebot-bridge` depends
  on it by path — `../../../bravebot/crates/*` — so by default it must live at
  `~/repos/bravebot`. Set `BRAVEBOT_DIR` if it is elsewhere and adjust the paths
  in `crates/bravebot-bridge/Cargo.toml` to match.
- **`direnv`**, to pick up the agent's credentials at build time. See below.

## Setup

With this checkout and the agent's checkout side by side under `~/repos`:

```bash
cd ~/repos/bravebot-ui
npm install
npm run dev
```

`npm run dev` builds `bravebot-rpc` first and then starts the app with hot reload.

### Credentials, and why they are a build-time concern

`bravebot` captures its backend credentials at **compile** time (its
`crates/config/build.rs`). That is deliberate: a release binary is built where the secrets
are and used anywhere, so it does not demand them again from every directory it starts in.

This matters more for a window than for a terminal. `bravebot` is run from a shell that usually
has `direnv` loaded, so an unconfigured binary still finds what it needs in the
environment. An app launched from Finder has no such environment, and an unconfigured build
fails at the first inference request with `SERVICES_KEY_AICHAT is not set and was not built
in`.

So `scripts/build-bridge.sh` builds *through* `direnv` when the agent checkout has an
allowed `.envrc`, and says plainly what will happen when it does not. To set it up, in the
agent checkout:

```bash
cp .envrc.example .envrc     # then fill it in
direnv allow
```

Without credentials the app still starts, lists sessions and opens them — only inference
fails. That degraded mode is intentional, so the interface can be developed without
secrets.

`.cargo/config.toml` sets `BRAVEBOT_ALLOW_UNCONFIGURED_BUILD=1`, which opts development builds
into producing a binary that reads its credentials from the environment at run time. **A
packaged release must not rely on this**: it has to be built the way the agent's own
releases are, with the credentials present, or it will ship unable to reach the backend.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Build the bridge, then run the app with hot reload |
| `npm run bridge` | Build `bravebot-rpc` only, through `direnv` where it can |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Bridge, typecheck, then bundle main + preload + renderer into `out/` |
| `npm start` | Preview a built bundle without rebuilding |
| `cargo test -p bravebot-bridge` | The Rust suites |

TypeScript runs `strict`, plus `noUncheckedIndexedAccess`, `noUnusedLocals` and
`noUnusedParameters`. There is no lint step; `tsc` is the gate.

### Testing

The Rust side has eight integration suites under `crates/bravebot-bridge/tests/` — the protocol
projections, dispatch, the layering rules the crate docs describe, and the refusal
guarantees that the security model rests on.

The interface is tested by **driving the real window** with Playwright, because the things
worth asserting here are the ones a screenshot cannot show — that a fold passes through
intermediate heights rather than snapping, that a column comes back at the width it left
at, that a control keeps keyboard focus through an animation.

| Command | Covers |
| --- | --- |
| `npm run drive` | Launch, list sessions, open one |
| `npm run drive:resize` | Divider drags, the clamps, keyboard resizing, persistence |
| `npm run drive:columns` | Folding each side column, and what is remembered |
| `npm run drive:panels` | The context panels and the transcript's tool runs |
| `npm run drive:markdown` | Markdown rendering, light and dark |
| `node scripts/drive-turn.mjs` | A live inference request through the window, to prove the binary carries its credentials rather than inheriting them |
| `scripts/smoke-turn.sh` | A live turn straight through `bravebot-rpc`, no app |

Each driver launches the app, prints a line per assertion and leaves screenshots in
`/tmp/bravebot-ui/`. Three of them cost real tokens: `drive:markdown`, `drive-turn.mjs` and
`smoke-turn.sh` send an actual prompt, and `smoke-turn.sh` needs a shell where `direnv` has
loaded the agent's `.envrc`.

The drivers share the persisted layout file, so one that leaves a column folded would make
the next one's measurements meaningless. `drive-columns.mjs` normalises the columns at the
start of a run and puts them back at the end; anything new in this area should do the same.

## Build

```bash
npm run build
```

Three steps, in order: `scripts/build-bridge.sh` produces `bravebot-rpc`, `tsc --noEmit` gates
the types, and `electron-vite` bundles the main process, the preload and the renderer into
`out/`. `npm start` then previews that bundle.

There is no packaging step yet. A packaged app expects `bravebot-rpc` beside it as a resource —
`Bridge.binaryPath()` looks in `process.resourcesPath` when `app.isPackaged` and falls back
to `target/debug/bravebot-rpc` in development — and must be built with credentials present, per
the note above.

## Security posture

The app drives a tool whose whole point is that untrusted content cannot reach anything
that decides. A renderer with filesystem access would undo that from the outside, so:

- The renderer gets **no Node, no remote origins, and no navigation**. `contextIsolation`
  and `sandbox` are on, `nodeIntegration` and `webviewTag` are off, `will-navigate` is
  refused outright, and a link opens in the user's browser.
- The preload exposes a handful of functions and one subscription. Nothing else.
- The methods the renderer may call are an **allow-list** in the main process, not a
  pass-through. A generic "send anything to the agent" channel would make the preload's
  narrowness decorative.
- The bridge is a `Confirmer` implementation like any other, subject to the same rule as
  every other one: **every failure resolves to refusal.** A closed pipe, a crashed
  renderer, a malformed reply — all refuse.
- Confined content is labelled as confined wherever it appears, and the interface
  distinguishes what the planner actually read from what it was only told the name of.

## Further reading

[`docs/phase-0-rpc-protocol.md`](docs/phase-0-rpc-protocol.md) is the design document for
the bridge and its protocol: the message envelope (§4), every request (§7) and event (§8),
the trust model (§9), concurrency (§10), and what is deliberately out of scope (§11).

## Licence

MPL-2.0.
