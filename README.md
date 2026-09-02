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
  got, and anything quarantined. A row of connected buttons at the top of the column turns
  each panel on and off; a panel that is off keeps everything it knew, including its fold and
  which folders were open in its tree, so turning it back on does not undo any of that — and, last, the one panel that reads the disk rather than the
  transcript: a **file tree** of the folder the session is working in. Directories list when
  you open one rather than up front, dot-prefixed entries sit behind a toggle, each file
  carries a two-letter badge for its type, and a box above the tree filters by name — which
  searches what has been read and says so, since the tree is listed a folder at a time. A
  double-click hands a file to whichever app the system assigns its type. It re-reads the
  folder when a turn finishes, which is the moment its contents can have changed.

The two side columns fold to nothing from a chevron at either end of the transcript's
header, and their widths and fold states survive a relaunch.

### Forking

Hover a prompt you wrote and a fork appears beside it; right-clicking one offers **Fork From
Here** as well, and both do the same thing. That begins a session holding everything said
*before* that prompt, and puts the prompt itself in the composer to be edited and asked
differently — which is the usual reason to want one: a conversation that went somewhere
unhelpful, and a wish to go back rather than to start again from nothing.

The session it came from is not touched. A fork is a session of its own from the first moment,
with its own id, and — like a new session — it writes no record until it has something to say.
It inherits what the parent had answered about trusting the directory, and the commands vouched
for there, since it is the same person in the same checkout.

The cut is made by the agent, on its own conversation, in front of a message rather than in
front of a row on screen. A transcript is a projection of the exchange, so what crosses is
where the prompt falls among the prompts and what it said; the two are checked against each
other, and a fork that cannot be placed exactly is refused rather than made in roughly the
right place. `docs/phase-0-rpc-protocol.md` §7.1 has the argument in full.

A forked session says so in its header, with a link back to the session it came out of, which
opens it at the prompt the cut was made in front of. The session list marks a fork beside its
name. All three are the same mark — the control on a prompt, the banner, and the row — because
they are the same idea. None of it can live in the agent's own record — that has no field for a
parent, and it is rewritten after every turn — so the lineage comes from a file this app keeps
beside the recents list, written by the main process from what the agent answered rather than
from anything the window asked for.

An **Export** button sits beside Send, and File › Export offers the same three formats:
plain text, Markdown, or a PDF that keeps the window's own bubbles. What it writes by default
is the *conversation* — what was asked and what came back — and never the diffs, approval
cards or confined blobs. That is the same argument the per-entry Copy makes: those things are
evidence laid out to be read in place, and a document made out of one reads like a record of
the exchange without being one.

**Include Tool Calls**, above the formats in both menus, adds the steps between: the same
verb, target and outcome the transcript draws on a line, and nothing more. It is off to begin
with, because the usual reason to export a session is to show somebody the exchange, and it
is not remembered across launches — it is answered beside the format, by whoever knows who
the file is for. (It would belong in the save sheet itself, next to the filename; a native
save panel takes no controls of ours.) Either way the file ends with a line saying what it
left out, and that line says what the file actually carried.

The PDF is drawn by a second renderer entry point using the same React components the window
uses, rather than by assembling a string of HTML — so a reply's markdown is gated on the way
to paper by exactly what gates it on screen. See `src/main/export.ts` for why that is worth a
whole extra window.

### Bots

The left column has two lists. The **Sessions** tab is everything above; the **Bots** tab is the
people who have one.

A bot is a name, a purpose somebody wrote, a memory it keeps, and one checkout it works in. Behind
it is a single session that is *resumed* rather than begun again — so where a session is an
occasion, a bot is somebody, and the tab holds the second because a list that answered both
questions would answer neither well. A bot's sessions do not appear in the sessions list: one
record openable from two places is one that could be open twice, each half of the window believing
it had the conversation.

Each bot has a face: a small three-dimensional figure, built with three.js from a seed minted when
the bot was made, turning slowly. The seed is *stored* rather than derived from the name, because a
face that changed when a bot was renamed would not be a face.

The brief was friendly and approachable, and the figures take that literally — round, large-headed,
big low-set eyes with a white catchlight in each, and no mouth, because a fixed mouth is either a
grin that never fits what the bot just said or a line that reads as sullen.

Each is painted in **one** colour from a fixed set, with its parts told apart by *shade* of it
rather than by a second hue: the head is the colour itself, the body a deeper version, and the small
pieces on top — an ear, a bobble, a collar — a paler one. So a bot is "the blue one" rather than
"the blue and yellow one", which is a thing somebody can hold in their head about eight bots at
once. The shades are far apart on purpose; one step of difference reads as a shadow rather than as a
different part, and the figure goes back to being one blob at 38 pixels.

The set is primaries and near-primaries — the colours of moulded plastic — and it deliberately holds
**no orange and no brown**. They are muted rather than pure: each is its primary at roughly two
thirds of full saturation, pulled a little toward mid lightness. Fully saturated versions came
first and shouted — eight of them down a column, each small and each at maximum chroma, is a lot of
noise beside a list of quiet grey text, and the avatar ends up competing with the name it belongs
to. What is kept is the *hue*, which is the part doing the identifying: a bot is still recognisably
the blue one or the green one. `yellow` and `lime` are the pair that needs watching, since muting
moves everything toward grey and two hues 40° apart converge on the way — `lime` is pushed greener
and darker than a straight muting would give it, to keep the two apart at 38 pixels. These were first built in the window's own accent, on
the argument that every colour here means something and a bot picking a hue would say something it
did not mean; that turned out to be wrong in practice for a reason the argument could not see. The
accent is a warm orange, and a warm orange sphere with two eyes in it is not an abstract mark, it is
a *face* — the whole thing read as skin. A figure this simple is read as a body before it is read as
anything else, so the colour has to say "painted object" loudly enough to stop that, which a dusty
blue does and no shade of orange can. A single hue makes that rule stricter rather than
looser: there is no second colour to carry the signal if the first one fails to.

The cost, stated plainly: the figures no longer follow a theme. A palette somebody writes repaints
the window and leaves the bots alone. That is the right trade for a face — one that changed colour
with the furniture would be a worse identity than one that does not — but it is a trade.

What else differs between them is the head, what is on top of it, the ears, the set of the eyes, and
the body.

Two things about it are load-bearing rather than decorative:

- **One WebGL context, however many bots.** A page gets a limited number — Chromium's cap is around
  sixteen, and past it the *oldest* context is dropped rather than the newest refused, so a long
  list would silently blank the rows at the top. There is one renderer drawing into one offscreen
  canvas, and each avatar is a plain 2D canvas the result is copied into.
- **The motion is a function of the clock, not of frames.** A figure turns at the same rate on a
  busy machine as an idle one, a dropped frame is skipped rather than accumulated, and two avatars
  mounted a minute apart are at the same point in the turn. Each one's offset into the cycle comes
  from its seed, so a column of them does not move as a block. The loop stops when nothing is on
  screen and when the window is hidden.

Where there is no WebGL to be had, the same seed draws a flat mirrored mark instead, in the same
colour and shades — a list of bots with no faces is a worse list, but a list that failed to draw its rows
because of a graphics driver would be the tail wagging the dog. See `src/renderer/avatar/` and
`src/renderer/components/BotAvatar.tsx`.

#### How a purpose reaches the model

The agent has no persona field, and it is not modified here. `Task` offers a prompt, some files and
a home directory; the system prompt belongs to the build, and `AGENTS.md` is global or per-checkout
rather than per-bot — writing one into somebody's repo would clobber theirs. Splicing a purpose
into the prompt is out too: every prompt is appended to the shared `~/.bravebot/history`, and a
charter poured into somebody's recall is not a feature.

So a bot is handed a **file to read**, and there are two of them:

- **The briefing**, `<userData>/bots/<slug>/ground.md`, composed by the main process from the bot's
  name, its purpose, and whatever its memory currently says. It goes to a turn as `dropped`, which
  is the read deliberately *not* confined to the workspace. It lives outside the checkout precisely
  so the planner cannot rewrite what defines it — the agent may write inside the workspace and
  nowhere else, and this is nowhere else.
- **The memory**, `<checkout>/.bravebot-ui/bots/<slug>.md`, which is inside the checkout because
  that is the only place the agent *can* write. That is the whole mechanism: the bot is told where
  its memory is and asked to keep it current, and it edits the file with its ordinary write tool.
  Nothing parses what a model said; the change the agent applied is the record. The folder ignores
  itself, so it never becomes a change nobody made. What that write is *gated* on is below, and is
  not what it looks like.

Only one file is attached, and the memory is copied *into* the briefing rather than sent beside it.
Every attached file becomes its own user message, and the agent's compaction keeps only the last
two of those verbatim — two attachments would mean the window a compaction preserves is spent
entirely on this app's own injections.

#### When it is said again

Compaction always cuts from the front, so a briefing at the top of a session is the first thing it
takes. The signal that it has is **not** the `compacting` phase: that is emitted before compaction
is attempted, so it also fires when there was nothing worth compacting, and then on every round of
a conversation that is over budget and cannot get under it. A bot re-grounded off that would be
re-grounded on every turn forever, which — given that each attachment stays in the conversation —
makes the problem worse.

What is watched instead is the size of the conversation's **archive**, which `turn.done` and
`session.open` both report. It only rises, it rises exactly once per compaction that actually
happened, and it is written into the record, so a session resumed in a new process knows it without
having watched it happen. A bot is re-grounded when that figure has gone up, and when its session
has just been opened.

#### What a memory write is actually gated on

Not on it being the memory. A memory write goes through the agent's ordinary write gate
(`Policy::write_needs_approval`), whose rule is about **integrity** rather than about which file it
is: *trusted data to a trusted path is written without a prompt*, because for data to be trusted the
turn must have observed nothing untrusted, and the destination only gains trust by it.

Both halves are true of a bot's memory in the ordinary case. The destination is trusted because this
app *names* the file — naming is what vouches for it — and a turn that has only read its own
checkout has seen nothing untrusted. So a bot exploring its project and writing down what it found
**does so without asking**, and the record is the `Update` line in the transcript and the row in the
Writes panel rather than a card somebody pressed.

The prompt appears exactly where it matters. A turn that *has* touched untrusted content — a fetched
page, a command's output, a quarantined file — is asked before it may write to the memory, because
that write would turn a trusted path untrusted. The gate is on prompt injection reaching the memory,
not on the memory changing.

This section said the opposite first, and so did the briefing handed to the model: that every edit
would be shown as a diff before it happened. It was false — found by filming it, watching the Writes
panel say `APPLIED` with no card in the transcript. A false promise in a briefing is worse than
none, since it is the model telling somebody something the app does not do. Tightening it further is
not available from here: there is no "always ask about this path" upstream, and adding one would be
a change to a repository this app does not modify. The briefing says what is true instead — that
the edit is on the record rather than in front of a card.

Two more things are honestly imperfect and worth knowing:

- **The turn compaction happens in runs without the briefing.** It can fire on the first round.
  Nothing can inject mid-turn, so the summary the agent writes is what carries the gist through;
  the mitigation is keeping a purpose short enough that re-reading it is cheap.
- **Memory the model wrote is re-admitted as trusted context.** Naming a file vouches for it, so
  what the bot wrote about itself last week is trusted this week. Combined with the gate above, a
  bot that has only ever read its own checkout accumulates memory nobody was asked about — visible
  in the transcript every time, but not consented to each time.

#### What the window cannot do

`turn.send` takes two lists of file paths and admits both to the planner as trusted context.
Nothing else a renderer can say has that reach — the file tree is confined to roots the main
process learnt from the agent, the folder picker is native, and the preload has never carried a
file's contents in either direction. So the renderer may not name either list: they are stripped
from any `turn.send` arriving on the general channel, and a bot's turn goes through
`bravebot:bots:send`, which is handed a *bot* and composes the paths itself.

### The name in the menu bar

The bold word beside the Apple menu is the one part of the menu a template cannot set: AppKit
reads it from the running bundle's `CFBundleName` before any JavaScript runs, and
`app.setName` does not touch it — that renames `app.name`, which `app.getPath('userData')` is
built from, so using it would move `bravebot-ui.json` and orphan every remembered column.

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
| `↑` `↓` `⏎` `Esc` | In the theme picker: preview, keep, and put back what was there |
| `Esc` | Cancel, from the composer — or clear the session filter, from the filter box |

`Esc` is the one that is not in a menu. As an accelerator it would fire with no session open
and would fight every other use of the key, so it stays where it was: a convenience local to
whichever field has it, meaning the composer and the filter box above the session list.

The filter box itself has no key of its own, nor does the toggle beside it that groups the
sessions under the checkout each was started in. Both are always on screen under **New
session**, so there is nothing to reveal, and a ⌘F that only ever moved focus one field would
be a shortcut for something already in view.

Clicking a group's name folds it away and brings it back, and the **+** beside its count
starts a session in that checkout — the same thing **New session** does, minus the folder
picker, since the heading already knows which folder. A checkout that has since been deleted
or moved is refused by the bridge with `not_a_directory` rather than failing quietly. A live filter reaches into a
folded group regardless — a heading with nothing under it is the opposite of what somebody
who just typed a search asked for — and the fold is still there when the box is cleared.

Grouping and which groups are folded are both remembered between launches, in a file of its
own beside the one holding the column widths: which way you like your list is not a per-run
thought, and one hand-edited preference should not cost you the other. The *folded* ones are
what is written down rather than the open ones, so a checkout started since last launch
arrives open instead of hidden behind a heading nobody has ever collapsed.

### Tooltips

A `title` is added where hovering says something the screen does not, and nowhere else. That
is three cases: a control with no room for a label (the column divider, whose double-click
reset is otherwise invisible), text the layout clipped (paths in the context panel, the
checkout in the header, a session's title in a narrow column), and a fold's verb — the name
stays put and `aria-expanded` carries the state, so *show* or *hide* goes in the tooltip.

A link a reply wrote carries its destination, for the reason a browser puts one in the
status bar: the link text was written by the model and need not describe where it goes.

The approval buttons deliberately have none. Their labels are already whole sentences —
`Don't run`, `Let the planner read it` — so a tooltip could only repeat them, and a popup
over an approval card covers the diff or the argv the decision rests on. The exception is
**Run and don't ask again**, whose tooltip lists the programs the vouch would cover, which
is the one thing its label cannot say.

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
  state.ts                bravebot-ui.json: everything remembered, one key per shape
  files.ts                listing and opening inside a session's own folder
  recents.ts              the projects opened before, which only this side writes
  theme.ts                the palettes on offer: the built-ins, plus JSON in themes/
src/preload/              the only thing the renderer can reach
src/renderer/             the React app
  commands.ts             what a chosen menu item does — and what it deliberately cannot
  theme.ts                putting a palette on the window, as DOM rather than as a render
  components/ThemePicker.tsx  the picker, which previews on the window behind it
src/shared/               types both sides agree on
  theme.ts                the palette format, ported from the agent's own theme.rs
scripts/                  the bridge build, a live smoke test, and the app drivers
docs/                     the protocol design
```

### What is remembered

One file, `bravebot-ui.json` under `app.getPath('userData')`, with a key per shape:

| Key | What it holds |
| --- | --- |
| `layout` | The column widths and which side columns are folded |
| `view` | Whether the session list is grouped by checkout, and which headings are shut |
| `panels` | Which panels in the context column are turned **off** |
| `recents` | The projects opened before, newest first |
| `forks` | Which session came out of which |
| `theme` | Which palette the window is painted in, by name |

A file rather than `localStorage`, because the renderer is loaded from `file://` and Chromium
discards storage for that origin between launches — measured, not assumed.

One file, but not one judgement: `src/shared/state.ts` decides nothing itself. It delegates each
key whole to the validator that already owned that shape — `parseLayout`, `parseView`,
`parsePanels`, `parseRecents`, `parseForks` — so a hand-edited grouping flag still cannot cost
somebody their column widths. Every write goes through `src/main/state.ts`, which replaces exactly
one key and leaves the rest of the file as it found it, and what lands on disk is always the parsed
state rather than the object a caller passed.

The renderer reaches four of those keys, and only through a channel of its own per shape:
`layout`, `view`, `panels` and `theme`. `recents` and `forks` are written by the main process alone, from a
native picker and from what the *agent* answered — the window can read them and has no way to
write a line into either.

This replaces `layout.json`, `view.json`, `recents.json` and `forks.json`. Those are read once, on
the first launch after the change, so nobody loses their columns to a rename; they are then left
where they are and never read again.

### Themes

`View ▸ Theme…` opens a picker over the transcript. Moving the cursor repaints the window behind
it, Enter keeps the choice, Escape puts back what was there.

`brave` is the default and means what this window has always looked like: the macOS palette in
`styles.css`, following the system between light and dark. It is not a theme that happens to match
— under `brave` no theme is applied at all, which is why it costs nothing, why the native sidebar
blur survives it, and why an exported PDF stays white however dark the window is.

Twenty-one named schemes are compiled in beside it. A palette somebody writes goes in `themes/`,
beside `bravebot-ui.json` under `userData`; the picker prints the path, and the window follows the
file as it is edited rather than needing a relaunch. A file taking the name of a built-in replaces
it. A broken one is not a theme, and does not appear.

A palette names nine things — a ground, an ink, a quieter ink, and one each for finished, failed,
running, a confinement, the session's own voice and the person at the keyboard:

```json
{ "defs": { "ground": "#2e3440" },
  "background": "ground", "text": "#d8dee9", "muted": "#616e88",
  "ok": "#a3be8c", "fail": "#bf616a", "running": "#ebcb8b",
  "accent": "#b48ead", "note": "#d08770", "primary": "#88c0d0" }
```

Nine and not nineteen: `styles.css` mixes the window's other tokens from these in a
`:root[data-theme]` block, so writing a palette is choosing colours rather than computing a rule at
fourteen percent of your own ink. Any key left out, or set to `"none"`, is inherited — a palette
that only changes the accent is two lines long, and one that inherits its background keeps the
window blur that an opaque ground would cover.

The format is a port of `crates/tui/src/theme.rs` in the agent's repository, kept faithful so that
a palette written for one is recognisable in the other and `nord` means the same thing in both. It
is a port and not a link: nothing here reads anything the agent owns. The agent is a subprocess
this window drives, not something it is installed alongside, and a window that could not paint
itself until the terminal had been run once would be depending on something it was never promised.

## Prerequisites

- **macOS.** The window uses `hiddenInset` traffic lights and `sidebar` vibrancy.
- **Rust 1.88+** (`edition = "2024"`). This matches the agent's own floor; building against
  its crates with an older toolchain fails in *its* sources, which is a confusing place to
  discover a version problem.
- **Node 22+** and npm. Electron 44, React 19.
- **A checkout of the agent as a sibling directory, named `bravebot`.**
  [`brave-experiments/brave-bot`](https://github.com/brave-experiments/brave-bot).
  `crates/bravebot-bridge` depends on it by path — `../../../bravebot/crates/*` — so it must
  sit beside this checkout under the name `bravebot`.

  **The repository is called `brave-bot` and the directory has to be called `bravebot`**, so
  a plain `git clone` puts it in the wrong place and `cargo` fails on a missing path rather
  than on anything that names the real problem. Clone it with the directory spelled out, as
  the Setup below does. `scripts/build-bridge.sh` looks for credentials in that same
  sibling by default (overridable with `BRAVEBOT_DIR`, which still wins). A checkout
  reached through a symlink is resolved to its real path, because direnv's allow list is
  keyed on that. If cargo's path dependencies and the credential checkout are not the
  same tree, inference fails even when `.envrc` looks fine. If the agent lives somewhere
  else, set `BRAVEBOT_DIR` *and* adjust the paths in
  `crates/bravebot-bridge/Cargo.toml` to match.

  A path dependency rather than a pinned git revision is deliberate for now: the two move
  together, and pinning a revision while both are being written would mean a bump per
  change. It is the wrong answer for a release build, and
  [`docs/phase-0-rpc-protocol.md`](docs/phase-0-rpc-protocol.md) §14 is where that is
  being decided.
- **`direnv`**, to pick up the agent's credentials at build time. See below.

## Setup

The two checkouts sit side by side, and both directory names matter — the agent's because
`Cargo.toml` points at it by path, this one only for the `cd`:

```bash
cd ~/repos
git clone https://github.com/brave-experiments/brave-bot.git bravebot
git clone https://github.com/brave-experiments/brave-bot-ui.git bravebot-ui

cd bravebot-ui
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
| `npm run demo` | Walk the whole product at human speed, recording it (see Recording a demo) |
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
| `npm run drive:bots` | Bots: that the column has two lists and remembers which, that a bot survives a relaunch with what was typed into it, and that two bots have different faces while one bot keeps its own across a rename — asserted on the *form* the seed built, since the face is turning while it is looked at |
| `npm run drive:bot-turn` | A live turn as a bot: that a purpose nobody typed reaches the model, that the memory file is real and in the checkout, and that reopening the bot resumes the same session |
| `npm run drive:packaged` | A built `.app`: that a release hides the developer items and finds its agent |
| `npm run drive:astar` | One long piece of real work, start to finish: a new session in an empty checkout, every question it puts answered yes, and what the window has to show for it |
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
puts — a run in the twenty-minute range that answers twenty-odd cards. What it asserts is
what only a real turn can show: that a decision made in the window reaches the turn blocked
on it, that nothing can be sent past a question nobody has answered, and that the session is
in the list afterwards to be reopened. `ASTAR_BUDGET_MS` bounds it, `ASTAR_RESUME=1` sends a
follow-up to the session already there instead of building from nothing, and
`ASTAR_INSPECT=1` opens that session and reports what the panels say without spending a turn.

Each driver launches the app, prints a line per assertion and leaves screenshots in
`/tmp/bravebot-ui/`. Seven of them cost real tokens: `drive:markdown`, `drive:run`, `drive:ask`,
`drive:astar`, `drive:bot-turn`, `drive-turn.mjs` and `smoke-turn.sh` send an actual prompt, and `smoke-turn.sh` needs a shell where `direnv` has
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

### Recording a demo

The drivers above assert; `npm run demo` performs. Same Playwright, same real window, same
class names — but paced in beats rather than in milliseconds, and it films itself:

```bash
npm run demo -- --record             # the whole product, no model calls, to a .mov
npm run demo -- --record --live      # plus a real turn, an approval card and a question
npm run demo -- --only 07-fork       # one scene, for a retake
npm run demo -- --list               # what it would film, in order
```

`--record` points macOS's own `screencapture` at the window's rectangle and drops a WebVTT
beside the film with every caption already timed to it — so a run produces the video *and*
its subtitle track, rather than producing something somebody then has to remember to record.
It needs Screen Recording permission for whatever is running it; without that the film comes
out empty and the run says so.

The capture is then re-encoded, because the raw one is not a file anybody wants to be sent.
`screencapture` records at the display's own resolution and refresh rate — retina, at **120
fps** — which is around 45 MB for three minutes of a mostly stationary window, and nothing in
its flag list changes that. So it is fixed afterwards: halved to logical resolution, dropped to
30 fps, and encoded at a CRF where the app's own text is still sharp at 1:1. That is about 4 MB
for the same footage. `--width 0` keeps the retina resolution, `--crf` and `--fps` move the
other two, `--keep-raw` keeps the capture as well, and `--no-compress` skips it.

This is the one step that wants something the repository does not depend on: **`ffmpeg`**. A
machine without it keeps the raw capture and is told why it is large. macOS's own `avconvert`
was tried instead and is not an alternative — it re-encodes at the source resolution and frame
rate, and saved almost nothing.

#### Nothing real is filmed

A demo of this app is a demo of somebody's session list, and a session list is a record of
what they have actually been doing: real project names, real prompts, real paths, and — in
the file tree — the real contents of a real directory. So the demo does not film the machine.

It launches with `$HOME` pointed at a **demo world** under `/Users/Shared/bravebot-ui-demo`.
That is the whole mechanism: the agent finds `~/.bravebot` by reading `HOME` and nothing else
(`crates/agent/src/home.rs`), and Electron derives `userData` from it too, so the session list,
the recents, the column widths and the file tree are all the world's. `/Users/Shared` rather
than the home directory because every path in it ends up on screen, and a home directory has
somebody's name in it.

The world holds two invented checkouts — `harbour-lights` and `tide-tables`, copied out of
`scripts/demo/project/` — and the sessions the demo earned in them. **Earned, not written.**
Seeding the records by hand would mean encoding the agent's own on-disk format here: a format
that is upstream, is not ours, and is rewritten after every turn. A demo that hard-coded it
would break silently on a bump, months later, in a recording somebody was about to publish. So
the world is built by driving the product — a few real prompts, once, cached for every run
afterwards. It costs a few tokens the first time and nothing after that, and `--rebuild` throws
it away and does it again. `scripts/demo/world.mjs` is all of it.

`--real` films this machine's own sessions instead. That is for working on the demo, not for
recording one.

Two things are drawn into the page for the camera, because the window alone cannot show them.
Playwright drives Electron over CDP and CDP moves no cursor, so the pointer is drawn in and
glided to each target, the real one is hidden with `cursor: none` (two pointers, one of them
motionless, reads as a rendering fault), and each click leaves a ripple. And a caption names
each feature as it plays, docking to whichever half of the window the pointer is not in.

| Flag | What |
| --- | --- |
| `--record [path]` | Film the window. Default lands in `/tmp/bravebot-ui/demo/` |
| `--live` | Include the live scene: a real turn, a command approval, a series of questions |
| `--speed 1.4` | Multiply every pause. Higher is slower; the whole video re-times at once |
| `--size 1600x1000` | Frame it larger than the app's own default of 1280×820 |
| `--theme light` | `dark` (default), `light` or `system` |
| `--session <words>` | Pin which stored session gets filmed, so a second take matches the first |
| `--only <id>` / `--from <id>` | One scene, or from one scene on — for retakes |
| `--countdown 5` | Hold before the first scene, and before the recorder starts |
| `--width 1280` | Encoded width. `0` keeps the capture's retina resolution |
| `--fps 30` / `--crf 28` | The other two encoding dials. Higher CRF is smaller and softer |
| `--keep-raw` / `--no-compress` | Keep the raw capture too, or skip encoding entirely |
| `--rebuild` | Throw the demo world away and build it again |
| `--world <path>` | Somewhere other than `/Users/Shared/bravebot-ui-demo` |
| `--real` | Film this machine's own sessions. **Not sanitised** |

A `--real` run restores the state file it shares with the drivers, so a video that dragged the
columns somewhere cinematic does not leave `drive:columns` measuring the demo's idea of a
layout. A world run cannot reach that file at all.

**A feature that earns a `drive:*` driver earns a scene.** One file per feature under
`scripts/demo/scenes/`, listed in `scripts/demo/manifest.mjs`, which is checked against the
directory at startup — a scene added and not listed is an error rather than a scene that
silently never plays. A feature that needs something to happen in the world to be visible
also earns a prompt in `RECIPES` in `scripts/demo/world.mjs`, and a `--rebuild`.

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

[`docs/phase-0-rpc-protocol.md`](docs/phase-0-rpc-protocol.md) is the design document for
the bridge and its protocol: the message envelope (§4), every request (§7) and event (§8),
the trust model (§9), concurrency (§10), and what is deliberately out of scope (§11).

## Licence

MPL-2.0.
