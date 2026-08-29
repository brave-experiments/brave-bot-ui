/**
 * A conversation, laid out for paper.
 *
 * The bubbles are the transcript's own: same class names, same `Markdown` component for a
 * reply, same everything. That is the point of drawing the PDF in a renderer at all — there
 * is one implementation of what a reply looks like, so the file cannot drift from the window
 * and a link in an exported reply is gated by the same `safeUrl` that gates it on screen.
 *
 * What differs is arrangement, and it lives next door in `export.css`: paper has no scroll
 * bars, no dark mode worth having, and no reason to align one speaker against the right
 * margin. The role label carries who spoke instead, because the chat-window trick of
 * position-means-speaker stops being legible the moment a turn breaks across a page.
 */

import { Markdown } from './Markdown'
import { OMITTED, where, type ExportDocument } from '../../shared/export'

/** The same fixed locale the text and markdown exports use, for the same reason. */
function when(at: number): string {
  return new Date(at).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })
}

export function ExportView({
  document,
  at,
}: {
  document: ExportDocument
  at: number
}): React.JSX.Element {
  return (
    <article className="export">
      <header className="export-head">
        <h1>{document.title}</h1>
        <p className="where">{where(document)}</p>
        <p className="exported-at">Exported {when(at)}</p>
      </header>

      {document.turns.map((turn, index) => (
        // Indexed because a turn has no id of its own here — the document that crossed is
        // the parsed one, and giving it ids in the renderer would be inventing a field the
        // boundary does not carry. The list never reorders, so the index is stable.
        <section className="export-turn" key={index}>
          <p className="role">{turn.role === 'user' ? 'You' : 'Brave Bot'}</p>
          {turn.role === 'user' ? (
            <div className="bubble user">{turn.text}</div>
          ) : (
            <div className="bubble assistant">
              <Markdown text={turn.text} />
            </div>
          )}
        </section>
      ))}

      {/* The same sentence the other two formats end with. A reader holding the printout
          should not have to know which parts of a session an export leaves behind. */}
      <footer className="export-foot">{OMITTED}</footer>
    </article>
  )
}
