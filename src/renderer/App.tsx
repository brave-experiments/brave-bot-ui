import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AskAnswer,
  BridgeEvent,
  OpenedSession,
  Phase,
  SessionSummary,
  Shown,
  TodoRow,
} from '../shared/protocol'
import { Sessions } from './components/Sessions'
import { Transcript } from './components/Transcript'
import { Context } from './components/Context'
import { Gutter, useColumns } from './components/Gutter'
import { shown } from './columns'
import { TrustPrompt } from './components/TrustPrompt'
import { Unconfigured } from './components/Unconfigured'
import { Notice } from './components/Notice'
import type { ExportFormat } from '../shared/export'
import { useCommandRouter, usePublishedState } from './commands'
import * as t from './transcript'

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
  const [live, setLive] = useState<Live | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [build, setBuild] = useState<string | null>(null)
  const [unconfigured, setUnconfigured] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null)
  // The composer's text lives here rather than in `Transcript` because the Send menu item
  // has to be grey when there is nothing to send, and only this component talks to the menu.
  const [draft, setDraft] = useState('')

  // Read inside the event handler, which is installed once and must not close over a
  // stale session handle.
  const handleRef = useRef<string | null>(null)
  handleRef.current = live?.handle ?? null

  const refresh = useCallback(async () => {
    try {
      const { sessions } = await call<{ sessions: SessionSummary[] }>('session.list')
      setSessions(sessions)
    } catch (error) {
      setProblem(String(error))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const stop = window.bravebot.onEvent((message: BridgeEvent) => {
      // Events for a session other than the one on screen are dropped rather than
      // queued: this build shows one at a time, and holding a transcript nobody is
      // looking at would grow without bound.
      if (message.event !== 'agent.ready' && message.session !== handleRef.current) return
      apply(message, setLive, setBuild, refresh)
    })
    return stop
  }, [refresh])

  const open = useCallback(async (summary: SessionSummary) => {
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
  const exportable = useMemo(() => (live ? t.conversation(live.entries) : []), [live])

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
      if (!live || exportable.length === 0) return
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
    [live, exportable],
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
      if (found) void open(found)
    },
    [sessions, open],
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
    exportSession: (format) => void exportSession(format),
  })

  // What the menu is allowed to offer. Assembled here because this is the only component
  // that can see all of it at once.
  const menuState = useMemo(
    () => ({
      hasSession: live !== null,
      running: live?.running ?? false,
      canSend: live !== null && !live.running && draft.trim().length > 0,
      canExport: exportable.length > 0,
      folded: collapsed,
    }),
    [live, draft, collapsed, exportable],
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
      <Sessions
        sessions={sessions}
        openId={live?.summary.id ?? undefined}
        onOpen={open}
        onNew={create}
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
        canExport={exportable.length > 0}
        onExport={(format) => void exportSession(format)}
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
