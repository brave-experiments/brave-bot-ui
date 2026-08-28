import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'

/**
 * The model's own words, formatted.
 *
 * Used for the assistant bubble and nowhere else. That is a trust boundary, not an
 * oversight: this UI marks confined content *structurally* — the hatched border on
 * `.quarantine`, the doubled `--warn` border on an untrusted write — precisely so that
 * text cannot imitate chrome. Formatting is an imitation tool. Give quarantined content
 * headings, bold and links and it has the vocabulary to counterfeit the very signals the
 * reader is meant to trust, sitting inches above it. So the fact that a bubble is
 * formatted is itself information: it says these words came from the planner, released
 * through `reply_for_display()`, rather than from a file somebody fetched.
 *
 * **No HTML path exists.** react-markdown renders to React elements, and without
 * `rehype-raw` — which is deliberately not installed — raw HTML in a reply arrives as
 * escaped, inert text. That is why there is no sanitizer here: there is nothing to
 * sanitise. `dangerouslySetInnerHTML` appears nowhere in this codebase and must not start
 * here.
 */

/** Schemes a link may use. Everything else is drawn as text rather than as a link. */
const OPENABLE = new Set(['http:', 'https:', 'mailto:'])

/**
 * The href to use, or `null` to draw the text without a link.
 *
 * Stricter than it looks like it needs to be, because a link here is a real capability:
 * the main process answers a window-open by handing the URL to `shell.openExternal`, so
 * `file:` would ask the OS to open a path of the model's choosing. Parsing rather than
 * matching a prefix is what catches the encoded and whitespace-padded spellings of
 * `javascript:` that a string comparison waves through. A relative URL fails too, and
 * should: there is nothing for it to be relative *to* in a `file://` renderer.
 */
export function safeUrl(href: string | undefined): string | null {
  if (!href) return null
  try {
    return OPENABLE.has(new URL(href).protocol) ? href : null
  } catch {
    return null
  }
}

/**
 * Hoisted so they are not fresh objects on every render.
 *
 * `Row` re-renders whenever anything at all happens in a turn — a token count ticks
 * several times a second — and new plugin and component objects on each pass would defeat
 * the memoisation below for no reason.
 */
const PLUGINS = [
  remarkGfm,
  // Soft breaks become real ones, which is what the plain-text renderer this replaces did
  // and what every chat interface does. Without it a reply written as short unbulleted
  // lines reflows into one paragraph — the one way this change could visibly damage prose
  // that reads correctly today.
  remarkBreaks,
]

const COMPONENTS: Components = {
  a({ href, children }) {
    const url = safeUrl(href)
    // `target="_blank"` is load-bearing, not decoration. The main process refuses
    // in-window navigation outright and answers a window-open by opening the user's
    // browser, so this is the only form of link that does anything at all.
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      // Drawn as text, because an anchor that cannot be followed is a lie about what
      // clicking it will do.
      <span className="md-dead-link">{children}</span>
    )
  },

  img({ src, alt, title }) {
    // Never an `<img>`. The CSP allows `data:` images, so rendering them would let a reply
    // paint arbitrary pixels beside the app's own chrome, and remote ones are blocked
    // outright and would show as a broken glyph indistinguishable from a bug. A label says
    // more than either, and keeps the alt text the model wrote.
    const url = safeUrl(typeof src === 'string' ? src : undefined)
    const label = alt || title || 'image'
    return url ? (
      <a className="md-image" href={url} target="_blank" rel="noopener noreferrer nofollow">
        image · {label}
      </a>
    ) : (
      <span className="md-image">image · {label}</span>
    )
  },

  table({ children }) {
    // A table wider than the bubble scrolls inside it rather than stretching the column.
    return (
      <div className="md-table-wrap">
        <table>{children}</table>
      </div>
    )
  },
}

/**
 * Memoised on the one string it takes.
 *
 * The parse is the expensive part and the reply never changes once it has arrived — there
 * is no token streaming, so a bubble is parsed exactly once no matter how long the turn
 * runs afterwards.
 *
 * Note there is deliberately no `code` override: react-markdown dropped the `inline` prop
 * in v9, and the usual workaround sniffs a class name to guess what it was. CSS already
 * knows the difference between `code` and `pre code` without guessing.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <ReactMarkdown remarkPlugins={PLUGINS} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  )
})
