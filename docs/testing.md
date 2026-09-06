# Testing

The gates a change has to pass, and the drivers that prove the window works. Setup is in the [README](../README.md).

The Rust side has eight integration suites under `crates/bravebot-bridge/tests/` — the protocol
projections, dispatch, the layering rules the crate docs describe, and the refusal
guarantees that the security model rests on.

The interface is tested by **driving the real window** with Playwright, because the things
worth asserting here are the ones a screenshot cannot show — that a fold passes through
intermediate heights rather than snapping, that a column comes back at the width it left
at, that a control keeps keyboard focus through an animation.

| Command | Covers |
| --- | --- |
| `npm run drive` | Launch, list sessions, filter them by title and project, group them by checkout, fold one away, start one from a heading, open one |
| `npm run drive:resize` | Divider drags, the clamps, keyboard resizing, persistence |
| `npm run drive:columns` | Folding each side column, and what is remembered |
| `npm run drive:panels` | The context panels, the row of buttons that turns them on and off, and the transcript's tool runs |
| `npm run drive:markdown` | Markdown rendering, light and dark |
| `npm run drive:models` | Model defaults, composer placement, search and keyboard selection, turn payload, per-conversation persistence, and discovery error recovery. Also bot creation, Avatar refresh and layout, saved bot models, composer changes, and persistence after reload. Uses deterministic replies without paid inference. |
| `npm run drive:run` | Approving a command from the window, end to end through a live turn |
| `npm run drive:ask` | Answering a series of questions the planner asks, likewise live |
| `npm run drive:menu` | The application menu: what it offers, what it greys, and what it refuses to offer |
| `npm run drive:export` | Exporting a conversation to text, Markdown and PDF — with and without the tool calls, and what the file leaves out either way |
| `npm run drive:fork` | Cutting a session in two: that the fork holds the right half and the session it came from is untouched |
| `npm run drive:tree` | The file tree: listing, expanding, the dotfile toggle, the name filter, and that a session with no root and a symlink out of the project both list nothing |
| `npm run drive:theme` | Themes: that previewing repaints before anything is written down, that Escape restores exactly, that every derived token survives a palette, that editing a palette repaints without a relaunch, and that a PDF stays white regardless |
| `npm run drive:bots` | Bots: that the column has two lists and remembers which, that a bot survives a relaunch with what was typed into it, and that two bots have different faces while one bot keeps its own across a rename — asserted on the *form* the seed built, since the face is turning while it is looked at. Also the archive: that a bot put away survives field-for-field and comes back as itself, and that deleting one asks before it does anything |
| `npm run drive:packaged` | A built `.app`: that a release hides the developer items and finds its agent |
| `npm run drive:bot-turn` | A live turn as a bot: that a purpose nobody typed reaches the model, that the memory file is real and in the checkout, and that reopening the bot resumes the same session |
| `npm run drive:bot-memory` | That a bot is asked to keep its memory current without anybody asking it to: that one which has gone quiet is handed its briefing again with a line saying so, that the count resets on the nudge rather than on every turn, and that a turn the app sent is drawn as house-keeping in a reopened transcript rather than as a prompt |
| `node scripts/drive-turn.mjs` | A live inference request through the window, to prove the binary carries its credentials rather than inheriting them |
| `node scripts/drive-models-live.mjs` | Live inference before and after changing the conversation model, checking which model the agent actually used |
| `scripts/smoke-turn.sh` | A live turn straight through `bravebot-rpc`, no app |

`drive:menu` cannot press a menu's own keystroke: Playwright's keyboard reaches the web
contents over CDP, and an AppKit key equivalent never sees it. So it asserts the accelerator
*string* as a contract and drives the effect by clicking the item. The packaged case it cannot reach at all, because it drives a checkout;
`drive:packaged` covers that separately, against a real bundle. What is left for a hand is
⌘C/⌘V actually reaching the composer — the role assertion proves the item is there, only a
person proves the keystroke arrives.

Each driver launches the app, prints a line per assertion and leaves screenshots under
`/tmp/bravebot-ui/` or a driver-specific path in `/tmp`. Eight of the checks cost real tokens:
`drive:markdown`, `drive:run`, `drive:ask`, `drive:bot-turn`, `drive:bot-memory`, `drive-turn.mjs`,
`drive-models-live.mjs` and `smoke-turn.sh` send an
actual prompt. Live checks use the backend credentials configured in settings, the environment,
or the agent binary.

The drivers share `bravebot-ui.json`, so one that leaves a column folded — or a panel turned off —
would make the next one's measurements meaningless. `drive-columns.mjs` normalises the columns at
the start of a run and puts them back at the end, `drive-panels.mjs` turns every panel back on
before it measures one and again before it finishes, and `drive-tree.mjs` puts the file tree back
on before it tests it. Anything new in this
area should do the same, and a driver that seeds a fixture should replace its own key rather than
the file: the other keys are somebody's arrangement of this window.

`drive-theme.mjs` does the same for the `theme` key, and has one duty beyond the file: it writes
palettes into `themes/` beside it, so it removes the ones it wrote on the way out however it exits,
and removes the directory too if it was the one that made it.

## What CI runs

`.github/workflows/ci.yml` is the gate on a pull request, and it is not the same set as the
table above. Two jobs:

- **Typecheck** — `npm ci` with `ELECTRON_SKIP_BINARY_DOWNLOAD=1` (the Electron *package* is
  needed for types; the 100 MB binary is not, since nothing here launches a window) and then
  `npm run typecheck`.
- **Lint and test the bridge** — one checkout with submodules, so it compiles the same agent
  revision the gitlink pins, then `cargo clippy --all-targets --all-features -- -D warnings`
  and `cargo test --all`.

So Clippy *is* a lint step, on the Rust side; there is none on the TypeScript side, where `tsc`
is the whole gate. `cargo fmt --all -- --check` is deliberately absent: rustfmt would rewrite
around 490 lines of the bridge crate, mostly breaking method chains and one-line `assert!`
calls that are on one line on purpose, and reformatting the crate is a change to make on its
own rather than as a side effect of turning CI on. The reasoning for each of these lives in
comments in the workflow itself.

No `drive:*` driver runs in CI: they want a macOS runner and a display, and eight of the live checks spend
tokens.
