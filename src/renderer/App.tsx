import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
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
import * as t from './transcript'

/** What the app is doing, which decides most of what the interface offers. */
interface Live {
  handle: string
  summary: { title: string; project: string; branch: string | null; directory: string }
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
      const opened = await call<OpenedSession>('session.open', {
        directory: summary.directory,
        id: summary.id,
      })
      setLive({
        handle: opened.session,
        summary: {
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
      const notes = [opened.branchNote, opened.buildNote].filter(Boolean) as string[]
      setProblem(notes.length ? notes.join(' · ') : null)
    } catch (error) {
      setProblem(String(error))
    }
  }, [])

  const create = useCallback(async () => {
    const directory = await window.bravebot.chooseDirectory()
    if (!directory) return
    try {
      const made = await call<{ session: string; branch: string | null }>('session.new', {
        directory,
      })
      setLive({
        handle: made.session,
        summary: {
          title: 'New session',
          project: directory.split('/').pop() ?? directory,
          branch: made.branch,
          directory,
        },
        entries: [],
        todos: [],
        quarantine: [],
        phase: null,
        tokens: 0,
        running: false,
        askingTrust: directory,
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

  const pending = useMemo(
    () => (live ? t.outstanding(live.entries) : null),
    [live],
  )

  const { widths, collapsed, dragging, folding, start, reset, nudge, toggle } = useColumns()

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
        openId={live?.handle ? sessions.find((s) => s.title === live.summary.title)?.id : undefined}
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
        onSend={send}
        onCancel={cancel}
        onDecide={answer}
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
