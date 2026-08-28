import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A menu that hangs off a control in the window.
 *
 * The app pops native menus for right-clicks — see `src/main/menu.ts` — and this exists
 * alongside them rather than instead of them, because an anchored picker and a context menu
 * are different objects. This one has to return focus to the button that opened it, and it
 * has to be able to say "no projects opened yet" in the app's own voice. `Menu.popup` gives
 * back no focus contract at all: once it returns, the button has no way to know the menu
 * closed. For a control somebody may be driving from the keyboard that is disqualifying.
 *
 * Both are fed from the same declarations, so the two mechanisms cannot drift about *what*
 * they offer even though they differ in how they draw it.
 */

export interface PopItem {
  id: string
  label: string
  /** The quieter second line — a full path under a folder's name. */
  detail?: string
  enabled?: boolean
}

export function PopMenu({
  open,
  anchor,
  items,
  label,
  onChoose,
  onClose,
}: {
  open: boolean
  anchor: React.RefObject<HTMLElement | null>
  items: readonly PopItem[]
  label: string
  onChoose: (id: string) => void
  onClose: () => void
}): React.JSX.Element | null {
  const menu = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ left: number; top: number } | null>(null)
  const [active, setActive] = useState(0)
  const typed = useRef<{ buffer: string; when: number }>({ buffer: '', when: 0 })

  const usable = items.filter((item) => item.enabled !== false)
  const first = items.findIndex((item) => item.enabled !== false)

  const shut = useCallback(() => {
    onClose()
    // Focus goes back where it came from. A menu that leaves focus on the body has stranded
    // whoever opened it from the keyboard.
    anchor.current?.focus()
  }, [onClose, anchor])

  // Placed before paint, so it never appears at the corner for a frame and then moves.
  useLayoutEffect(() => {
    if (!open) return
    const button = anchor.current
    const box = menu.current
    if (!button || !box) return
    const from = button.getBoundingClientRect()
    const size = box.getBoundingClientRect()
    const left = Math.max(8, Math.min(from.left, window.innerWidth - size.width - 8))
    // Flipped above the anchor when there is no room below it, which is what a menu near the
    // bottom of a window has to do.
    const below = from.bottom + 4
    const top = below + size.height > window.innerHeight - 8 ? from.top - size.height - 4 : below
    setAt({ left, top: Math.max(8, top) })
  }, [open, anchor, items.length])

  useEffect(() => {
    if (!open) return
    setActive(first < 0 ? 0 : first)
  }, [open, first])

  // Focus follows the active row, which is what makes arrow keys announce anything.
  useEffect(() => {
    if (!open || !at) return
    const rows = menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    rows?.[active]?.focus()
  }, [open, at, active])

  useEffect(() => {
    if (!open) return
    // `pointerdown` rather than `click`, so the menu is gone before the click lands on
    // whatever was underneath it. The anchor is excluded, or a click on the button that
    // opened this would close it here and reopen it there.
    const outside = (event: PointerEvent): void => {
      const where = event.target as Node
      if (menu.current?.contains(where) || anchor.current?.contains(where)) return
      onClose()
    }
    // Closed rather than followed: it is what AppKit does, and it is one behaviour instead
    // of a reflow loop chasing the anchor.
    const away = (): void => onClose()
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', away, true)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('resize', away)
      window.removeEventListener('scroll', away, true)
    }
  }, [open, onClose, anchor])

  if (!open) return null

  const step = (by: number): void => {
    if (usable.length === 0) return
    let next = active
    for (let tried = 0; tried < items.length; tried++) {
      next = (next + by + items.length) % items.length
      if (items[next]?.enabled !== false) break
    }
    setActive(next)
  }

  const keys = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') step(1)
    else if (event.key === 'ArrowUp') step(-1)
    else if (event.key === 'Home') setActive(first < 0 ? 0 : first)
    else if (event.key === 'End') {
      for (let index = items.length - 1; index >= 0; index--) {
        if (items[index]?.enabled !== false) {
          setActive(index)
          break
        }
      }
    } else if (event.key === 'Escape') shut()
    else if (event.key === 'Tab') {
      // Closed rather than trapped. This is a picker, not a dialog; trapping focus in a
      // three-item menu is how a keyboard user gets stuck in one.
      onClose()
      return
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      const now = Date.now()
      const buffer = now - typed.current.when > 500 ? event.key : typed.current.buffer + event.key
      typed.current = { buffer, when: now }
      const found = items.findIndex(
        (item) => item.enabled !== false && item.label.toLowerCase().startsWith(buffer.toLowerCase()),
      )
      if (found >= 0) setActive(found)
    } else return
    event.preventDefault()
  }

  return createPortal(
    <div
      ref={menu}
      className="popmenu"
      role="menu"
      aria-label={label}
      // Hidden until placed, so nothing is ever drawn in the wrong corner.
      style={at ? { left: at.left, top: at.top } : { opacity: 0, pointerEvents: 'none' }}
      onKeyDown={keys}
    >
      {items.map((entry, index) => (
        <button
          key={entry.id}
          role="menuitem"
          type="button"
          className={`popitem ${index === active ? 'active' : ''}`}
          // `aria-disabled` rather than the attribute: a disabled button leaves the
          // accessibility tree, and the empty state here is a single disabled row that
          // still has to be readable.
          aria-disabled={entry.enabled === false || undefined}
          tabIndex={-1}
          onClick={() => {
            if (entry.enabled === false) return
            onChoose(entry.id)
            shut()
          }}
        >
          <span className="popitem-label">{entry.label}</span>
          {entry.detail && <span className="popitem-detail">{entry.detail}</span>}
        </button>
      ))}
    </div>,
    document.body,
  )
}
