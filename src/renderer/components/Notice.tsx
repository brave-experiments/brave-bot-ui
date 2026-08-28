import { useEffect, useRef } from 'react'

/**
 * Something the app has to say, with nothing to decide about it.
 *
 * The opposite of [`TrustPrompt`] in every way that matters. That one is modal because an
 * answer is load-bearing and there is deliberately no way past it; this one is modal only
 * because it is on top of the window, and every ordinary way out of it works: Escape, the
 * scrim, the button. A panel showing a build stamp has no business trapping anybody.
 *
 * It holds what a menu item found out — the agent's build, or what `bravebot doctor` said —
 * and both of those are text of unknown length, so the body scrolls and the text is
 * monospaced rather than being made to look like prose it is not.
 */
export function Notice({
  title,
  body,
  onClose,
}: {
  title: string
  body: string
  onClose: () => void
}): React.JSX.Element {
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div
      className="scrim"
      // Only a click that both starts and ends on the scrim closes it, which is what stops
      // a text selection dragged out of the panel from dismissing what was being read.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="notice" role="dialog" aria-modal="true" aria-labelledby="notice-title">
        <h2 id="notice-title">{title}</h2>
        <pre className="notice-body">{body}</pre>
        <div className="notice-actions">
          <button className="approve" autoFocus onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
