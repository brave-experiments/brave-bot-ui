/**
 * One WebGL context, however many avatars are on screen.
 *
 * This is the whole reason there is a module here rather than a `<canvas>` inside the component.
 * A browser will not give a page an unbounded number of WebGL contexts — Chromium's limit is
 * around sixteen, and past it the *oldest* context is thrown away, so a list of twenty bots would
 * not fail loudly, it would silently blank the ones at the top. A column is exactly the case where
 * that happens.
 *
 * So there is one renderer, drawing into one small offscreen canvas, and every avatar is a plain
 * 2D canvas that gets the result copied into it with `drawImage`. The renderer paints each figure
 * in turn, once per frame, and the copy costs a few thousand pixels. Anything else — a context per
 * avatar, or a texture atlas, or one big canvas positioned behind the list — is either fragile or
 * more machinery than a list of small pictures deserves.
 *
 * ## Consistency
 *
 * The motion is a function of the clock, not of how many frames have been drawn. Everything below
 * takes the elapsed time in seconds and computes a pose from it, so a figure turns at the same
 * rate on a busy machine as on an idle one, a dropped frame is skipped rather than accumulated,
 * and two avatars mounted a minute apart are at the same point in the turn. Each figure's own
 * offset into that cycle comes from its seed, which is what keeps a column of them from moving as
 * one block.
 *
 * The loop stops when nothing is registered and when the window is hidden. An idle app should not
 * hold the GPU awake to rotate a picture nobody is looking at.
 */

import * as THREE from 'three'
import { buildFigure, type Figure } from './figure'

/**
 * How wide the shared canvas is, in device pixels.
 *
 * One size for every avatar, scaled down into whichever canvas asked for it. Fixed rather than the
 * largest requested, because a renderer resized between two draws in the same frame resizes twice
 * a frame, and the difference between 18px and 40px is not worth that.
 */
const SIZE = 128

/** How long one full turn takes, in seconds. Slow enough to read as breathing, not as spinning. */
const TURN = 24

/** One avatar waiting to be drawn. */
interface Registered {
  canvas: HTMLCanvasElement
  figure: Figure
  /** Where in the cycle this one sits, so a column does not move in lockstep. */
  phase: number
}

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let frame: number | null = null
/** Set once WebGL has been asked for and refused, so it is not asked again every mount. */
let refused = false

const registered = new Map<HTMLCanvasElement, Registered>()

/**
 * The renderer, or `null` where there is no WebGL to be had.
 *
 * Software rendering, a driver that will not start, a machine with the GPU process disabled: all
 * of them arrive as a throw from the constructor rather than as a flag to check. Answering `null`
 * lets the component fall back to something flat instead of failing to draw at all.
 */
function stage(): { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null {
  if (refused) return null
  if (renderer && scene && camera) return { renderer, scene, camera }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setSize(SIZE, SIZE, false)
    // The figures are lit by hand and their colours are chosen against the window's own palette,
    // so no tone mapping and no colour management: what the materials say is what is drawn, which
    // is what lets an avatar sit in a themed row without drifting away from it.
    renderer.setClearAlpha(0)
  } catch {
    refused = true
    renderer = null
    return null
  }

  scene = new THREE.Scene()

  // Framed as a portrait, not as a full-length picture. At thirty-odd pixels a whole figure is a
  // speck in a lot of air — the head has to fill most of the square or there is nothing to
  // recognise. So the camera sits close, centred on the face, with the body running out of the
  // bottom of the frame the way a headshot crops at the shoulders. What is left in view is the
  // head, whatever is on top of it, and enough of the body to say there is one.
  //
  // Slightly above and looking a little down, which is the angle a face is friendliest from: it
  // shows the roundness of the head where straight-on flattens it, and it keeps both eyes.
  camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100)
  camera.position.set(0, 0.5, 6.1)
  camera.lookAt(0, 0.22, 0)

  // Soft and frontal. A hard key light gives a face a hollow, dramatic look — which is the exact
  // opposite of approachable — so the strong light is broad and almost head-on, the fill is
  // generous, and there is a cool rim behind to lift the silhouette off the column.
  //
  // Weighted heavily toward the ambient, which is not how one would light a photograph and is
  // exactly right here. Lambert adds every light into the surface colour, so a strong key on a
  // saturated colour clips one channel long before the other two and the hue drains out — the
  // figure goes pale and stops being the colour the window is in. A large flat term with a modest
  // key keeps the surface at the accent proper and spends the directional light only on saying
  // which way the head is turned. Closer to how a cartoon is painted than to how a room is lit,
  // and a cartoon is what this is.
  //
  // The numbers are measured rather than chosen. With these, a surface facing the camera renders at
  // its material colour *exactly* — sample a pixel off an avatar and it is the hex from the paint
  // set in `figure.ts`. That is the only defensible place to put them: anything less and every bot
  // is a muddied version of the colour it was painted, anything more and the saturated ones clip
  // and go pale. They are not intuitive, because the path from an intensity to a pixel runs through
  // three's colour management and Lambert's own scaling, so guessing lands nowhere near — if the
  // lighting is ever changed, check it by sampling a pixel rather than by eye.
  scene.add(new THREE.AmbientLight(0xffffff, 1.9))
  const key = new THREE.DirectionalLight(0xffffff, 0.78)
  key.position.set(2.2, 3.4, 5)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xffffff, 0.22)
  fill.position.set(-3.4, -0.6, 2.6)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffffff, 0.3)
  rim.position.set(-1.4, 2.2, -4)
  scene.add(rim)

  return { renderer, scene, camera }
}

/**
 * Where a figure is at this moment.
 *
 * A slow turn that eases to a stop at each side rather than sweeping past, a small bob, and a tilt
 * that follows the turn — a head that leans slightly into the direction it is looking, the way a
 * person does when curious. Composed of sines of one clock so it never lands anywhere abrupt and
 * never needs a state machine.
 */
function pose(figure: Figure, seconds: number): void {
  const t = seconds
  // `sin` rather than a running angle: a figure that turned all the way round would spend half the
  // time facing away, which is a picture of a bot's back.
  figure.root.rotation.y = Math.sin(t * ((Math.PI * 2) / TURN)) * 0.55
  figure.root.rotation.z = Math.sin(t * ((Math.PI * 2) / TURN)) * 0.06
  figure.root.position.y = Math.sin(t * 0.9) * 0.045

  // The blink. Rare, quick, and the one thing here that is not a smooth curve — which is what makes
  // it read as alive rather than as a wobble. A period that is not a whole number of anything else
  // keeps it from ever syncing up with the turn.
  const blink = t % 5.3
  figure.eyes.scale.y = blink < 0.13 ? Math.max(0.08, Math.abs(blink - 0.065) / 0.065) : 1
}

function draw(): void {
  frame = null
  const built = stage()
  if (!built || registered.size === 0) return

  const seconds = performance.now() / 1000
  for (const entry of registered.values()) {
    // One figure in the scene at a time. Adding all of them and moving the camera would mean every
    // draw paying for every other bot's geometry.
    built.scene.add(entry.figure.root)
    pose(entry.figure, seconds + entry.phase)
    built.renderer.render(built.scene, built.camera)
    built.scene.remove(entry.figure.root)

    const context = entry.canvas.getContext('2d')
    if (!context) continue
    context.clearRect(0, 0, entry.canvas.width, entry.canvas.height)
    context.drawImage(built.renderer.domElement, 0, 0, entry.canvas.width, entry.canvas.height)
  }

  schedule()
}

function schedule(): void {
  if (frame !== null || registered.size === 0) return
  // Not while the window is hidden: `requestAnimationFrame` is already throttled there, but the
  // intent is worth stating — nothing about this is worth waking a machine for.
  if (typeof document !== 'undefined' && document.hidden) return
  frame = requestAnimationFrame(draw)
}

/**
 * Put an avatar on screen, and answer how to take it off again.
 *
 * The figure is built once per canvas rather than per frame. Building one is a few dozen small
 * geometries, which is nothing to do once and wasteful to do sixty times a second.
 */
export function show(canvas: HTMLCanvasElement, seed: string): () => void {
  if (!stage()) return () => undefined

  const figure = buildFigure(seed)
  registered.set(canvas, {
    canvas,
    figure,
    // Spread over the whole cycle from the seed, so a column of bots is a group of individuals
    // rather than a chorus line. Deterministic, like everything else drawn from a seed.
    phase: hashPhase(seed) * TURN,
  })
  schedule()

  return () => {
    registered.delete(canvas)
    figure.dispose()
  }
}

/** A number in `[0, 1)` from a seed, for the phase offset. */
function hashPhase(seed: string): number {
  let value = 0x811c9dc5
  for (let at = 0; at < seed.length; at++) {
    value ^= seed.charCodeAt(at)
    value = Math.imul(value, 0x01000193)
  }
  return (value >>> 0) / 0x100000000
}

/** Whether anything can be drawn at all, for the component's fallback. */
export function available(): boolean {
  return stage() !== null
}

if (typeof document !== 'undefined') {
  // A window that comes back from being hidden has a stopped loop, because `schedule` refused to
  // start one. Nothing else restarts it, so this does.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) schedule()
  })
}
