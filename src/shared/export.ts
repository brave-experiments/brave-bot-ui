/**
 * A conversation on its way out of the app, and the one thing that decides whether a
 * message from the window is one.
 *
 * The shape crosses the same three boundaries the layout does — the renderer builds it, the
 * preload types it, the main process writes it down — so the guard lives here with the
 * declaration, for the reason `layout.ts` next door gives: three checks that must agree is
 * three chances to disagree.
 *
 * ## Why the turns cross and not a finished document
 *
 * The renderer could serialize the file itself and hand over a string. It deliberately does
 * not. A string is something the main process can only check the *type* of, and the comment
 * on `bravebot:layout:write` refuses exactly that arrangement: what lands on disk should be
 * something this side composed from a value it understood, never bytes the renderer handed
 * over. So a structured document crosses, [`parseExportRequest`] rebuilds it field by field,
 * and the renderers below run in the main process on the result.
 *
 * ## What an export contains, and what it says about that
 *
 * Two kinds: what the person asked and what the planner replied. Not the tool lines, not the
 * diffs, not the five decision cards, not the confined blobs. `plainText` next door already
 * makes this argument for the clipboard — those things are evidence, laid out to be read in
 * place, and a paragraph made out of one reads like a record of the exchange without being
 * one. A whole *file* that did it would make the same false claim at document scale, so
 * every export ends with a line saying what it left out rather than trusting the reader to
 * infer it.
 */

export type ExportFormat = 'txt' | 'md' | 'pdf'

/** One thing somebody said. The only two kinds an export carries. */
export interface ExportTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface ExportDocument {
  title: string
  directory: string
  branch: string | null
  turns: ExportTurn[]
}

export interface ExportRequest {
  format: ExportFormat
  document: ExportDocument
}

/**
 * How an export ended.
 *
 * Cancelled is not a failure and has no message: somebody changed their mind, which is not
 * news and must not put anything on screen. `where` comes back on success because it is a
 * path the user has just typed into a native sheet — telling the window about it grants
 * nothing it did not watch happen.
 */
export type ExportOutcome =
  | { status: 'saved'; where: string }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string }

export const EXTENSION: Record<ExportFormat, string> = {
  txt: 'txt',
  md: 'md',
  pdf: 'pdf',
}

/**
 * How much of a session an export will carry.
 *
 * A guard on the offscreen window's memory rather than a policy about what a session may
 * contain: the PDF path lays the whole document out and paginates it in one pass, and there
 * is no partial answer to give if that runs out of room. The text formats are held to the
 * same numbers only because the cap lives in the parse they share, which is a simplification
 * worth naming rather than an opinion about how long a text file may be.
 */
export const MAX_TURNS = 2000
export const MAX_CHARS = 4_000_000

export function isExportFormat(value: unknown): value is ExportFormat {
  return value === 'txt' || value === 'md' || value === 'pdf'
}

/**
 * An export request, or nothing.
 *
 * Nothing is coerced, for the reason `parseLayout` gives: this decides what gets written to
 * a file somebody will keep, and a half-understood message is not a conversation. The
 * returned object is built fresh from the fields that were understood, so a renderer bug
 * cannot smuggle a fourth key through to the window that renders the PDF.
 *
 * An empty conversation comes back `null` rather than as a document with no turns. The
 * button is greyed and the menu items disabled for the same case, and this is the copy of
 * that judgement that cannot be got around.
 */
export function parseExportRequest(value: unknown): ExportRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { format, document } = value as { format?: unknown; document?: unknown }
  if (!isExportFormat(format)) return null
  if (typeof document !== 'object' || document === null) return null

  const { title, directory, branch, turns } = document as {
    title?: unknown
    directory?: unknown
    branch?: unknown
    turns?: unknown
  }
  if (typeof title !== 'string') return null
  if (typeof directory !== 'string') return null
  if (branch !== null && typeof branch !== 'string') return null
  if (!Array.isArray(turns) || turns.length === 0 || turns.length > MAX_TURNS) return null

  const kept: ExportTurn[] = []
  let chars = 0
  for (const turn of turns) {
    if (typeof turn !== 'object' || turn === null) return null
    const { role, text } = turn as { role?: unknown; text?: unknown }
    if (role !== 'user' && role !== 'assistant') return null
    if (typeof text !== 'string') return null
    const trimmed = text.trim()
    // A turn with nothing in it is dropped rather than refused: it is not a malformed
    // message, it is a prompt that was all whitespace, and the rest of the conversation is
    // still worth writing down.
    if (trimmed.length === 0) continue
    chars += trimmed.length
    if (chars > MAX_CHARS) return null
    kept.push({ role, text: trimmed })
  }
  if (kept.length === 0) return null

  return { format, document: { title, directory, branch, turns: kept } }
}

/** What each side is called in an exported file. */
const SPEAKER: Record<ExportTurn['role'], string> = {
  user: 'You',
  assistant: 'Brave Bot',
}

/**
 * The line every export ends with.
 *
 * See the note at the top of this file: an export carries the conversation and not the
 * evidence, and saying so is cheaper than a reader discovering it.
 */
export const OMITTED = 'Tool calls, diffs and approvals are not part of this export.'

/**
 * When it was written, in a fixed locale.
 *
 * Not the machine's, so one session exported twice on two computers produces the same bytes.
 */
function when(at: number): string {
  return new Date(at).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })
}

/** `directory · branch`, or just the directory where there is no branch. */
export function where(document: ExportDocument): string {
  return document.branch ? `${document.directory} · ${document.branch}` : document.directory
}

/**
 * The session's own description, as the window's header already gives it: the same three
 * facts in the same order, because the top of the file should be the top of the window.
 */
export function toPlainText(document: ExportDocument, at: number): string {
  const rule = '─'.repeat(60)
  const lines = [document.title, where(document), `Exported ${when(at)}`, '', rule, '']
  for (const turn of document.turns) {
    lines.push(SPEAKER[turn.role], turn.text, '')
  }
  lines.push(rule, OMITTED)
  return `${lines.join('\n')}\n`
}

/**
 * The same conversation as Markdown.
 *
 * The assistant's words go in untouched, because they already are Markdown — that is what
 * the bubble on screen is rendering. A prompt is not, so it is quoted: a person's own text
 * is not a document, and a prompt that happened to begin with `#` would otherwise become
 * somebody's heading. That is presentation and not sanitisation, and the difference matters
 * enough to say out loud — a `.md` file is a document, not a trust surface, and none of the
 * app's structural markings survive being written to one.
 */
export function toMarkdown(document: ExportDocument, at: number): string {
  const quoted = (text: string): string =>
    text
      .split('\n')
      .map((line) => (line.length > 0 ? `> ${line}` : '>'))
      .join('\n')

  const out = [
    `# ${document.title}`,
    '',
    `\`${where(document)}\` · exported ${when(at)}`,
    '',
    '---',
    '',
  ]
  for (const turn of document.turns) {
    out.push(`**${SPEAKER[turn.role]}**`, '')
    out.push(turn.role === 'user' ? quoted(turn.text) : turn.text, '')
  }
  out.push('---', '', `*${OMITTED}*`)
  return `${out.join('\n')}\n`
}

/**
 * What to call the file, before the user gets a say.
 *
 * A session's title is written by the agent from the first prompt, which makes this the one
 * piece of model-influenced text that reaches a native control. The rule about renderable
 * content in `commands.ts` is about menu *labels* and does not reach a filename field, but
 * what a title can do to a path does: a separator escapes the directory, a leading dot hides
 * the file, and a bidirectional override makes `notes.txt.app` draw as something else
 * entirely. So this strips rather than escapes, and falls back to a name of our own when
 * nothing survives.
 */
export function suggestedFilename(title: string, format: ExportFormat): string {
  const cleaned = title
    .normalize('NFC')
    // Path separators and the drive marker, then everything unprintable — including the
    // format characters that reorder what a person reads.
    .replace(/[/:\\]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\p{Cf}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, 80)
    .trim()
  return `${cleaned || 'Brave Bot session'}.${EXTENSION[format]}`
}

/**
 * The path the user chose, with the extension it needs.
 *
 * Appends rather than replaces. Somebody who typed `notes.v2` into the sheet gets
 * `notes.v2.md`: the OS handed back exactly what a person asked for, and rewriting the part
 * they typed would be the app overruling them about the name of their own file.
 */
export function withExtension(path: string, format: ExportFormat): string {
  const wanted = `.${EXTENSION[format]}`
  return path.toLowerCase().endsWith(wanted) ? path : `${path}${wanted}`
}
