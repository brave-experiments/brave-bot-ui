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
  fold away, and confined content shown as what it is rather than as text the model read.
  Five kinds of question are put here and answered here: a **write** (as a diff), a
  **command** to run (as the argv, plus the binary each name resolved to), whether the
  planner may **read what a command printed** (as the bytes in full), whether to **vouch**
  for a quarantined path, and a **series of questions** the planner wants to put to you —
  choices to pick from, or your own words. The turn blocks until one is answered, and every
  failure to answer — a closed window, a crash, a dropped pipe — is a refusal. For the last
  of the five that means *no answers at all* rather than a decline per question: a decline
  somebody made and a question that never reached them must not look alike.
- **Context** — what the session has touched: the plan, files read, writes and how far each
  got, and anything quarantined.

The two side columns fold to nothing from a chevron at either end of the transcript's
header, and their widths and fold states survive a relaunch.

### The name in the menu bar

The bold word beside the Apple menu is the one part of the menu a template cannot set: AppKit
reads it from the running bundle's `CFBundleName` before any JavaScript runs, and
`app.setName` does not touch it — that renames `app.name`, which `app.getPath('userData')` is
built from, so using it would move `layout.json` and orphan every remembered column.

Unpackaged, the running bundle is Electron's own, so `scripts/name-dev-app.mjs` renames it.
It runs from `npm run dev` and from `postinstall`, because an `npm install` restores the
original. If the menu bar ever says "Electron" again, `npm run name-dev-app` puts it back.

The real fix is a packaging step with a `productName`, which does not exist yet.

## Keys

The menu is where these are written down, which is most of why it exists — before it there
was no way to find out that ⌘↵ sent a prompt.

| Key | What |
| --- | --- |
| `⌘N` | New session |
| `⇧⌘W` | Close the session — `⌘W` still closes the window |
| `⌘↵` | Send |
| `⌘.` | Cancel the running turn |
| `⌥⌘←` / `⌥⌘→` | Fold the session list / the context panel |
| right-click | A session row, or anything in the transcript |
| `Esc` | Cancel, from the composer |

`Esc` is the one that is not in a menu. As an accelerator it would fire with no session open
and would fight every other use of the key, so it stays where it was: a convenience local to
the composer.

**No key answers a question.** The five the agent can ask — a write, a command, whether the
planner may read output, whether to vouch, and a series of questions — are answered in the
transcript and nowhere else. An approval is a claim that somebody looked at the evidence,
and a keystroke can be typed from muscle memory into a window whose contents changed a frame
ago. The absence is structural: no command id names an approval, and the dispatch table in
`src/renderer/commands.ts` is not given the callbacks that answer.

## Layout

```
crates/bravebot-bridge/        the Rust library and the bravebot-rpc binary
  src/bridge.rs           session store access, turn driving, the Confirmer/Reporter/Sink
  src/wire.rs             the JSON projections of the protocol
  src/bin/bravebot-rpc.rs      read stdin, frame stdout, nothing else
  tests/                  eight integration suites, including the refusal guarantees
src/main/                 Electron main: one window, one child process, a narrow channel
  menu.ts                 the application menu, built from the shared command list
  recents.ts              the projects opened before, which only this side writes
src/preload/              the only thing the renderer can reach
src/renderer/             the React app
  commands.ts             what a chosen menu item does — and what it deliberately cannot
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
| `npm run name-dev-app` | Name the development app "Brave Bot" in the menu bar (see below) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Bridge, typecheck, then bundle main + preload + renderer into `out/` |
| `npm start` | Preview a built bundle without rebuilding |
| `npm run package` | Build a `.app` into `dist/` (see Packaging) |
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
| `npm run drive:run` | Approving a command from the window, end to end through a live turn |
| `npm run drive:ask` | Answering a series of questions the planner asks, likewise live |
| `npm run drive:menu` | The application menu: what it offers, what it greys, and what it refuses to offer |
| `npm run drive:packaged` | A built `.app`: that a release hides the developer items and finds its agent |
| `node scripts/drive-turn.mjs` | A live inference request through the window, to prove the binary carries its credentials rather than inheriting them |
| `scripts/smoke-turn.sh` | A live turn straight through `bravebot-rpc`, no app |

`drive:menu` cannot press a menu's own keystroke: Playwright's keyboard reaches the web
contents over CDP, and an AppKit key equivalent never sees it. So it asserts the accelerator
*string* as a contract and drives the effect by clicking the item. The packaged case it cannot reach at all, because it drives a checkout;
`drive:packaged` covers that separately, against a real bundle. What is left for a hand is
⌘C/⌘V actually reaching the composer — the role assertion proves the item is there, only a
person proves the keystroke arrives.

Each driver launches the app, prints a line per assertion and leaves screenshots in
`/tmp/bravebot-ui/`. Five of them cost real tokens: `drive:markdown`, `drive:run`, `drive:ask`,
`drive-turn.mjs` and `smoke-turn.sh` send an actual prompt, and `smoke-turn.sh` needs a shell where `direnv` has
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

### Packaging

```bash
npm run package
```

Bridge, typecheck, bundle, then `@electron/packager` builds `dist/Brave Bot-darwin-<arch>/Brave
Bot.app`. `bravebot-rpc` is copied in as a resource, which is where `Bridge.binaryPath()` looks
when `app.isPackaged` — the `target/debug` fallback is development only, so packaging is the
only way that branch is ever exercised.

Naming the bundle is also how the menu bar gets the right word in a release: AppKit reads it
from `CFBundleName` before any of our code runs. `scripts/name-dev-app.mjs` is the equivalent
hack for `npm run dev`; here it is simply the bundle's own name.

**A bundle built from a development checkout has no credentials.** It starts, lists sessions
and opens them, and fails at the first inference request — the degraded mode described above,
now inside an app that cannot inherit an environment from a shell. A real release has to be
built the way the agent's own releases are. There is no signing or notarisation step either,
so the bundle is for testing rather than for giving to anybody.

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
- An answer must be an answer to the question that was asked. Each of the five has its own
  reply method, and the bridge checks the request id **and** the kind against what is
  actually outstanding — so an approval cannot land on something nobody was shown.
- Answers to a series are held to the questions they answer: an index that names no choice
  is dropped, a single-choice question never comes back with two, and a selection with
  nothing left in it is a decline rather than an empty choice.
- A command's output reaches the window in full, because the person deciding whether the
  planner may read it has to be reading it themselves. It is released for a screen and
  stops there: approving is what puts it in the model's context, and that path runs
  through the agent.

## Further reading

[`docs/phase-0-rpc-protocol.md`](docs/phase-0-rpc-protocol.md) is the design document for
the bridge and its protocol: the message envelope (§4), every request (§7) and event (§8),
the trust model (§9), concurrency (§10), and what is deliberately out of scope (§11).

## Licence

MPL-2.0.
