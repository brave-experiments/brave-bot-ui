import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AskAnswer,
  BridgeEvent,
  ForkedSession,
  OpenedSession,
  Phase,
  SessionSummary,
  Shown,
  TodoRow,
} from '../shared/protocol'
import { Sidebar } from './components/Sidebar'
import type { Bot } from '../shared/bots'
import { Transcript } from './components/Transcript'
import { Context } from './components/Context'
import { Gutter, useColumns } from './components/Gutter'
import { shown } from './columns'
import { TrustPrompt } from './components/TrustPrompt'
import { Unconfigured } from './components/Unconfigured'
import { Notice } from './components/Notice'
import type { ExportFormat } from '../shared/export'
import { useCommandRouter, usePublishedState } from './commands'
import { type Fork, forkOf, forkedSessions } from '../shared/forks'
import * as t from './transcript'
import { ThemePicker } from './components/ThemePicker'
import { applyTheme, watchAppearance } from './theme'
import { BRAVE, BRAVE_THEME, BUILTINS, findTheme, type Theme } from '../shared/theme'

/** What the app is doing, which decides most of what the interface offers. */
interface Live {
  handle: string
  /**
   * The record's own id, or `null` for a session made in this window and not yet listed.
   *
   * Kept rather than looked up by title: two sessions can share a title, and a context menu
   * that closed whichever one matched first would close the wrong one.
   */
  summary: {
    id: string | null
    title: string
    project: string
    branch: string | null
    directory: string
  }
  entries: t.Entry[]
  todos: TodoRow[]
  quarantine: Shown[]
  phase: Phase | null
  tokens: number
  running: boolean
  /** Set when a fresh session needs the trust question answered before it can run. */
  askingTrust: string | null
  /**
   * Where this session was cut from, for a session that was forked out of another.
   *
   * The title is carried because it is what the banner says, and the window may not have the
   * parent in its list — a session with no record yet is in no list at all.
   */
  forkedFrom: { directory: string; id: string; title: string; prompt: number } | null
  /**
   * A prompt to scroll to and mark, counted over the prompts the transcript drew.
   *
   * An ordinal rather than an entry id, because ids are minted fresh every time a session is
   * opened and this arrives from a session that was open a moment ago. The ordinal is the same
   * coordinate the fork itself was cut on, so it is the one thing about a place in a transcript
   * that two sessions can both mean.
   */
  focus: number | null
}

/**
 * Where a session was cut from, ready for a banner, or `null` for one that was not.
 *
 * The title comes from the session list, which is the fresher of the two places it could come
 * from — a fork's record on disk says only what the parent was called; the list says what it is
 * called. A parent the list does not hold (one whose record has not been written yet, or one in
 * a project since deleted) falls back to its id, which is at least a true name.
 */
function cameFrom(
  forks: Fork[],
  directory: string,
  id: string,
  sessions: SessionSummary[],
): Live['forkedFrom'] {
  const fork = forkOf(forks, directory, id)
  if (!fork) return null
  const parent = sessions.find(
    (session) => session.id === fork.parent.id && session.directory === fork.parent.directory,
  )
  return {
    directory: fork.parent.directory,
    id: fork.parent.id,
    title: parent?.title ?? fork.parent.id,
    prompt: fork.prompt,
  }
}

/** Raised for the one failure that needs its own screen rather than a line of text. */
class Unconfigurable extends Error {}

/** Which kinds of question a person can be put. */
export type Asked = 'confirm' | 'run' | 'output' | 'vouch'

/**
 * Which method answers which question.
 *
 * Four methods rather than one taking a kind, so an answer cannot be delivered to the
 * wrong question by getting a field wrong: the agent derives the kind from the method it
 * was called on and checks it against what is actually waiting.
 */
const METHOD: Record<Asked, string> = {
  confirm: 'confirm.reply',
  run: 'run.reply',
  output: 'output.reply',
  vouch: 'vouch.reply',
}

async function call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
  const answer = await window.bravebot.request<T>(method, params)
  if (answer.error) {
    // `config` is `Config::from_env` failing, which for a packaged or npm-launched app
    // means the credentials were not baked in at compile time. It is not recoverable
    // from here and needs saying properly.
    if (answer.error.code === 'config') throw new Unconfigurable(answer.error.message)
    throw new Error(`${answer.error.code}: ${answer.error.message}`)
  }
  return answer.ok as T
}

export function App(): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [bots, setBots] = useState<Bot[]>([])
  const [live, setLive] = useState<Live | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [build, setBuild] = useState<string | null>(null)
  const [unconfigured, setUnconfigured] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null)
  // The composer's text lives here rather than in `Transcript` because the Send menu item
  // has to be grey when there is nothing to send, and only this component talks to the menu.
  const [draft, setDraft] = useState('')
  /**
   * Whether an export carries the tool calls as well as the conversation.
   *
   * Off to begin with, because the common reason to export a session is to show somebody
   * what was asked and what came back. Held for the window rather than per session and not
   * written to disk: it is answered next to the format, at the moment of exporting, and a
   * setting remembered across launches would decide the contents of a file somebody is about
   * to hand to another person without being on screen when they do.
   */
  const [includeTools, setIncludeTools] = useState(false)

  const [forks, setForks] = useState<Fork[]>([])

  /**
   * What this window is painted in, and whether the picker is open.
   *
   * The name is remembered in `bravebot-ui.json` like the columns and the panels, and arrives the
   * same way theirs do — asynchronously, so it cannot seed `useState`.
   *
   * Seeded from the set compiled into the app rather than from nothing, so that the picker has
   * rows even if the read never answers — the palettes somebody wrote are the only part of the
   * list that has to come off disk.
   *
   * The list is kept beside the name for two reasons: the picker has something to open on without
   * a round trip, and `applyTheme` has a palette to re-resolve against when the system flips to
   * dark — a palette that names only an accent inherits the other eight, and what it inherits
   * changes. It can also change under the window, which is what `onThemeChanged` below is for:
   * somebody editing a palette file should see the window follow.
   */
  const [themes, setThemes] = useState<readonly Theme[]>(BUILTINS)
  const [chosen, setChosen] = useState(BRAVE)
  const [themesDirectory, setThemesDirectory] = useState('')
  const [picking, setPicking] = useState(false)

  // Read inside the event handler, which is installed once and must not close over a
  // stale session handle.
  const handleRef = useRef<string | null>(null)
  handleRef.current = live?.handle ?? null

  // Read inside `open`, which is installed once for the same reason. The list lives in the
  // main process; this is the copy on screen, refreshed when it can have changed.
  const forksRef = useRef<Fork[]>(forks)
  forksRef.current = forks

  // The list is where a parent's *current* name lives, so a session renamed since the fork was
  // taken is named on the banner by what it is called now.
  const sessionsRef = useRef<SessionSummary[]>(sessions)
  sessionsRef.current = sessions

  const readForks = useCallback(async () => {
    setForks(await window.bravebot.readForks().catch(() => []))
  }, [])

  /**
   * The theme in force, kept as a ref so that the appearance watcher below has the current one
   * without being torn down and reinstalled every time the choice changes.
   */
  const themeRef = useRef<Theme | null>(null)
  themeRef.current = findTheme(themes, chosen) ?? null

  /**
   * Whether the picker has the window, which decides whether an answer from disk may repaint it.
   *
   * A ref and not the state below, because `takeTheme` is installed once and would otherwise read
   * whatever `picking` was when it was made.
   */
  const previewing = useRef(false)

  /**
   * Take what the main process answered, and paint the window in it.
   *
   * Except while the picker is open, when the list is taken and the painting is not. Opening the
   * picker asks for the list again, and the watcher can answer at any moment; either reply landing
   * a frame after somebody pressed an arrow would put the *chosen* theme back over the preview
   * they were looking at. The picker owns the window until it closes, and Escape is what puts the
   * previous one back.
   */
  const takeTheme = useCallback((state: { themes: Theme[]; chosen: string; directory: string }) => {
    setThemes(state.themes)
    setChosen(state.chosen)
    setThemesDirectory(state.directory)
    if (previewing.current) return
    const theme = findTheme(state.themes, state.chosen)
    if (theme) applyTheme(theme)
  }, [])

  /**
   * Read the list again.
   *
   * Called when the picker opens as well as at startup, because the watcher can only tell the
   * window about a palette written while the window was running — and it is the one moment the
   * list has to be right. A round trip nobody is waiting on is cheaper than a picker that does not
   * offer a file somebody just saved.
   */
  const refreshThemes = useCallback(() => {
    void window.bravebot
      .readTheme()
      .then(takeTheme)
      .catch(() => undefined)
  }, [takeTheme])

  /**
   * Paint the window, and keep it painted as the answer changes underneath.
   *
   * Three things can change it: this window's own picker, a palette file being written — which
   * arrives on `onThemeChanged` — and the system flipping to dark, which only matters for a
   * palette that inherits some of its roles but matters a lot to that one. All three land in the
   * same place.
   */
  useEffect(() => {
    refreshThemes()
    const stopListening = window.bravebot.onThemeChanged(takeTheme)
    const stopWatching = watchAppearance(() => themeRef.current ?? BRAVE_THEME)
    return () => {
      stopListening()
      stopWatching()
    }
  }, [takeTheme, refreshThemes])

  const refresh = useCallback(async () => {
    try {
      const { sessions } = await call<{ sessions: SessionSummary[] }>('session.list')
      setSessions(sessions)
    } catch (error) {
      setProblem(String(error))
    }
  }, [])

  const readBots = useCallback(async () => {
    setBots(await window.bravebot.readBots().catch(() => []))
  }, [])

  useEffect(() => {
    void refresh()
    void readForks()
    void readBots()
    const stop = window.bravebot.onEvent((message: BridgeEvent) => {
      // Events for a session other than the one on screen are dropped rather than
      // queued: this build shows one at a time, and holding a transcript nobody is
      // looking at would grow without bound.
      if (message.event !== 'agent.ready' && message.session !== handleRef.current) return
      apply(message, setLive, setBuild, refresh)
    })
    return stop
  }, [refresh, readForks, readBots])

  /**
   * Show a stored session, optionally scrolled to one of its prompts.
   *
   * `focus` is how the fork banner points back: an ordinal over the prompts, resolved to a row
   * when the transcript draws it. See `Live.focus`.
   *
   * Not called `open`, which is what it was: that shadows `window.open`, so every call to it
   * reads — to a scanner, and to anybody who does not know this file — as opening a browser
   * tab. A name that has to be recognised before it can be understood is the wrong name.
   */
  const showSession = useCallback(async (summary: SessionSummary, focus?: number) => {
    try {
      // Let go of the one being left first. The app shows a single session and already
      // drops events for any other (see the listener below), so a turn left running behind
      // the user's back is one nobody will ever see finish — and if it stops to ask about a
      // write, it waits on an answer that is never coming. `session.close` cancels it and
      // refuses what it was waiting on, which is the honest end for it. Failures are
      // swallowed: not being able to close the old session is no reason not to open the new.
      const leaving = handleRef.current
      if (leaving) await call('session.close', { session: leaving }).catch(() => undefined)

      const opened = await call<OpenedSession>('session.open', {
        directory: summary.directory,
        id: summary.id,
      })
      setLive({
        handle: opened.session,
        summary: {
          id: summary.id,
          title: opened.record.title,
          project: summary.project,
          branch: opened.record.branch,
          directory: opened.record.directory,
        },
        entries: t.fromSaid(opened.said),
        todos: Object.values(opened.todos).flat(),
        quarantine: [],
        phase: null,
        tokens: 0,
        running: false,
        // A record with no stored map was written before maps were kept. Nothing
        // recorded is not the same as nothing trusted, so it is asked about again.
        askingTrust: opened.trust.known ? null : opened.record.directory,
        // Looked up rather than carried: this session may have been forked in another launch
        // entirely, and the file the main process keeps is where that is written down.
        forkedFrom: cameFrom(forksRef.current, summary.directory, summary.id, sessionsRef.current),
        focus: focus ?? null,
      })
      setDraft('')
      const notes = [opened.branchNote, opened.buildNote].filter(Boolean) as string[]
      setProblem(notes.length ? notes.join(' · ') : null)
    } catch (error) {
      setProblem(String(error))
    }
  }, [])

  const create = useCallback(async (directory?: string) => {
    // A directory only ever arrives here from a list somebody else handed over: File > Open
    // Recent and the chevron beside New session, which the main process keeps, or a group
    // heading in the session list, whose path came off a session the bridge reported. Never
    // a path the renderer composed — which is the promise `chooseDirectory` makes, and the
    // reason a plus on a heading needs no new way in.
    const chosen = directory ?? (await window.bravebot.chooseDirectory())
    if (!chosen) return
    try {
      const made = await call<{ session: string; branch: string | null }>('session.new', {
        directory: chosen,
      })
      setLive({
        handle: made.session,
        summary: {
          id: null,
          title: 'New session',
          project: chosen.split('/').pop() ?? chosen,
          branch: made.branch,
          directory: chosen,
        },
        entries: [],
        todos: [],
        quarantine: [],
        phase: null,
        tokens: 0,
        running: false,
        askingTrust: chosen,
        forkedFrom: null,
        focus: null,
      })
      setProblem(null)
    } catch (error) {
      setProblem(String(error))
    }
  }, [])

  const answerTrust = useCallback(async (trusted: boolean) => {
    const handle = handleRef.current
    if (!handle) return
    try {
      await call('trust.reply', { session: handle, trusted })
      setLive((old) => (old ? { ...old, askingTrust: null } : old))
    } catch (error) {
      setProblem(String(error))
    }
  }, [])

  const send = useCallback(async (prompt: string) => {
    const handle = handleRef.current
    if (!handle) return
    setLive((old) =>
      old ? { ...old, entries: [...old.entries, t.userSaid(prompt)], running: true } : old,
    )
    try {
      await call('turn.send', { session: handle, prompt })
    } catch (error) {
      if (error instanceof Unconfigurable) {
        setUnconfigured(error.message)
        setLive((old) => (old ? { ...old, running: false } : old))
        return
      }
      setLive((old) =>
        old ? { ...old, entries: [...old.entries, t.errored(String(error))], running: false } : old,
      )
    }
  }, [])

  const cancel = useCallback(async () => {
    const handle = handleRef.current
    if (handle) await call('turn.cancel', { session: handle }).catch(() => undefined)
  }, [])

  /**
   * Answer whichever question is on screen.
   *
   * One callback for all four, because the shape of the exchange is identical and the
   * differences are entirely in which method carries it. `remember` is only ever sent for
   * a run — it is the second answer that question has and the others do not.
   *
   * The card is only marked once the agent has accepted the answer. Marking it first would
   * draw an approval the turn never received if the call failed, which is the one direction
   * this must not be wrong in.
   */
  const answer = useCallback(
    async (kind: Asked, request: number, approve: boolean, remember = false) => {
      const handle = handleRef.current
      if (!handle) return
      const decision = approve ? 'approve' : 'reject'
      try {
        await call(METHOD[kind], { session: handle, request, decision, remember })
        setLive((old) =>
          old
            ? { ...old, entries: t.decide(old.entries, kind, request, decision, remember) }
            : old,
        )
      } catch (error) {
        setProblem(String(error))
      }
    },
    [],
  )

  /**
   * Answer a series of questions.
   *
   * Separate from [`answer`] because this reply is not a decision: it carries one answer per
   * question, and there is no approve/reject for it to be a flavour of.
   */
  const answerQuestions = useCallback(async (request: number, answers: AskAnswer[]) => {
    const handle = handleRef.current
    if (!handle) return
    try {
      await call('ask.reply', { session: handle, request, answers })
      setLive((old) => (old ? { ...old, entries: t.answered(old.entries, request, answers) } : old))
    } catch (error) {
      setProblem(String(error))
    }
  }, [])

  const pending = useMemo(
    () => (live ? t.outstanding(live.entries) : null),
    [live],
  )

  const { widths, collapsed, dragging, folding, start, reset, nudge, toggle } = useColumns()

  /** Which sessions in the list came out of another one, for the mark beside their names. */
  const saveBot = useCallback(
    async (bot: { slug?: string; name: string; purpose: string; directory: string }) => {
      await window.bravebot.writeBot(bot).catch(() => null)
      await readBots()
    },
    [readBots],
  )

  const removeBot = useCallback(
    async (slug: string) => {
      await window.bravebot.removeBot(slug).catch(() => null)
      await readBots()
    },
    [readBots],
  )

  const forked = useMemo(() => forkedSessions(forks), [forks])

  /** Send whatever is in the composer, on the same terms the Send button uses. */
  const submit = useCallback(() => {
    const prompt = draft.trim()
    if (!prompt || !handleRef.current || live?.running) return
    setDraft('')
    void send(prompt)
  }, [draft, live?.running, send])

  /**
   * Let go of the open session.
   *
   * The agent is told, which cancels the turn and refuses whatever it was waiting on — both,
   * in that order, and that is why this is a call rather than just clearing the state here.
   * Dropping the session on the floor would leave a write blocked on an answer nobody is
   * going to give.
   */
  const closeSession = useCallback(async () => {
    const handle = handleRef.current
    if (!handle) return
    await call('session.close', { session: handle }).catch(() => undefined)
    setLive(null)
    setDraft('')
    void refresh()
  }, [refresh])

  const about = useCallback(async () => {
    try {
      const info = await call<{ build: string; version: string; home: string | null }>('agent.info')
      setNotice({
        title: 'Brave Bot',
        body: [
          `Interface  ${info.version}`,
          `Agent      ${info.build}`,
          `Sessions   ${info.home ?? 'nowhere the bridge could find'}`,
        ].join('\n'),
      })
    } catch (error) {
      setProblem(String(error))
    }
  }, [])

  const doctor = useCallback(async () => {
    try {
      const report = await call<{ found: boolean; text: string }>('doctor')
      setNotice({ title: 'Diagnostics', body: report.text.trim() || 'It said nothing at all.' })
    } catch (error) {
      setProblem(String(error))
    }
  }, [])

  /**
   * The conversation, as an export would carry it.
   *
   * Derived rather than built at the moment somebody picks a format, because whether there
   * is anything to export decides two things that have to agree: whether the button is grey
   * and whether the menu item is. One list, read twice.
   */
  const exportable = useMemo(
    () => (live ? t.conversation(live.entries, includeTools) : []),
    [live, includeTools],
  )

  /**
   * Whether there is anything worth writing to a file.
   *
   * Counts what was *said*, not what is in `exportable`: a session that has only made tool
   * calls would otherwise offer an export that `parseExportRequest` then refuses, because a
   * file of nothing but calls is not a conversation. Two places decide this and they have to
   * agree; this is the one that greys the button, and the boundary is the one that cannot be
   * got around.
   */
  const canExport = useMemo(() => exportable.some((turn) => turn.role !== 'tool'), [exportable])

  /**
   * Write the conversation to a file.
   *
   * The turns go over structured and the main process composes the document — see
   * `shared/export.ts`. A saved file is reported through `Notice`, whose body is a `<pre>`,
   * so a long path wraps instead of running off the panel; a failure goes to the header note
   * where every other recoverable failure in this component already goes.
   */
  const exportSession = useCallback(
    async (format: ExportFormat) => {
      if (!live || !canExport) return
      const outcome = await window.bravebot.exportSession({
        format,
        document: {
          title: live.summary.title,
          directory: live.summary.directory,
          branch: live.summary.branch,
          turns: exportable,
        },
      })
      if (outcome.status === 'saved') {
        setNotice({ title: 'Exported', body: `Saved to\n${outcome.where}` })
      } else if (outcome.status === 'failed') {
        setProblem(`Could not export that: ${outcome.message}`)
      }
      // A cancelled sheet says nothing. Somebody changed their mind, which is not news.
    },
    [live, canExport, exportable],
  )

  const resetColumns = useCallback(() => {
    reset('left')
    reset('right')
  }, [reset])

  /**
   * Copy, done here rather than in the main process.
   *
   * The text never leaves the renderer, which is what keeps the context-menu channel free of
   * anything the agent read off disk. A clipboard write is also the one thing a person can
   * unambiguously do with confined content: it is their own machine, and copying is not a
   * decision the planner benefits from.
   */
  const copy = useCallback((text: string) => {
    void navigator.clipboard.writeText(text).catch(() => setProblem('Could not copy that.'))
  }, [])

  const openSession = useCallback(
    (id: string) => {
      const found = sessions.find((session) => session.id === id)
      if (found) void showSession(found)
    },
    [sessions, showSession],
  )

  /**
   * Close a session named by a right-click.
   *
   * Only the open one can actually be closed — the others have no handle, because this build
   * opens one at a time. Closing a row that is not the open one is therefore nothing rather
   * than an error, and the menu item is the same item either way.
   */
  const closeNamed = useCallback(
    (id: string) => {
      if (live?.summary.id === id) void closeSession()
    },
    [live, closeSession],
  )

  const copyProjectPath = useCallback(
    (id: string) => {
      const found = sessions.find((session) => session.id === id)
      if (found) copy(found.directory)
    },
    [sessions, copy],
  )

  /**
   * Begin a session from what was said before a prompt, with that prompt to edit.
   *
   * What crosses to the agent is the prompt's *place* — how many prompts precede it — and what
   * it said. Not the entry's id, which means nothing outside this window, and not a slice of
   * the transcript, which is a projection of the conversation rather than the conversation. The
   * agent cuts its own history and hands back what the fork now holds, so what is drawn after
   * this is what the next turn will actually be working from.
   */
  const forkFrom = useCallback(
    async (id: string) => {
      const handle = handleRef.current
      const entries = live?.entries
      if (!handle || !entries) return

      const at = entries.findIndex((candidate) => candidate.id === id)
      const entry = at === -1 ? null : entries[at]
      // Only a prompt. The menu offers this on nothing else, but the id arrives from outside
      // this component and a check here is cheaper than trusting the round trip.
      if (!entry || entry.kind !== 'user') return
      const prompt = entries.slice(0, at).filter((before) => before.kind === 'user').length

      try {
        const forked = await call<ForkedSession>('session.fork', {
          session: handle,
          prompt,
          text: entry.text,
        })

        // The fork first and the parent second: the cut is made out of the parent's live state,
        // so letting go of it before asking would be asking about a session that had gone.
        await call('session.close', { session: handle }).catch(() => undefined)

        setLive({
          handle: forked.session,
          summary: {
            id: forked.id,
            // What a fork is called is decided by the agent from the history it kept, and it
            // has no record yet to read it off. Named after its parent here for the same
            // reason: this is where it came from, and the first turn will settle it.
            title: live.summary.title,
            project: forked.directory.split('/').pop() ?? forked.directory,
            branch: forked.branch,
            directory: forked.directory,
          },
          entries: t.fromSaid(forked.said),
          todos: Object.values(forked.todos).flat(),
          quarantine: [],
          phase: null,
          tokens: 0,
          running: false,
          askingTrust: forked.trust.known ? null : forked.directory,
          forkedFrom: {
            directory: forked.parent.directory,
            id: forked.parent.id,
            title: forked.parent.title ?? live.summary.title,
            prompt: forked.parent.prompt,
          },
          focus: null,
        })
        // From the agent rather than from `entry.text`: what the composer opens with should be
        // the prompt that was actually cut out, not the one this window thought it clicked.
        setDraft(forked.prefill)
        setProblem(null)
        void refresh()
        void readForks()
      } catch (error) {
        setProblem(String(error))
      }
    },
    [live, refresh, readForks],
  )

  /** Show the session this one was cut out of, at the point of the cut. */
  const openParent = useCallback(() => {
    const from = live?.forkedFrom
    if (!from) return
    const found = sessions.find(
      (session) => session.id === from.id && session.directory === from.directory,
    )
    if (found) void showSession(found, from.prompt)
    else setProblem('the session this was forked from is no longer in the list')
  }, [live, sessions, showSession])

  /** Stop marking the prompt a fork link landed on, so the transcript behaves normally again. */
  const clearFocus = useCallback(() => {
    setLive((old) => (old && old.focus !== null ? { ...old, focus: null } : old))
  }, [])

  const copyEntry = useCallback(
    (id: string) => {
      const entry = live?.entries.find((candidate) => candidate.id === id)
      const text = entry ? t.plainText(entry) : null
      if (text) copy(text)
    },
    [live, copy],
  )

  useCommandRouter({
    create,
    closeSession: () => void closeSession(),
    send: submit,
    cancel: () => void cancel(),
    toggle,
    resetColumns,
    about: () => void about(),
    doctor: () => void doctor(),
    openSession,
    closeNamed,
    copyProjectPath,
    copyEntry,
    forkEntry: (id) => void forkFrom(id),
    exportSession: (format) => void exportSession(format),
    toggleExportTools: () => setIncludeTools((on) => !on),
    theme: () => {
      previewing.current = true
      refreshThemes()
      setPicking(true)
    },
  })

  // What the menu is allowed to offer. Assembled here because this is the only component
  // that can see all of it at once.
  const menuState = useMemo(
    () => ({
      hasSession: live !== null,
      running: live?.running ?? false,
      canSend: live !== null && !live.running && draft.trim().length > 0,
      canExport,
      includeTools,
      folded: collapsed,
    }),
    [live, draft, collapsed, canExport, includeTools],
  )
  usePublishedState(menuState)

  return (
    <div
      className={[
        'app',
        dragging ? 'resizing' : '',
        folding ? 'folding' : '',
        collapsed.left ? 'left-folded' : '',
        collapsed.right ? 'right-folded' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      // The widths drive the grid through custom properties, so a drag repaints the
      // layout without React touching the columns themselves. The `-open` pair is what a
      // folded column's contents keep as their width, so they slide out under a clip
      // rather than reflowing into a shape nobody will ever read.
      style={
        {
          '--col-left': `${shown({ widths, collapsed }, 'left')}px`,
          '--col-right': `${shown({ widths, collapsed }, 'right')}px`,
          '--col-left-open': `${widths.left}px`,
          '--col-right-open': `${widths.right}px`,
        } as React.CSSProperties
      }
    >
      <Sidebar
        sessions={sessions}
        openId={live?.summary.id ?? undefined}
        forked={forked}
        onOpen={showSession}
        onNew={create}
        bots={bots}
        onSaveBot={saveBot}
        onRemoveBot={removeBot}
        build={build}
      />
      <Gutter
        side="left"
        width={shown({ widths, collapsed }, 'left')}
        dragging={dragging === 'left'}
        collapsed={collapsed.left}
        onStart={start}
        onReset={reset}
        onNudge={nudge}
      />
      <Transcript
        live={live}
        pending={pending}
        problem={problem}
        collapsed={collapsed}
        onToggle={toggle}
        draft={draft}
        onDraft={setDraft}
        onSubmit={submit}
        onCancel={cancel}
        canExport={canExport}
        includeTools={includeTools}
        onToggleTools={() => setIncludeTools((on) => !on)}
        onExport={(format) => void exportSession(format)}
        onFork={(id) => void forkFrom(id)}
        onOpenParent={openParent}
        onFocused={clearFocus}
        onDecide={answer}
        onAnswer={answerQuestions}
      />
      <Gutter
        side="right"
        width={shown({ widths, collapsed }, 'right')}
        dragging={dragging === 'right'}
        collapsed={collapsed.right}
        onStart={start}
        onReset={reset}
        onNudge={nudge}
      />
      <Context live={live} />
      {notice && (
        <Notice title={notice.title} body={notice.body} onClose={() => setNotice(null)} />
      )}
      {unconfigured && <Unconfigured detail={unconfigured} />}
      {live?.askingTrust && (
        <TrustPrompt directory={live.askingTrust} onAnswer={answerTrust} />
      )}
      {picking && (
        <ThemePicker
          themes={themes}
          chosen={chosen}
          directory={themesDirectory}
          onKeep={(name) => {
            window.bravebot.writeTheme(name)
            setChosen(name)
            previewing.current = false
            setPicking(false)
          }}
          onClose={() => {
            previewing.current = false
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}

/** Fold one event into the live session. */
function apply(
  message: BridgeEvent,
  setLive: React.Dispatch<React.SetStateAction<Live | null>>,
  setBuild: (build: string) => void,
  refresh: () => void,
): void {
  if (message.event === 'agent.ready') {
    setBuild((message.data as { build: string }).build)
    return
  }

  setLive((old) => {
    if (!old) return old
    switch (message.event) {
      case 'turn.started':
        return { ...old, running: true, phase: null, tokens: 0 }
      case 'phase':
        return { ...old, phase: message.data.phase }
      case 'tokens':
        return { ...old, tokens: message.data.written }
      case 'narration':
        return { ...old, entries: [...old.entries, t.narrated(message.data.text)] }
      case 'tool.started':
        return { ...old, entries: [...old.entries, t.started(message.data)] }
      case 'tool.finished':
        return { ...old, entries: t.finish(old.entries, message.data) }
      case 'landed':
        return { ...old, entries: t.land(old.entries, message.data.landing) }
      case 'quarantined':
        return {
          ...old,
          quarantine: [...old.quarantine, message.data],
          entries: [...old.entries, t.quarantined(message.data)],
        }
      case 'todos':
        return { ...old, todos: message.data.rows }
      case 'confirm.request':
        return { ...old, entries: [...old.entries, t.asked(message.data)] }
      case 'run.request':
        return { ...old, entries: [...old.entries, t.askedRun(message.data)] }
      case 'output.request':
        return { ...old, entries: [...old.entries, t.askedOutput(message.data)] }
      case 'vouch.request':
        return { ...old, entries: [...old.entries, t.askedVouch(message.data)] }
      case 'ask.request':
        return { ...old, entries: [...old.entries, t.askedQuestions(message.data)] }
      case 'turn.done': {
        refresh()
        return {
          ...old,
          running: false,
          phase: null,
          entries: [...old.entries, t.replied(message.data.reply)],
        }
      }
      case 'turn.error': {
        refresh()
        const { kind, message: detail } = message.data
        return {
          ...old,
          running: false,
          phase: null,
          entries: [...old.entries, t.errored(`${kind}: ${detail}`)],
        }
      }
      default:
        return old
    }
  })
}
