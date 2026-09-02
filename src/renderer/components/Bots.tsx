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

import { useCallback, useEffect, useState } from 'react'
import type { Bot } from '../../shared/bots'
import { BotAvatar } from './BotAvatar'

interface Props {
  bots: Bot[]
  /** The slug of the bot whose session is on screen, if one is. */
  openSlug: string | null
  onOpen: (bot: Bot) => void
  onSave: (bot: { slug?: string; name: string; purpose: string; directory: string }) => void
  onRemove: (slug: string) => void
}

export function Bots({ bots, openSlug, onOpen, onSave, onRemove }: Props): React.JSX.Element {
  // Which bot's form is open, by slug, or `'new'` for one that does not exist yet. Local, and for
  // the reason the session filter is: nothing outside this list reads it, and a form half filled
  // in is not a preference anybody wants remembered.
  const [editing, setEditing] = useState<string | null>(null)

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
        {bots.length === 0 && editing !== 'new' && (
          <p className="empty">
            No bots yet. A bot is a name, a purpose and a memory, working in one checkout — and one
            session that is resumed rather than started again.
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

        {bots.map((bot) =>
          editing === bot.slug ? (
            <BotForm
              key={bot.slug}
              bot={bot}
              onCancel={() => setEditing(null)}
              onSave={(next) => {
                onSave(next)
                setEditing(null)
              }}
              onRemove={() => {
                onRemove(bot.slug)
                setEditing(null)
              }}
            />
          ) : (
            <BotRow
              key={bot.slug}
              bot={bot}
              open={bot.slug === openSlug}
              onOpen={onOpen}
              onEdit={() => setEditing(bot.slug)}
            />
          ),
        )}
      </div>
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
  onOpen,
  onEdit,
}: {
  bot: Bot
  open: boolean
  onOpen: (bot: Bot) => void
  onEdit: () => void
}): React.JSX.Element {
  const where = bot.directory.split('/').pop() ?? bot.directory
  return (
    <div className={`bot${open ? ' bot-open' : ''}`}>
      <button className="bot-open-button" onClick={() => onOpen(bot)}>
        <BotAvatar seed={bot.avatar} />
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
  onRemove,
}: {
  bot?: Bot
  onSave: (bot: { slug?: string; name: string; purpose: string; directory: string }) => void
  onCancel: () => void
  onRemove?: () => void
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
        {onRemove && (
          <button
            type="button"
            className="bot-remove"
            // The one thing worth saying about removing a bot is what it does *not* do, since a
            // row disappearing looks like everything about it disappearing.
            title="Forget this bot. Its session and its memory file are left where they are."
            onClick={onRemove}
          >
            Forget
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
