import { useEffect, useRef, useState } from 'react'
import type { AskAnswer, AskPrompt, Phase, Shown, TodoRow } from '../../shared/protocol'
import * as t from '../transcript'
import type { Side } from '../columns'
import type { Asked } from '../App'
import { Diff } from './Diff'
import { Fold } from './Fold'
import { Markdown } from './Markdown'

interface Live {
  handle: string
  summary: { title: string; project: string; branch: string | null; directory: string }
  entries: t.Entry[]
  todos: TodoRow[]
  quarantine: Shown[]
  phase: Phase | null
  tokens: number
  running: boolean
  askingTrust: string | null
}

/**
 * How an answer travels back up.
 *
 * The kind rides along with the id: the reply goes to a different method per question, and
 * the card that drew the question is the only thing that knows which one it was.
 */
export type Answer = (
  kind: Asked,
  request: number,
  approve: boolean,
  remember?: boolean,
) => void

/** How a series of answers travels back up. */
export type AnswerQuestions = (request: number, answers: AskAnswer[]) => void

interface Props {
  live: Live | null
  pending: t.Asking | null
  problem: string | null
  collapsed: Record<Side, boolean>
  onToggle: (side: Side) => void
  onSend: (prompt: string) => void
  onCancel: () => void
  onDecide: Answer
  onAnswer: AnswerQuestions
}

/**
 * The control that folds one side column away.
 *
 * Both toggles live here, in the middle column's header, rather than each sitting in the
 * column it controls. A button that moved when its column folded would be unmounted and
 * mounted somewhere else — which drops keyboard focus to nothing, with no shortcut to get
 * back — and would read to a screen reader as a new control rather than as the same one
 * changing state.
 *
 * The name stays put and `aria-expanded` carries the state, which is the disclosure
 * pattern: a label that flipped between "Show" and "Hide" would say the state twice and
 * rename a button the moment it was pressed. The verb goes in `title`, which is for the
 * pointer.
 */
function ColumnToggle({
  side,
  collapsed,
  onToggle,
}: {
  side: Side
  collapsed: boolean
  onToggle: (side: Side) => void
}): React.JSX.Element {
  const what = side === 'left' ? 'the session list' : 'the context panel'
  return (
    <button
      className={`fold-toggle ${side}`}
      aria-expanded={!collapsed}
      aria-controls={side === 'left' ? 'sessions-column' : 'context-column'}
      aria-label={side === 'left' ? 'Session list' : 'Context panel'}
      title={`${collapsed ? 'Show' : 'Hide'} ${what}`}
      onClick={() => onToggle(side)}
    >
      {/* Pointing outward when folded — the way the column will come back — and inward
          when open. Decorative: the button is already named and its state announced. */}
      <span className={`fold-chevron ${collapsed ? '' : 'open'}`} aria-hidden="true">
        {side === 'left' ? '›' : '‹'}
      </span>
    </button>
  )
}

/** The middle column: the conversation, and everything the turn did inside it. */
export function Transcript({
  live,
  pending,
  problem,
  collapsed,
  onToggle,
  onSend,
  onCancel,
  onDecide,
  onAnswer,
}: Props): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [live?.entries.length, live?.phase])

  // The header is outside this branch on purpose. It carries the fold toggles and the
  // window's drag strip, and with no session open there would otherwise be neither: a
  // sessions column folded shut here could not be brought back, and the state outlives the
  // launch that caused it.
  const head = (
    <header className="transcript-head">
      <div className="drag" />
      <div className="head-row">
        <ColumnToggle side="left" collapsed={collapsed.left} onToggle={onToggle} />
        {/* Rendered even with nothing to name: it is what holds the two toggles at
            opposite ends of the header, and without it they collect in the corner. */}
        <div className="head-titles">
          {live && (
            <>
              <h1>{live.summary.title}</h1>
              <span className="where">
                {live.summary.directory}
                {live.summary.branch && ` · ${live.summary.branch}`}
              </span>
            </>
          )}
        </div>
        <ColumnToggle side="right" collapsed={collapsed.right} onToggle={onToggle} />
      </div>
      {problem && <p className="note">{problem}</p>}
    </header>
  )

  if (!live) {
    return (
      <main className="transcript empty-state">
        {head}
        <div className="empty-body">
          <div>
            <h1>Brave User Agent</h1>
            <p>Choose a session on the left, or open a project to start a new one.</p>
          </div>
        </div>
      </main>
    )
  }

  const submit = (): void => {
    const prompt = draft.trim()
    if (!prompt || live.running) return
    setDraft('')
    onSend(prompt)
  }

  return (
    <main className="transcript">
      {head}

      <div className="entries">
        {runs(live.entries).map((run) =>
          run.kind === 'run' ? (
            <ToolRun key={run.id} entries={run.entries} />
          ) : (
            <Row key={run.entry.id} entry={run.entry} onDecide={onDecide} onAnswer={onAnswer} />
          ),
        )}

        {live.running && (
          <div className="working">
            <span className="spinner" />
            {live.phase ? phaseWord(live.phase) : 'Working'}
            {live.tokens > 0 && <span className="count"> · {live.tokens} tokens written</span>}
            <button className="cancel" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}
        <div ref={bottom} />
      </div>

      <footer className="composer">
        <textarea
          value={draft}
          placeholder={pending ? `${waitingOn(pending.kind)} above first…` : 'Ask something…'}
          disabled={live.running && !pending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              submit()
            }
            if (event.key === 'Escape' && live.running) onCancel()
          }}
        />
        <button className="send" onClick={submit} disabled={live.running || !draft.trim()}>
          Send
        </button>
      </footer>
    </main>
  )
}

function phaseWord(phase: Phase): string {
  // The agent's own words, so the two interfaces say the same thing about the same wait.
  return phase === 'planning'
    ? 'Planning'
    : phase === 'thinking'
      ? 'Thinking'
      : phase === 'compacting'
        ? 'Compacting'
        : 'Reconnecting'
}

/**
 * Consecutive tool calls, gathered into one run.
 *
 * A turn that reads five files and writes five more puts ten lines between the question
 * and the answer, and they are the least interesting thing on screen once it is over. A
 * run of them is one thing that happened, so it is drawn as one thing that can be put away.
 *
 * Only calls are gathered. A confirmation is waiting on an answer and confined content is
 * the point of the tool, so neither is ever swept into a fold with a lid on it.
 */
type Run = { kind: 'one'; entry: t.Entry } | { kind: 'run'; id: string; entries: t.Entry[] }

const isCall = (entry: t.Entry): boolean =>
  entry.kind === 'tool' || entry.kind === 'replayed-tool'

export function runs(entries: t.Entry[]): Run[] {
  const out: Run[] = []
  for (const entry of entries) {
    const last = out[out.length - 1]
    if (isCall(entry) && last?.kind === 'run') last.entries.push(entry)
    else if (isCall(entry)) out.push({ kind: 'run', id: entry.id, entries: [entry] })
    else out.push({ kind: 'one', entry })
  }
  // A run of one is just a line. Giving it a header and a chevron would be more furniture
  // than the thing it contains.
  return out.map((run) =>
    run.kind === 'run' && run.entries.length === 1 && run.entries[0]
      ? { kind: 'one', entry: run.entries[0] }
      : run,
  )
}

function ToolRun({ entries }: { entries: t.Entry[] }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <section className={`tool-run ${open ? 'open' : ''}`}>
      <button className="tool-run-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={`chevron ${open ? 'open' : ''}`} aria-hidden="true">
          ›
        </span>
        {entries.length} step{entries.length === 1 ? '' : 's'}
      </button>
      <Fold open={open}>
        {entries.map((entry) => (
          <Row
            key={entry.id}
            entry={entry}
            onDecide={() => undefined}
            onAnswer={() => undefined}
          />
        ))}
      </Fold>
    </section>
  )
}

/**
 * A series of questions the planner is putting to the person.
 *
 * The one question in the interface that is not a yes or a no, so it holds its own state
 * until it is sent: several questions arrive together and are answered together, in one
 * reply, because the turn is blocked on the series rather than on any one of them.
 *
 * A question with no rows is not a mistake — it can only be answered in the person's own
 * words — and every question keeps a free-text box for the same reason: the model's options
 * may all be wrong, and forcing a choice between them would put words in somebody's mouth.
 */
function Questions({
  request,
  answers,
  onAnswer,
}: {
  request: t.Entry & { kind: 'ask' }
  answers: AskAnswer[] | null
  onAnswer: AnswerQuestions
}): React.JSX.Element {
  const prompts = request.request.prompts
  const [picked, setPicked] = useState<number[][]>(() => prompts.map(() => []))
  const [typed, setTyped] = useState<string[]>(() => prompts.map(() => ''))

  const choose = (question: number, index: number, multiple: boolean): void => {
    setPicked((old) =>
      old.map((chosen, at) => {
        if (at !== question) return chosen
        if (!multiple) return chosen.includes(index) ? [] : [index]
        return chosen.includes(index)
          ? chosen.filter((one) => one !== index)
          : [...chosen, index].sort((a, b) => a - b)
      }),
    )
  }

  /**
   * What each question would be answered with.
   *
   * Typed words win over a selection, matching what the agent does with a reply that
   * carries both: they are the more specific thing to have done. An empty answer is sent as
   * an empty object, which is how declining is said.
   */
  const collected = (): AskAnswer[] =>
    prompts.map((_, at) => {
      const words = typed[at]?.trim() ?? ''
      if (words) return { typed: words }
      const chosen = picked[at] ?? []
      return chosen.length > 0 ? { chosen } : {}
    })

  const blank = collected().filter((answer) => !answer.typed && !answer.chosen).length

  if (answers) {
    return (
      <div className="confirm ask">
        <div className="confirm-head">
          <span className="intent">asked</span>
          <span className="path">
            {prompts.length} question{prompts.length === 1 ? '' : 's'}
          </span>
        </div>
        {prompts.map((prompt, at) => (
          // Keyed by position, not by `prompt.key`: that key is canonical *content*, and a
          // series may legitimately contain the same question twice. The order never
          // changes — the agent emits one prompt per question, in order — so the index is
          // both stable and unique where the content is only stable.
          <div className="asked-answer" key={at}>
            <div className="question">{prompt.question}</div>
            <div className="given">{describe(prompt, answers[at])}</div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="confirm ask">
      <div className="confirm-head">
        <span className="intent">asked</span>
        <span className="path">
          {prompts.length} question{prompts.length === 1 ? '' : 's'}
        </span>
      </div>

      {prompts.map((prompt, at) => (
        <fieldset className="ask-question" key={at}>
          <legend>
            <span className="header">{prompt.header}</span>
            {prompt.multiple && <span className="any">pick any</span>}
          </legend>
          <div className="question">{prompt.question}</div>

          <ul className="choices">
            {prompt.rows.map((row) => (
              <li key={row.index}>
                <button
                  className={`choice ${(picked[at] ?? []).includes(row.index) ? 'picked' : ''}`}
                  aria-pressed={(picked[at] ?? []).includes(row.index)}
                  onClick={() => choose(at, row.index, prompt.multiple)}
                >
                  <span className="label">{row.label}</span>
                  {row.detail && <span className="detail">{row.detail}</span>}
                </button>
              </li>
            ))}
          </ul>

          <input
            className="typed"
            value={typed[at] ?? ''}
            placeholder={prompt.rows.length > 0 ? 'or say something else…' : 'your answer…'}
            onChange={(event) =>
              setTyped((old) => old.map((text, index) => (index === at ? event.target.value : text)))
            }
          />
        </fieldset>
      ))}

      <div className="confirm-actions">
        {/* Declining every question is a real answer and the turn continues, so it is a
            button here rather than something a person has to leave blank and guess at. */}
        <button className="reject" onClick={() => onAnswer(request.request.request, prompts.map(() => ({})))}>
          Decline
        </button>
        <button className="approve" onClick={() => onAnswer(request.request.request, collected())}>
          Answer
          {/* Leaving a question blank declines it, which is legitimate but should not be a
              surprise — with several questions on screen it is easy to answer two of three
              and not notice. Said on the button rather than after the fact. */}
          {blank > 0 && prompts.length > 1 && (
            <span className="aside"> · {blank} declined</span>
          )}
        </button>
      </div>
    </div>
  )
}

/** What somebody answered, in words, for the record left in the transcript. */
function describe(prompt: AskPrompt, answer: AskAnswer | undefined): string {
  if (!answer) return 'Declined'
  if (answer.typed) return answer.typed
  const chosen = answer.chosen ?? []
  if (chosen.length === 0) return 'Declined'
  return chosen
    .map((index) => prompt.rows.find((row) => row.index === index)?.label ?? `#${index}`)
    .join(', ')
}

function Row({
  entry,
  onDecide,
  onAnswer,
}: {
  entry: t.Entry
  onDecide: Answer
  onAnswer: AnswerQuestions
}): React.JSX.Element {
  switch (entry.kind) {
    case 'user':
      return <div className="bubble user">{entry.text}</div>

    case 'assistant':
      // The only formatted surface in the app. See Markdown.tsx for why it is the only one.
      return (
        <div className="bubble assistant">
          <Markdown text={entry.text} />
        </div>
      )

    case 'narration':
      return <div className="narration">{entry.text}</div>

    case 'error':
      return <div className="bubble failed">{entry.text}</div>

    case 'replayed-tool':
      // No outcome, because the record does not keep one. Drawn quietly for the same
      // reason: a call the agent could not even name reads as "Tool", and giving that
      // the prominence of a real line would be worse than the gap.
      return <div className="tool replayed">{entry.text}</div>

    case 'tool': {
      const { activity, landing } = entry
      const running = activity.note === null
      return (
        <div className={`tool ${activity.failed ? 'failed' : ''} ${running ? 'running' : ''}`}>
          <span className="verb">{activity.verb}</span>
          {activity.target && <span className="target">({activity.target})</span>}
          {running ? (
            <span className="ellipsis">…</span>
          ) : (
            <span className="note">{activity.note}</span>
          )}
          {landing && landing !== 'context' && (
            <span className="confined" title={landingHint(landing)}>
              {landing === 'quarantined' ? 'quarantined' : 'name only'}
            </span>
          )}
        </div>
      )
    }

    case 'quarantined': {
      const { shown } = entry
      return (
        <div className="quarantine">
          <div className="quarantine-head">
            <span className="mark">confined</span>
            <span className="origin">{shown.origin}</span>
            <span className="label">{shown.label}</span>
          </div>
          <pre className="preview">{shown.preview.join('\n')}</pre>
          <div className="quarantine-foot">
            {shown.lines} line{shown.lines === 1 ? '' : 's'} total ·{' '}
            {shown.reach === 'no_model'
              ? 'in no model’s context: nothing can be sent to read this'
              : 'not in the planner’s context; a processor can be sent to read it'}
          </div>
        </div>
      )
    }

    case 'confirm': {
      const { request, decision } = entry
      return (
        <div className={`confirm ${request.untrusted ? 'untrusted' : ''}`}>
          <div className="confirm-head">
            <span className="intent">{request.intent}</span>
            <code className="path">{request.path}</code>
            <span className="counts">
              +{request.added} −{request.removed}
            </span>
          </div>

          {request.untrusted && (
            <p className="warn">
              This came from somewhere nobody vouched for. The agent never read it — an
              isolated processor wrote it. Read it as you would a stranger’s patch.
            </p>
          )}
          {!request.exact && (
            <p className="warn">
              The files were too dissimilar to diff exactly. This is an approximation of
              the change.
            </p>
          )}

          <Diff changes={request.changes} />

          {decision === null ? (
            <div className="confirm-actions">
              <button className="reject" onClick={() => onDecide('confirm', request.request, false)}>
                Don’t write
              </button>
              <button className="approve" onClick={() => onDecide('confirm', request.request, true)}>
                {request.existing ? 'Apply this change' : 'Create this file'}
              </button>
            </div>
          ) : (
            <div className={`decided ${decision}`}>
              {decision === 'approve' ? 'You approved this write' : 'You refused this write'}
            </div>
          )}
        </div>
      )
    }

    case 'run': {
      const { request, decision, remember } = entry
      return (
        <div className={`confirm run ${request.releasesPrivate ? 'releases' : ''}`}>
          <div className="confirm-head">
            <span className="intent">run</span>
            <code className="path">{request.directory}</code>
          </div>

          {/* The argv, one stage per line, with what each name resolved to underneath.
              Both are shown because they are two different claims: $PATH decides what
              `grep` means, and a person vouching for a program should be looking at the
              binary rather than the word. */}
          <ol className="stages">
            {request.stages.map((stage, index) => (
              <li key={index}>
                <code className="argv">{stage.display}</code>
                <span className="resolved">
                  {stage.resolved ?? 'not found on PATH'}
                </span>
              </li>
            ))}
          </ol>

          {request.releasesPrivate && (
            <p className="warn">
              This hands your own data to the program. Whatever it does with those bytes
              happens somewhere the agent stops governing them.
            </p>
          )}

          {decision === null ? (
            <div className="confirm-actions">
              <button className="reject" onClick={() => onDecide('run', request.request, false)}>
                Don’t run
              </button>
              <button className="approve" onClick={() => onDecide('run', request.request, true)}>
                Run once
              </button>
              {/* Separate from "Run once" rather than a checkbox beside it: remembering
                  answers every later question about these programs, so it should take its
                  own deliberate press. The title says exactly what it would cover. */}
              <button
                className="approve always"
                title={`Stop asking about: ${request.vouches.map((v) => v.display).join(', ')}`}
                onClick={() => onDecide('run', request.request, true, true)}
              >
                Run and don’t ask again
              </button>
            </div>
          ) : (
            <div className={`decided ${decision}`}>
              {decision === 'reject'
                ? 'You refused this command'
                : remember
                  ? 'You ran this and vouched for the programs'
                  : 'You ran this once'}
            </div>
          )}
        </div>
      )
    }

    case 'output': {
      const { request, decision } = entry
      return (
        <div className="confirm output">
          <div className="confirm-head">
            <span className="intent">read output</span>
            <code className="path">{request.command}</code>
            <span className="counts">
              {request.lines} line{request.lines === 1 ? '' : 's'}
            </span>
          </div>

          <p className="warn">
            The planner has not seen this. Read it yourself before deciding: approving is
            what puts it into the model’s context, and anything in here that reads like an
            instruction will be read there as one.
          </p>

          {/* In full, never truncated. The answer to this question rests on the bytes, so
              a preview would be asking for an approval of what nobody saw. */}
          <pre className="preview">{request.output}</pre>

          {decision === null ? (
            <div className="confirm-actions">
              <button
                className="reject"
                onClick={() => onDecide('output', request.request, false)}
              >
                Keep it out
              </button>
              <button
                className="approve"
                onClick={() => onDecide('output', request.request, true)}
              >
                Let the planner read it
              </button>
            </div>
          ) : (
            <div className={`decided ${decision}`}>
              {decision === 'approve'
                ? 'You let the planner read this'
                : 'You kept this out of the planner’s context'}
            </div>
          )}
        </div>
      )
    }

    case 'ask':
      return <Questions request={entry} answers={entry.answers} onAnswer={onAnswer} />

    case 'vouch': {
      const { request, decision } = entry
      return (
        <div className="confirm vouch">
          <div className="confirm-head">
            <span className="intent">vouch</span>
            <code className="path">{request.path}</code>
          </div>

          <p className="warn">
            Vouching records a standing rule for this path, so it applies to later reads as
            well as this one. Only do it for content you know the origin of.
          </p>

          <pre className="preview">{request.preview}</pre>
          {request.truncated && (
            <div className="quarantine-foot">
              This is the beginning of the file, not all of it.
            </div>
          )}

          {decision === null ? (
            <div className="confirm-actions">
              <button
                className="reject"
                onClick={() => onDecide('vouch', request.request, false)}
              >
                Leave it confined
              </button>
              <button
                className="approve"
                onClick={() => onDecide('vouch', request.request, true)}
              >
                Vouch for this path
              </button>
            </div>
          ) : (
            <div className={`decided ${decision}`}>
              {decision === 'approve'
                ? 'You vouched for this path'
                : 'You left it confined'}
            </div>
          )}
        </div>
      )
    }
  }
}

/**
 * What the composer says while a question is outstanding.
 *
 * Named for the question rather than a generic "answer the prompt", because the five are
 * not interchangeable and somebody who has scrolled away needs to know what they are
 * being asked before they scroll back.
 */
function waitingOn(kind: t.Asking['kind']): string {
  switch (kind) {
    case 'confirm':
      return 'Answer the write'
    case 'run':
      return 'Answer the command'
    case 'output':
      return 'Answer the output'
    case 'vouch':
      return 'Answer the vouch'
    case 'ask':
      return 'Answer the questions'
  }
}

function landingHint(landing: string): string {
  return landing === 'quarantined'
    ? 'not in the planner’s context; only an isolated processor can be sent to read it'
    : 'read by nothing: only its name is known'
}
