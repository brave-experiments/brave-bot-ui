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
 * there is no renderer this draws the same face flat — the head, the body, the two eyes and their
 * catchlights, in the same shades, from the same seed. It used to be a mirrored grid, which was a
 * mark rather than a face and a different visual language from the figure it stood in for; a bot
 * seen on two machines should look like the same bot, allowing for one of them being a drawing.
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
import { available, show, tell, type Doing } from '../avatar/stage'
import { paintsOf, signature, traitsOf, type Traits } from '../avatar/figure'

export type { Doing }

interface Props {
  /** The bot's stored seed. Anything goes; this only ever hashes it. */
  seed: string
  /** The side of the square, in CSS pixels. */
  size?: number
  /**
   * What the bot is doing, which decides its posture — see `Doing` in `../avatar/stage`. Defaults
   * to looking idly about, which is right for a row in a list that is not the one on screen.
   */
  doing?: Doing
}

export function BotAvatar({ seed, size = 38, doing = 'idle' }: Props): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null)
  // The state at mount goes in with the figure, so a bot that is already working when its row
  // appears takes up the posture rather than blending into it from idle. Changes after that are
  // told to the stage, which blends them. A ref rather than a dependency: a state change must not
  // rebuild the figure, since rebuilding it would restart its turn.
  const current = useRef(doing)
  current.current = doing

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    return show(element, seed, current.current)
  }, [seed])

  useEffect(() => {
    if (canvas.current) tell(canvas.current, doing)
  }, [doing])

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

/** The head's half-widths, by trait, in a 100-unit square. The same proportions as the figure's. */
const HEADS: Record<Traits['head'], { rx: number; ry: number }> = {
  round: { rx: 30, ry: 29 },
  squat: { rx: 33, ry: 25 },
  tall: { rx: 27, ry: 33 },
  boxy: { rx: 32, ry: 27 },
}

/**
 * The flat face, for a machine that cannot draw the other one.
 *
 * The same figure drawn as a picture rather than a model: the head in the colour itself, the body
 * in the deep shade under it, the small pieces in the pale one, two dark eyes low on the face with a
 * catchlight each, and the same drawn edge around everything. Read straight from the traits, so it
 * is recognisably the bot the figure would have been — the same head shape, the same thing on top,
 * the same set of the eyes — rather than a different mark in the same colour.
 */
function FlatAvatar({ seed, size }: { seed: string; size: number }): React.JSX.Element {
  const traits = traitsOf(seed)
  const paints = paintsOf(seed)
  const head = HEADS[traits.head]
  const cx = 50
  const cy = 46
  const top = cy - head.ry
  // The eyes, low and wide-set as on the figure; `big` is bigger rather than further apart.
  const spread = traits.eyes === 'wide' ? 15 : traits.eyes === 'close' ? 10 : 12.5
  const eye = traits.eyes === 'big' ? 6.5 : 5.5
  const edge = { stroke: paints.edge, strokeWidth: 3, strokeLinejoin: 'round' as const }

  return (
    <svg
      className="bot-avatar"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      data-avatar={signature(seed)}
      aria-hidden="true"
      focusable="false"
    >
      {/* The body, first so the head sits over it. Cropped by the chip at the bottom, like the figure. */}
      <rect x={30} y={cy + head.ry - 8} width={40} height={40} rx={12} fill={paints.deep} {...edge} />
      {traits.collar && (
        <rect x={34} y={cy + head.ry - 6} width={32} height={7} rx={3.5} fill={paints.pale} {...edge} />
      )}
      {traits.ears &&
        [-1, 1].map((side) => (
          <ellipse key={side} cx={cx + side * head.rx} cy={cy} rx={5} ry={7} fill={paints.pale} {...edge} />
        ))}
      {/* The head. An ellipse for the three round ones and a rounded rect for the boxy one. */}
      {traits.head === 'boxy' ? (
        <rect x={cx - head.rx} y={top} width={head.rx * 2} height={head.ry * 2} rx={16} fill={paints.base} {...edge} />
      ) : (
        <ellipse cx={cx} cy={cy} rx={head.rx} ry={head.ry} fill={paints.base} {...edge} />
      )}
      {traits.crown === 'bobble' && <ellipse cx={cx} cy={top} rx={9} ry={7.5} fill={paints.pale} {...edge} />}
      {traits.crown === 'antenna' && (
        <>
          <rect x={cx - 1.5} y={top - 9} width={3} height={10} fill={paints.pale} {...edge} />
          <circle cx={cx} cy={top - 10} r={4.5} fill={paints.pale} {...edge} />
        </>
      )}
      {traits.crown === 'tuft' &&
        [-1, 0, 1].map((side) => (
          <circle key={side} cx={cx + side * 8} cy={top + (side === 0 ? -3 : 0)} r={6} fill={paints.pale} {...edge} />
        ))}
      {/* The eyes and their catchlights, up and to the outside on both as on the figure. */}
      {[-1, 1].map((side) => (
        <g key={side}>
          <circle cx={cx + side * spread} cy={cy + 8} r={eye} fill="#20222b" />
          <circle cx={cx + side * spread + eye * 0.34} cy={cy + 8 - eye * 0.36} r={eye * 0.42} fill="#ffffff" />
        </g>
      ))}
    </svg>
  )
}
