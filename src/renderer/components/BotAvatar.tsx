/**
 * A bot's face.
 *
 * A small three-dimensional figure, built from the bot's seed and turning slowly. What it is made
 * of and why it looks the way it does is `../avatar/figure.ts`; how twenty of them share one WebGL
 * context is `../avatar/stage.ts`. This is the part that puts one in a row.
 *
 * It is a `<canvas>` that the shared renderer copies into, rather than a canvas with a context of
 * its own — a page gets a limited number of WebGL contexts and a list of bots is exactly where
 * that limit is met.
 *
 * ## The fallback, and why there is one
 *
 * WebGL can be unavailable: software rendering, a driver that will not start, a machine with the
 * GPU process off. A list of bots with no faces in it is a worse list but still a list, so where
 * there is no renderer this draws the flat mark it used to — a mirrored grid from the same seed.
 * Nothing about a bot depends on the picture, and a column that failed to render its rows because
 * of a driver would be the tail wagging the dog.
 *
 * ## What it says
 *
 * Nothing. The icon carries no information that is not in the name beside it, so it is
 * `aria-hidden` and the row's text is what a screen reader reads. `data-avatar` carries the figure
 * the seed chose — `blue-squat-bobble-plain-big-pill-collar`, its colour and then its form — which
 * is there so a test can say two bots have different faces, and that one bot's face survived a
 * rename, without comparing pixels of a picture that is moving while it is compared.
 */

import { useEffect, useRef } from 'react'
import { available, show } from '../avatar/stage'
import { paintsOf, signature } from '../avatar/figure'

interface Props {
  /** The bot's stored seed. Anything goes; this only ever hashes it. */
  seed: string
  /** The side of the square, in CSS pixels. */
  size?: number
}

export function BotAvatar({ seed, size = 38 }: Props): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    return show(element, seed)
  }, [seed])

  if (!available()) return <FlatAvatar seed={seed} size={size} />

  // Drawn at twice the size it is shown at, so it is not soft on a retina display. Fixed at two
  // rather than `devicePixelRatio`: this is a picture of a rounded shape at 40 pixels, and the
  // difference above 2× is not visible where the cost is.
  return (
    <canvas
      ref={canvas}
      className="bot-avatar"
      width={size * 2}
      height={size * 2}
      style={{ width: size, height: size }}
      data-avatar={signature(seed)}
      aria-hidden="true"
    />
  )
}

/** How many cells across the flat mark is. Odd, so the mirrored grid has a spine rather than a seam. */
const GRID = 5
const HALF = Math.ceil(GRID / 2)

/**
 * The flat mark, for a machine that cannot draw the other one.
 *
 * Painted in the same colour the figure would have been, in its three shades, so a bot is at least
 * recognisably *that* bot on a machine with no WebGL — the form is gone, but the colour is half of
 * what tells one from another and it costs nothing to keep.
 */
function FlatAvatar({ seed, size }: { seed: string; size: number }): React.JSX.Element {
  let state = 0x811c9dc5
  for (let at = 0; at < seed.length; at++) {
    state ^= seed.charCodeAt(at)
    state = Math.imul(state, 0x01000193)
  }
  state = state >>> 0 || 1
  const next = (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x100000000
  }

  const cells: { x: number; y: number; opacity: number }[] = []
  for (let x = 0; x < HALF; x++) {
    const spine = x === HALF - 1 && GRID % 2 === 1
    for (let y = 0; y < GRID; y++) {
      if (next() > (spine ? 0.78 : 0.44)) continue
      const opacity = next() < 0.7 ? 1 : 0.5
      cells.push({ x, y, opacity })
      const mirror = GRID - 1 - x
      if (mirror !== x) cells.push({ x: mirror, y, opacity })
    }
  }

  const paints = paintsOf(seed)
  return (
    <svg
      className="bot-avatar"
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      data-avatar={signature(seed)}
      aria-hidden="true"
      focusable="false"
    >
      {cells.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          className="bot-avatar-cell"
          x={cell.x}
          y={cell.y}
          width="1"
          height="1"
          // The spine in the colour itself and the sides in its two other shades, which is the flat
          // echo of a figure painted in one hue and separated by shade.
          fill={cell.x === HALF - 1 ? paints.base : cell.opacity === 1 ? paints.deep : paints.pale}
          // The shade carries the difference now, so the cells are all drawn solid.
          opacity={1}
        />
      ))}
    </svg>
  )
}
