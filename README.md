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


## What it does

Three columns, each side one resizable and foldable — **Sessions** (everything under
`~/.bravebot/sessions`, with a second tab for bots), **Transcript**, and **Context** (the
plan, files read, writes, anything quarantined, and a file tree of the working folder).

Five kinds of question are put in the transcript and answered there: a **write** (as a
diff), a **command** to run (as the argv), whether the planner may **read what a command
printed**, whether to **vouch** for a quarantined path, and a **series of questions** the
planner wants to put to you. The turn blocks until one is answered, and every failure to
answer — a closed window, a crash, a dropped pipe — is a refusal.

Beyond that: **forking** a conversation in front of one of your own prompts; **export** to
text, Markdown or a PDF drawn by the same React components as the window; **bots**, which
are named persistent agents with a purpose, a memory and a face, each pinned to one
checkout; twenty-two **themes** plus any palette you write into `themes/`; and a menu that
writes down every key.

The long version — every panel, the fork rules, how a bot's purpose and memory work, the
key table, the directory layout, what is remembered across launches, and the palette format
— is in [`docs/interface.md`](docs/interface.md).

## Prerequisites

- **macOS.** The window uses `hiddenInset` traffic lights and `sidebar` vibrancy.
- **Rust 1.88+** (`edition = "2024"`). This matches the agent's own floor; building against
  its crates with an older toolchain fails in *its* sources, which is a confusing place to
  discover a version problem.
- **Node 22+** and npm — though CI builds on Node 24, so that is the version a change is
  actually proved against. Electron 44, React 19.
- **The agent, as the `vendor/bravebot` submodule.**
  [`brave-experiments/brave-bot`](https://github.com/brave-experiments/brave-bot.git), pinned
  to a revision by the gitlink this repository commits. `crates/bravebot-bridge` depends on
  it by path, so a clone without submodules compiles nothing. Moving the pin, and why it is
  pinned at all, is in [`docs/setup.md`](docs/setup.md).
- **`direnv`**, to pick up the agent's credentials at build time. See below.

## Setup

One checkout, with the agent inside it. `--recurse-submodules` is not optional: without it
`vendor/bravebot` is an empty directory and the bridge does not build.

```bash
git clone --recurse-submodules https://github.com/brave-experiments/brave-bot-ui.git
cd brave-bot-ui
npm install
npm run dev
```

Already cloned without it? `git submodule update --init`.

`npm run dev` builds `bravebot-rpc`, names the development app for the menu bar, and then
starts the app with hot reload.

(The repository is `brave-bot-ui`; the npm package, the bundle identifier and most prose
here say `bravebot-ui`. The agent's own repository is `brave-bot` and its binary is
`bravebot`. Both spellings are load-bearing where they appear.)

## Credentials

`bravebot` captures its backend credentials at **compile** time (its
`crates/config/build.rs`). That is deliberate: a release binary is built where the secrets
are and used anywhere, so it does not demand them again from every directory it starts in.

This matters more for a window than for a terminal. `bravebot` is run from a shell that
usually has `direnv` loaded, so an unconfigured binary still finds what it needs in the
environment. An app launched from Finder has no such environment, and an unconfigured build
fails at the first inference request with `SERVICES_KEY_AICHAT is not set and was not built
in`.

So `scripts/build-bridge.sh` builds *through* `direnv`, and says plainly what will happen
when it cannot. It takes a shorter route when the variables are already in its own
environment, and that is the arrangement to prefer — the values in one file outside every
checkout, and a `.envrc` here that reads them:

```bash
mkdir -p ~/.config/bravebot
$EDITOR ~/.config/bravebot/env      # NAME=value lines, one per variable
chmod 600 ~/.config/bravebot/env

cd brave-bot-ui
echo 'dotenv_if_exists ~/.config/bravebot/env' > .envrc
direnv allow
```

The names are the ones the agent's `.envrc.example` *exports* — `SERVICES_KEY_AICHAT`,
`BRAVE_SERVICES_KEY_ID`, `BRAVE_AI_CHAT_ENDPOINT`, `BRAVE_AI_CHAT_DEFAULT_MODEL`, and
`BRAVE_AI_CHAT_PREMIUM_ENDPOINT` if you have one — rather than the `DEV_`/`PROD_` inputs its
`case` builds them from. The first three are required and the build fails without them; the
model name is not, and a build missing it quietly settles for `automatic`.

Keeping them in `vendor/bravebot/.envrc` instead also works, and `BRAVEBOT_DIR` can point at
an older sibling checkout. [`docs/setup.md`](docs/setup.md) has the argument for preferring
the file outside every checkout. Either way `.envrc` and `~/.config/bravebot/env` are
per-machine and neither is a substitute for building a release with the credentials present.

**Without credentials the app still starts, lists sessions and opens them — only inference
fails.** That degraded mode is intentional, so the interface can be developed without
secrets. `.cargo/config.toml` sets `BRAVEBOT_ALLOW_UNCONFIGURED_BUILD=1`, which opts
development builds into producing a binary that reads its credentials from the environment
at run time. A packaged release must not rely on it: it has to be built the way the agent's
own releases are, with the credentials present, or it will ship unable to reach the backend.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Build the bridge, name the app, run it with hot reload |
| `npm run bridge` | Build `bravebot-rpc` only, through `direnv` where it can |
| `npm run name-dev-app` | Name the development app "Brave Bot" in the menu bar |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Bridge, typecheck, then bundle main + preload + renderer into `out/` |
| `npm start` | Preview a built bundle without rebuilding |
| `npm run package` | Build a `.app` into `dist/` |
| `npm run drive:*` | Drive the real window with Playwright — see [testing](docs/testing.md) |
| `npm run demo` | Walk the whole product at human speed; `--record` films it |
| `cargo test --all` | The Rust suites, the same command CI runs |

TypeScript runs `strict`, plus `noUncheckedIndexedAccess`, `noUnusedLocals` and
`noUnusedParameters`; there is no eslint or prettier, and `tsc` is the whole gate on that
side. The Rust side is linted by `cargo clippy --all-targets --all-features -- -D warnings`.
Both, plus `cargo test --all`, are what CI runs on a pull request.

The interface is tested by driving the real window, because the things worth asserting here
are the ones a screenshot cannot show — that a fold passes through intermediate heights
rather than snapping, that a column comes back at the width it left at, that a control keeps
keyboard focus through an animation. There are seventeen `drive:*` drivers plus two live
smoke tests, and eight of the nineteen spend real tokens. [`docs/testing.md`](docs/testing.md) lists what each
one covers and what CI does and does not run. [`docs/demo.md`](docs/demo.md) covers
`npm run demo`, which performs rather than asserts and films itself.

## Build and packaging

```bash
npm run build      # bridge, typecheck, bundle into out/
npm start          # preview that bundle
npm run package    # bridge, bundle, then a .app into dist/
```

`npm run build` is three steps in order: `scripts/build-bridge.sh` produces `bravebot-rpc`,
`tsc --noEmit` gates the types, and `electron-vite` bundles the main process, the preload
and the renderer into `out/`.

`npm run package` runs the bridge build and the bundle — **not** the typecheck; run
`npm run typecheck` yourself first — and then `@electron/packager` builds
`dist/Brave Bot-darwin-<arch>/Brave Bot.app`. `bravebot-rpc` is copied in as a resource,
which is where `Bridge.binaryPath()` looks when `app.isPackaged`; the `target/debug`
fallback is development only, so packaging is the only way that branch is ever exercised.
Naming the bundle is also how the menu bar gets the right word: AppKit reads `CFBundleName`
before any of our code runs.

A bundle built from a development checkout has no credentials, so it lands in the degraded
mode described above — now inside an app that cannot inherit an environment from a shell.
There is no signing or notarisation step either, so the bundle is for testing rather than
for giving to anybody.
## Security posture

The app drives a tool whose whole point is that untrusted content cannot reach anything
that decides. A renderer with filesystem access would undo that from the outside, so:

- The renderer gets **no Node, no remote origins, and no navigation**. `contextIsolation`
  and `sandbox` are on, `nodeIntegration` and `webviewTag` are off, `will-navigate` is
  refused outright, and a link opens in the user's browser.
- The preload exposes a handful of functions and one subscription. Nothing else.
- **The renderer never composes a filesystem path.** A project directory arrives from a
  native picker or from a list the main process keeps; it is never a string the window made
  up. The file tree keeps that promise for reading a folder too: it names a *session* and a
  path relative to that session's directory, and the main process holds the roots — learned
  from what the agent answered when the session was opened, forked or made. There is no
  channel that accepts an absolute path, and a handle no session is running under lists
  nothing. Two checks, not one: the lexical one (`shared/files.ts`) refuses `..` and anything
  absolute before it becomes a syscall, and the main process then resolves the pair and
  requires `realpath` to land inside the root's own `realpath` — so a symlink out of the
  project is refused rather than followed. Nothing on that channel reads a file's
  *contents*, only names and kinds, so it adds no route by which something the agent was
  refused could reach the renderer anyway.
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

- [`docs/phase-0-rpc-protocol.md`](docs/phase-0-rpc-protocol.md) — the design document for
  the bridge and its protocol: the message envelope (§4), every request (§7) and event (§8),
  the trust model (§9), concurrency (§10), and what is deliberately out of scope (§11).
- [`docs/interface.md`](docs/interface.md) — the window: every panel, forking and export,
  bots, keys, the directory layout, what is remembered, and themes.
- [`docs/setup.md`](docs/setup.md) — why the agent is a pinned submodule and why the
  credentials live outside every checkout.
- [`docs/testing.md`](docs/testing.md) — the drivers, and what CI runs.
- [`docs/demo.md`](docs/demo.md) — recording a demo, and why nothing real is filmed.

## Licence

MPL-2.0.
