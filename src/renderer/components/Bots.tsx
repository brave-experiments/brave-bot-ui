/**
 * The other list in the left column: the bots somebody has defined.
 *
 * A session is a conversation and is named after whatever was asked first. A bot is somebody who
 * has one — a name, a purpose, a memory, and one checkout — and the session behind it is resumed
 * rather than begun again, so the list here is a list of *people* where the one next door is a
 * list of *occasions*. That is the whole reason it is a separate tab rather than a filter over the
 * same rows.
 *
 * What a row shows is what tells two bots apart when there are eight of them: the face, the name,
 * and the checkout it works in. Not the last thing it said, which is the session list's business,
 * and not how long ago — a bot is not more or less itself for having been quiet.
 *
 * The form is here rather than in a window of its own for the reason the session list's folder
 * picker is: this is two fields and a folder, and a modal for it would be a ceremony around
 * something that takes one sentence to say.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { activeBots, retiredBots, type Bot } from '../../shared/bots'
import { BotAvatar, type Doing } from './BotAvatar'
import { Fold } from './Fold'

interface Props {
  bots: Bot[]
  /** The slug of the bot whose session is on screen, if one is. */
  openSlug: string | null
  /** What that bot is doing, so its row's face can match the header's. */
  openDoing: Doing
  onOpen: (bot: Bot) => void
  onSave: (bot: { slug?: string; name: string; purpose: string; directory: string }) => void
  /** Put one away, or bring it back. */
  onRetire: (slug: string, retired: boolean) => void
  /** Take one away for good. Only ever reached from the archive below. */
  onRemove: (slug: string) => void
}

export function Bots({
  bots,
  openSlug,
  openDoing,
  onOpen,
  onSave,
  onRetire,
  onRemove,
}: Props): React.JSX.Element {
  // Which bot's form is open, by slug, or `'new'` for one that does not exist yet. Local, and for
  // the reason the session filter is: nothing outside this list reads it, and a form half filled
  // in is not a preference anybody wants remembered.
  const [editing, setEditing] = useState<string | null>(null)
  // Whether the archive is open. Local for the same reason, and closed to begin with: the archive
  // is where things go to stop being in the way, and one that opened itself every launch would be
  // in the way.
  const [showing, setShowing] = useState(false)
  // Which archived bot has been asked about, if any. One at a time — arming a second disarms the
  // first, so there is never a fold of rows all sitting a click away from being deleted.
  const [deleting, setDeleting] = useState<string | null>(null)

  const inUse = useMemo(() => activeBots(bots), [bots])
  const away = useMemo(() => retiredBots(bots), [bots])

  return (
    <>
      <header className="sessions-head">
        {/* The same control the session list's own opens with, so the two tabs begin the same
            way. No split beside it: a bot's folder is asked for once, in the form. */}
        <button className="new" onClick={() => setEditing('new')}>
          <span className="plus" aria-hidden="true">
            +
          </span>
          New bot
        </button>
      </header>

      <div className="session-list">
        {inUse.length === 0 && editing !== 'new' && (
          <p className="empty">
            {away.length === 0 ? (
              <>
                No bots yet. A bot is a name, a purpose and a memory, working in one checkout — and
                one session that is resumed rather than started again.
              </>
            ) : (
              // Said rather than left to the heading below, because "No bots yet" over a list of
              // archived ones would be the window contradicting itself in the same column.
              <>Every bot you have is in the archive. Bring one back, or make another.</>
            )}
          </p>
        )}

        {editing === 'new' && (
          <BotForm
            onCancel={() => setEditing(null)}
            onSave={(bot) => {
              onSave(bot)
              setEditing(null)
            }}
          />
        )}

        {inUse.map((bot) =>
          editing === bot.slug ? (
            <BotForm
              key={bot.slug}
              bot={bot}
              onCancel={() => setEditing(null)}
              onSave={(next) => {
                onSave(next)
                setEditing(null)
              }}
              onArchive={() => {
                onRetire(bot.slug, true)
                setEditing(null)
              }}
            />
          ) : (
            <BotRow
              key={bot.slug}
              bot={bot}
              open={bot.slug === openSlug}
              // The open one does what its header does. The others look about, except one that has
              // never been spoken to, which waits — the row already says so in words, and a face
              // that has not started yet looking idly around would be saying something else.
              doing={bot.slug === openSlug ? openDoing : bot.session === null ? 'waiting' : 'idle'}
              onOpen={onOpen}
              onEdit={() => setEditing(bot.slug)}
            />
          ),
        )}
      </div>

      {/* Only when there is something in it. An empty archive is a heading about nothing, and the
          whole point of the section is to be out of the way.

          Outside the scrolling list rather than at the end of it, which is what makes it the foot
          of the column rather than whatever happens to be below the last bot. The tab already has
          a head that stays put while the rows move under it; this is the same bargain at the other
          end, and it means the archive is in the same place with three bots and with thirty. */}
      {away.length > 0 && (
        <section className="bot-archive">
          {/* The same folded heading the session list groups use, so a thing that opens and
              closes looks the same in both tabs. */}
          <div className="session-group-head">
            <button
              className="session-group-fold"
              aria-expanded={showing}
              // Closing the archive puts down whatever was picked up in it. A row left armed
              // behind a closed fold would be a question nobody can see waiting for an answer.
              onClick={() => {
                setDeleting(null)
                setShowing(!showing)
              }}
            >
              <span className={`chevron ${showing ? 'open' : ''}`} aria-hidden="true">
                ›
              </span>
              <span className="session-group-name">Archived</span>
              <span className="count">{away.length}</span>
            </button>
          </div>
          {/* The rows scroll on their own once there are enough of them. A fold pinned to the
              bottom of the column has no room to grow into, and one that pushed the list of bots
              off the top would be the archive taking the tab over. */}
          <Fold open={showing} className="bot-archive-rows">
            {away.map((bot) => (
              <ArchivedRow
                key={bot.slug}
                bot={bot}
                asking={deleting === bot.slug}
                onAsk={() => setDeleting(bot.slug)}
                onCancel={() => setDeleting(null)}
                onRestore={() => {
                  setDeleting(null)
                  onRetire(bot.slug, false)
                }}
                onDelete={() => {
                  setDeleting(null)
                  onRemove(bot.slug)
                }}
              />
            ))}
          </Fold>
        </section>
      )}
    </>
  )
}

/**
 * One bot.
 *
 * Two buttons rather than a row with a control inside it, for the reason the session group heading
 * gives about its own plus: a button cannot be nested in a button, and the bigger of the two —
 * opening the bot — is the one that gets the whole row.
 */
function BotRow({
  bot,
  open,
  doing,
  onOpen,
  onEdit,
}: {
  bot: Bot
  open: boolean
  doing: Doing
  onOpen: (bot: Bot) => void
  onEdit: () => void
}): React.JSX.Element {
  const where = bot.directory.split('/').pop() ?? bot.directory
  return (
    <div className={`bot${open ? ' bot-open' : ''}`}>
      <button className="bot-open-button" onClick={() => onOpen(bot)}>
        <BotAvatar seed={bot.avatar} doing={doing} />
        <span className="bot-said">
          <span className="bot-name">{bot.name}</span>
          {/* The whole path in the tooltip, because the column clips it — the one case the
              tooltip rule here allows, which is text the layout took away. */}
          <span className="bot-where" title={bot.directory}>
            {where}
            {bot.session === null && ' · not spoken to yet'}
          </span>
        </span>
      </button>
      <button
        className="bot-edit"
        aria-label={`Edit ${bot.name}`}
        title={`Edit ${bot.name}`}
        onClick={onEdit}
      >
        <span aria-hidden="true">⋯</span>
      </button>
    </div>
  )
}

/**
 * One bot that has been put away.
 *
 * Plainer than the row above it on purpose, and the missing piece is the face. Two reasons, and
 * they point the same way. A page gets a limited number of WebGL contexts — the whole of what
 * `BotAvatar`'s stage is arranged around — and an archive is exactly the list that can grow to
 * forty rows nobody is looking at, so spending one apiece there would cost the bots somebody *is*
 * looking at their faces. And a posture is a claim about what a bot is doing: the vocabulary has
 * no word for "not here", and a figure turning slowly beside a Restore button would be saying
 * something untrue quietly.
 *
 * Two things to do with an archived bot, and they are not the same size. Restore is free — it is
 * the archive's whole point, and undoing it is one more click. **Delete** is the only act in this
 * window that cannot be taken back, so it is the only control wearing the colour a deletion wears
 * in a diff, and it asks before it does anything.
 *
 * It asks *in the row* rather than in a dialog, which is the same call the transcript makes about
 * the agent's own questions: a modal takes the thing being decided off the screen and replaces it
 * with a sentence about it. Here the sentence goes where the checkout name was, so the name of
 * the bot is still in front of whoever is answering. The second press is a different button in a
 * different place, so nobody arrives at it by double-clicking the first.
 *
 * What the words have to carry is that this is final, and they have to do it without overclaiming.
 * Nothing is erased: the session stays in the agent's store and the memory file stays in the
 * checkout, exactly as before. What goes is the only thing that knows they belong together.
 */
function ArchivedRow({
  bot,
  asking,
  onAsk,
  onCancel,
  onRestore,
  onDelete,
}: {
  bot: Bot
  /** Whether this row is the one that has been asked about. */
  asking: boolean
  onAsk: () => void
  onCancel: () => void
  onRestore: () => void
  onDelete: () => void
}): React.JSX.Element {
  const where = bot.directory.split('/').pop() ?? bot.directory
  return (
    <div className={`bot-archived${asking ? ' bot-asking' : ''}`}>
      <span className="bot-said">
        <span className="bot-name">{bot.name}</span>
        {asking ? (
          // Short because the column is narrow and a warning that ellipsises is a warning that
          // stops before the part that matters. The whole of it — that the session and the memory
          // file are left where they are — is on the button, which is where somebody hesitating
          // over this will already be pointing.
          <span className="bot-warning">This cannot be undone.</span>
        ) : (
          // The whole path in the tooltip, for the reason the row above gives: the column clips
          // it, and this is text the layout took away.
          <span className="bot-where" title={bot.directory}>
            {where}
          </span>
        )}
      </span>
      {asking ? (
        <>
          <button type="button" className="bot-keep" onClick={onCancel}>
            Keep
          </button>
          <button
            type="button"
            className="bot-delete bot-delete-armed"
            title={`Delete ${bot.name} for good. This cannot be undone.`}
            onClick={onDelete}
          >
            Delete
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="bot-restore"
            title={`Bring ${bot.name} back, with its session, its memory and its face.`}
            onClick={onRestore}
          >
            Restore
          </button>
          <button
            type="button"
            className="bot-delete"
            title={`Delete ${bot.name} for good. Its session and its memory file are left where they are, but nothing will point at them again.`}
            onClick={onAsk}
          >
            Delete
          </button>
        </>
      )}
    </div>
  )
}

/**
 * Making a bot, or changing one.
 *
 * The checkout is chosen once and shown afterwards rather than being editable: a bot's memory is a
 * file inside that checkout and its session was begun there, so moving one is not an edit to a
 * field, it is a different bot. Saying so by not offering the control beats offering it and
 * explaining afterwards.
 */
function BotForm({
  bot,
  onSave,
  onCancel,
  onArchive,
}: {
  bot?: Bot
  onSave: (bot: { slug?: string; name: string; purpose: string; directory: string }) => void
  onCancel: () => void
  onArchive?: () => void
}): React.JSX.Element {
  const [name, setName] = useState(bot?.name ?? '')
  const [purpose, setPurpose] = useState(bot?.purpose ?? '')
  const [directory, setDirectory] = useState(bot?.directory ?? '')
  const [memory, setMemory] = useState<string | null>(null)

  // What the bot has remembered, read when the form opens rather than held in the list: it is a
  // file on disk that the bot itself edits, so the copy worth showing is the one there now.
  useEffect(() => {
    if (!bot) return
    void window.bravebot
      .readBotMemory(bot.slug)
      .then(setMemory)
      .catch(() => undefined)
  }, [bot])

  const choose = useCallback(async () => {
    // The same native picker the session list uses, and the same promise: this side never composes
    // a path, it is handed one somebody pointed at.
    const chosen = await window.bravebot.chooseDirectory()
    if (chosen) setDirectory(chosen)
  }, [])

  const ready = name.trim().length > 0 && purpose.trim().length > 0 && directory.length > 0

  return (
    <form
      className="bot-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) onSave({ slug: bot?.slug, name: name.trim(), purpose: purpose.trim(), directory })
      }}
    >
      <label className="bot-field">
        <span>Name</span>
        <input
          value={name}
          autoFocus
          placeholder="Release notes"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && onCancel()}
        />
      </label>

      <label className="bot-field">
        <span>Purpose</span>
        <textarea
          value={purpose}
          rows={4}
          placeholder="What this bot is for, and how it should go about it."
          onChange={(event) => setPurpose(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && onCancel()}
        />
      </label>

      <div className="bot-field">
        <span>Checkout</span>
        {bot ? (
          <p className="bot-fixed" title={bot.directory}>
            {bot.directory}
          </p>
        ) : (
          <button type="button" className="bot-choose" onClick={() => void choose()}>
            {directory || 'Choose a folder…'}
          </button>
        )}
      </div>

      {/* Said before the folder is picked rather than after, because it is the one consequence of
          making a bot that touches something the person owns. */}
      {!bot && (
        <p className="bot-note">
          A <code>.bravebot-ui</code> folder will appear in the checkout, holding this bot’s memory.
          It ignores itself, so it will not show up as a change.
        </p>
      )}

      {bot && (
        <div className="bot-field">
          <span>Memory</span>
          <pre className="bot-memory">{memory ?? 'Nothing remembered yet.'}</pre>
        </div>
      )}

      <div className="bot-actions">
        {onArchive && (
          <button
            type="button"
            className="bot-archive-button"
            // The one thing worth saying about a bot leaving the list is what it does *not* do,
            // since a row disappearing looks like everything about it disappearing. It used to
            // say Forget, and the sentence here had to work quite hard: the definition went, and
            // with it the slug naming the memory file and the seed the face was drawn from, so
            // "its memory is left where it is" was true and no comfort at all. Now the sentence
            // is easy, because the thing it describes is.
            title="Put this bot away. It keeps its session, its memory and its face, and can be brought back from the archive."
            onClick={onArchive}
          >
            Archive
          </button>
        )}
        <span className="bot-spacer" />
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="bot-save" disabled={!ready}>
          {bot ? 'Save' : 'Create'}
        </button>
      </div>
    </form>
  )
}
