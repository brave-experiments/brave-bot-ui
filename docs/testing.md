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
| `npm run drive:run` | Approving a command from the window, end to end through a live turn |
| `npm run drive:ask` | Answering a series of questions the planner asks, likewise live |
| `npm run drive:menu` | The application menu: what it offers, what it greys, and what it refuses to offer |
| `npm run drive:export` | Exporting a conversation to text, Markdown and PDF — with and without the tool calls, and what the file leaves out either way |
| `npm run drive:fork` | Cutting a session in two: that the fork holds the right half and the session it came from is untouched |
| `npm run drive:tree` | The file tree: listing, expanding, the dotfile toggle, the name filter, and that a session with no root and a symlink out of the project both list nothing |
| `npm run drive:theme` | Themes: that previewing repaints before anything is written down, that Escape restores exactly, that every derived token survives a palette, that editing a palette repaints without a relaunch, and that a PDF stays white regardless |
| `npm run drive:bots` | Bots: that the column has two lists and remembers which, that a bot survives a relaunch with what was typed into it, and that two bots have different faces while one bot keeps its own across a rename — asserted on the *form* the seed built, since the face is turning while it is looked at. Also the archive: that a bot put away survives field-for-field and comes back as itself, and that deleting one asks before it does anything |
| `npm run drive:packaged` | A built `.app`: that a release hides the developer items and finds its agent |
| `npm run drive:astar` | One long piece of real work, start to finish: a new session in an empty checkout, every question it puts answered yes, and what the window has to show for it |
| `npm run drive:bot-turn` | A live turn as a bot: that a purpose nobody typed reaches the model, that the memory file is real and in the checkout, and that reopening the bot resumes the same session |
| `npm run drive:bot-memory` | That a bot is asked to keep its memory current without anybody asking it to: that one which has gone quiet is handed its briefing again with a line saying so, that the count resets on the nudge rather than on every turn, and that a turn the app sent is drawn as house-keeping in a reopened transcript rather than as a prompt |
| `node scripts/drive-turn.mjs` | A live inference request through the window, to prove the binary carries its credentials rather than inheriting them |
| `scripts/smoke-turn.sh` | A live turn straight through `bravebot-rpc`, no app |

`drive:menu` cannot press a menu's own keystroke: Playwright's keyboard reaches the web
contents over CDP, and an AppKit key equivalent never sees it. So it asserts the accelerator
*string* as a contract and drives the effect by clicking the item. The packaged case it cannot reach at all, because it drives a checkout;
`drive:packaged` covers that separately, against a real bundle. What is left for a hand is
⌘C/⌘V actually reaching the composer — the role assertion proves the item is there, only a
person proves the keystroke arrives.

`drive:astar` is the long one, and the only driver that follows a whole task rather than a
control. It starts a session in `/tmp/bravebot-astar`, sends a prompt that has to write a
library, build a page and photograph it running, and says yes to every question the agent
puts — a run in the half-hour range that answers twenty-odd cards. What it asserts is
what only a real turn can show: that a decision made in the window reaches the turn blocked
on it, that nothing can be sent past a question nobody has answered, and that the session is
in the list afterwards to be reopened. `ASTAR_BUDGET_MS` bounds it — thirty minutes by default — `ASTAR_DIR` moves the checkout it
builds in, `ASTAR_RESUME=1` sends a follow-up to the session already there instead of building
from nothing (`ASTAR_FOLLOW_UP` is what it says), and `ASTAR_INSPECT=1` opens that session and
reports what the panels say without spending a turn.

Each driver launches the app, prints a line per assertion and leaves screenshots under
`/tmp/bravebot-ui/` — `drive:astar` in `astar/` beneath it, since its run is long enough to be
worth keeping apart. Eight of them cost real tokens: `drive:markdown`, `drive:run`, `drive:ask`,
`drive:astar`, `drive:bot-turn`, `drive:bot-memory`, `drive-turn.mjs` and `smoke-turn.sh` send an
actual prompt, and `smoke-turn.sh` needs a shell where `direnv` has
loaded the agent's `.envrc`.

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

No `drive:*` driver runs in CI: they want a macOS runner and a display, and eight of them spend
tokens.
