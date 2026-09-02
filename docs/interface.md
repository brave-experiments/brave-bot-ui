# The interface

What the window shows and why it is shaped that way. The setup and build instructions
are in the [README](../README.md); the protocol underneath is in
[`phase-0-rpc-protocol.md`](phase-0-rpc-protocol.md).

- [What it looks like](#what-it-looks-like)
- [Forking, and export](#forking)
- [Bots](#bots)
- [The name in the menu bar](#the-name-in-the-menu-bar)
- [Keys](#keys) and [tooltips](#tooltips)
- [Layout](#layout)
- [What is remembered](#what-is-remembered)
- [Themes](#themes)

## What it looks like

Three columns, each side one resizable and foldable:

- **Sessions** — everything under `~/.bravebot/sessions`, newest first, and a button to start a
  new one against any directory. A second tab beside it holds the **bots**: named, persistent
  agents with a purpose and a memory, each pinned to one checkout. See *Bots* below.
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

Every piece has a thin drawn edge around it, in a dark version of its own colour, and the whole
figure sits on a faint neutral disc. Neither is decoration. The pale pieces — a bobble, an ear, a
collar — sit against the *page* rather than against the head, and on a light theme pale paint on an
off-white column was invisible: two of the six traits were being thrown away in light mode. The
edge gives them a line to be seen by on any background and separates an ear from the head it is
pressed against; the disc gives every avatar the same shape in the row and a surface behind it. The
lighting is mostly flat — a strong key on a saturated colour clips a channel and drains the hue —
with a hemisphere light to put the underside of the head into shadow so a sphere reads as a sphere
rather than a disc; the numbers are set so that a surface facing the camera renders at exactly the
paint's hex.

Two things about it are load-bearing rather than decorative:

- **One WebGL context, however many bots.** A page gets a limited number — Chromium's cap is around
  sixteen, and past it the *oldest* context is dropped rather than the newest refused, so a long
  list would silently blank the rows at the top. There is one renderer drawing into one offscreen
  canvas, and each avatar is a plain 2D canvas the result is copied into.
- **The motion is a function of the clock, not of frames.** A figure turns at the same rate on a
  busy machine as an idle one, a dropped frame is skipped rather than accumulated, and two avatars
  mounted a minute apart are at the same point in the turn. Each one's offset into the cycle comes
  from its seed — as does the rate of its bob — so a column of them does not move as a block. The
  loop stops when nothing is on screen and when the window is hidden, and it draws at thirty frames
  a second rather than sixty: at a twenty-four-second turn the difference is a fraction of a pixel
  a frame, and half the frames is half the GPU for the same picture.

The face also knows what its bot is doing, and shows it as posture rather than expression — what a
person shows across a room. A bot in the list looks slowly about; one that has never been spoken to
faces forward and only blinks; the one on screen looks at the reader and holds; one whose turn is
running looks down and a little aside, as at a page, and blinks more often; and one whose last turn
ended in an error tilts its head — "hm" — and lets it go over a few seconds. Coming out of a turn
that did not fail, it nods, once. None of that is a mouth or an eyebrow: an animated expression
beside a stack trace looks like the bot is apologising, and a posture does not. Two smaller things
sell the rest: the blink is lopsided and every fourth one is a double, which is the one aperiodic
thing in the motion; and whatever is on the head — a bobble, an aerial — is on a spring and lags
the head by a frame, which is follow-through, the oldest trick in animation. Under
`prefers-reduced-motion` the continuous motion stops; what is left is a still figure that blinks and
takes up its posture when its state changes.

Where there is no WebGL to be had, the same seed draws the same face flat instead — head, body, the
two eyes and their catchlights, the same shades and the same drawn edge, read from the same traits —
so a bot is recognisably itself on a machine with no GPU. A list of bots with no faces is a worse
list, but a list that failed to draw its rows because of a graphics driver would be the tail wagging
the dog. See `src/renderer/avatar/` and
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

#### When it is asked to write

None of the above makes a bot *remember*. It only puts the instruction in front of it, and the
instruction is in the briefing — so for as long as a session ran without being re-grounded, nothing
was asking. In practice a memory changed when somebody said "remember that", and not otherwise.

Two things close that, and neither of them attaches anything to an ordinary turn:

- **A compaction is answered with a turn of the app's own.** A rise in the archive is the one moment
  memory is unambiguously *for*, since it is the only thing that survived. Instead of waiting for
  the next prompt to carry the briefing, the main process sends a turn saying so, grounded — which
  is not an extra cost, because that prompt would have carried the briefing anyway. What it spends
  is a round trip.
- **A bot that has stopped writing is grounded early.** A count on the bot rises each time one of
  its turns ends without its memory file's mtime moving, and at six the next turn carries the
  briefing whether the window thought it was due or not, with one extra paragraph asking whether
  anything since is worth keeping. It resets on the nudge as well as on a write, so a bot that
  ignores it gets six more turns of quiet rather than a briefing stapled to everything it is asked.

Both figures are main-written, like the session id and the archive watermark beside them: the form
can say four things about a bot, and when it is reminded to remember is not one of them.

Neither checks that the model wrote anything, because checking would mean parsing what it said, and
the rule this feature is built on is that the change the agent applied is the record. The mtime is
the only claim involved that nothing can be talked into.

A turn the app sends is also kept out of `~/.bravebot/history`, which is recall and is shared with
the terminal front-end. That is what `recall: false` on `turn.send` is for: what belongs under the
up-arrow is what somebody typed, and boilerplate this window wrote turning up in the terminal's
history would be this app spending somebody else's furniture. The same flag holds the prompt back
from naming the session, by the same argument.

A turn the app sent is **not drawn as one somebody typed**. It opens with a mark this app composes,
the transcript draws a line for it rather than a prompt bubble, and a reopened session recognises it
by that mark — the same judgement, for the same reason, that a handed-over file gets. The cost of
recognising a turn by its first line is that typing that line oneself gets the same treatment; the
mark is long and bracketed, so doing it is a thing somebody does on purpose.

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

The briefing handed to the model once promised more than that — that every edit would be shown as
a diff before it happened — and it was false, found by filming it and watching the Writes panel say
`APPLIED` with no card in the transcript. A false promise in a briefing is worse than none, since it
is the model telling somebody something the app does not do, so the briefing now says what is true:
the edit is on the record rather than in front of a card. Tightening the behaviour instead is not
available from here — there is no "always ask about this path" upstream, and adding one would be a
change to a repository this app does not modify.

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

In a release there is no hack: `scripts/package.mjs` names the bundle `Brave Bot`, and AppKit
reads that. See [Build and packaging](../README.md#build-and-packaging).

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

The parts worth naming, not every file:

```
crates/bravebot-bridge/     the Rust library and the bravebot-rpc binary
  src/lib.rs                the crate root, and the layering rules the tests assert
  src/bridge.rs             session store access, turn driving, Confirmer/Reporter/Sink
  src/protocol.rs           the request and event types
  src/wire.rs               the JSON projections of the protocol
  src/store.rs              reading and writing the records under ~/.bravebot
  src/turn.rs               one turn, and everything that can block it
  src/fork.rs               cutting a conversation in front of a message
  src/running.rs            what is in flight, and what may answer it
  src/emit.rs               framing events onto stdout
  src/bin/bravebot-rpc.rs   read stdin, frame stdout, nothing else
  tests/                    the integration suites, including the refusal guarantees
src/main/                   Electron main: one window, one child process, a narrow channel
  index.ts                  the window, and the allow-list of what the renderer may call
  bridge.ts                 the child process, and its lifetime
  menu.ts                   the application menu, built from the shared command list
  bots.ts                   the bots, and the two files each one speaks through
  state.ts                  bravebot-ui.json: one key replaced at a time, rest untouched
  files.ts                  listing and opening inside a session's own folder
  recents.ts                the projects opened before, which only this side writes
  forks.ts                  which session came out of which
  export.ts                 text, Markdown and the second renderer that draws the PDF
  theme.ts                  the palettes on offer: the built-ins, plus JSON in themes/
src/preload/                the only thing the renderer can reach
  index.ts                  a handful of functions and one subscription
  export.ts                 the same, for the PDF renderer
src/renderer/               the React app
  App.tsx                   the three columns
  commands.ts               what a chosen menu item does — and what it deliberately cannot
  columns.ts                widths, folds and the clamps on both
  transcript.ts             gathering a turn's tool calls into runs
  theme.ts                  putting a palette on the window, as DOM rather than as a render
  export.tsx                the PDF entry point, using the components the window uses
  components/               twenty of them; ThemePicker, Sidebar, Transcript, FileTree,
                            Diff, TrustPrompt and BotAvatar are the load-bearing ones
  avatar/stage.ts           one WebGL context, however many avatars, and their clock
  avatar/figure.ts          what a friendly figure is made of, and what a seed varies
src/shared/                 types both sides agree on
  protocol.ts               the wire format, mirroring the crate's own
  state.ts                  bravebot-ui.json as a whole, each key delegated to its parser
  layout.ts view.ts         the column and list shapes, and their validators
  files.ts                  the lexical check: no `..`, nothing absolute
  commands.ts               the command list the menu and the renderer share
  bots.ts                   what a bot is, and which half of one a window may write
  recents.ts forks.ts       the two keys the renderer may read and never write
  export.ts                 the formats, and what each one leaves out
  theme.ts                  the palette format, ported from the agent's own theme.rs
scripts/                    the bridge build, the packager, the drivers and the demo
docs/                       the protocol design, this document, testing and the demo
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
| `bots` | The bots defined here: name, purpose, avatar seed, checkout, session and compaction watermark |
| `theme` | Which palette the window is painted in, by name |

A file rather than `localStorage`, because the renderer is loaded from `file://` and Chromium
discards storage for that origin between launches — measured, not assumed.

One file, but not one judgement: `src/shared/state.ts` decides nothing itself. It delegates each
key whole to the validator that already owned that shape — `parseLayout`, `parseView`,
`parsePanels`, `parseRecents`, `parseForks`, `parseBots` — so a hand-edited grouping flag still cannot cost
somebody their column widths. Every write goes through `src/main/state.ts`, which replaces exactly
one key and leaves the rest of the file as it found it, and what lands on disk is always the parsed
state rather than the object a caller passed.

The renderer reaches five of those keys, and only through a channel of its own per shape:
`layout`, `view`, `panels`, `theme` and `bots`. `recents` and `forks` are written by the main process alone, from a
native picker and from what the *agent* answered — the window can read them and has no way to
write a line into either.

`bots` is the one key that is written from both sides, and the split runs through the middle of a
single record. A bot's name, purpose and checkout are a preference somebody types and cross from
the window like any other. Its slug, its avatar seed, the id of the session behind it and the count
of what compaction has taken from that session do not: the first two are minted in the main process
so that a string arriving from a window never becomes a path segment, and the last two are read off
what the *agent* answered on `turn.done`, which is the same promise the fork lineage makes one line
up.

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

