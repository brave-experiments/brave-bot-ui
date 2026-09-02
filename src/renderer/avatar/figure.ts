/**
 * A bot's face, as geometry.
 *
 * The brief was *friendly and approachable*, and almost every decision here follows from taking
 * that literally rather than decoratively:
 *
 * - **Round, and large-headed.** A head about as wide as the body, eyes low and wide-set, nothing
 *   with a point on it. These are the proportions people read as young and harmless — the reason
 *   every friendly robot ever drawn has them — and the reason none of the shapes below is a cone
 *   or a sharp-edged box.
 * - **Two big eyes, and nothing else on the face.** No mouth. A mouth has an expression whether or
 *   not one was intended, and a fixed one is either a grin that never fits what the bot just said
 *   or a line that reads as sullen. Eyes alone are warm and say nothing about mood, which is right
 *   for something that is going to sit beside a failed turn as often as a good one.
 * - **A highlight in each eye.** One small bright dot, placed the same way in both. It is the
 *   difference between eyes that look at you and eyes that are holes.
 * - **It looks slightly up.** The head is tipped back a degree or two. Something looking fractionally
 *   up at the reader is open; something looking down is either sad or judging.
 *
 * ## Colour
 *
 * One colour per bot, from a fixed set, picked by the seed — and the parts told apart by *shade* of
 * it rather than by a second hue. The head is the colour itself, the body is a deeper version, and
 * the small pieces on top are a paler one. So a bot is "the blue one" rather than "the blue and
 * yellow one", which is a thing somebody can hold in their head about eight bots at once.
 *
 * The shades are far enough apart to survive being 38 pixels wide, which is the only real
 * constraint on them: a body one step darker than its head reads as a shadow rather than as a
 * different part, and the figure goes back to being one blob.
 *
 * These were built in the window's accent to begin with, on the argument that every colour in this
 * palette means something and a bot picking a hue would say something it did not mean. That was
 * wrong in practice for a reason the argument could not see: the accent is a warm orange, and a
 * warm orange sphere with two eyes in it is not an abstract mark, it is a *face*, and the whole
 * thing read as skin. A figure this simple is read as a body before it is read as anything else, so
 * the colour has to say "this is a painted object" loudly enough to stop that — which is what a
 * saturated blue head with a yellow body does and no shade of orange can.
 *
 * So the set below is primaries and near-primaries: the colours of moulded plastic toys, chosen to
 * be told apart at a glance and to be nobody's complexion. There is no orange in it, and no brown,
 * for exactly that reason — and a single hue makes that stricter rather than looser, since there is
 * no second colour to carry the "this is painted" signal if the first one fails to.
 *
 * The cost, stated plainly: these no longer follow a theme. A palette somebody writes repaints the
 * window and leaves the bots as they are. That is the right trade for a face — a face that changed
 * colour with the furniture would be a worse identity than one that does not — but it is a trade
 * rather than a free win.
 *
 * ## What else differs between bots
 *
 * The *form*: the shape of the head, what is on top of it, whether it has ears, the set of the
 * eyes, and the body under it. Six choices from small sets, times the colour, which is far more
 * combinations than anybody will have bots and — more to the point — combinations that are told
 * apart at a glance.
 *
 * Everything is a function of the seed, so a bot has one face for its whole life, and the same face
 * in every window.
 */

import * as THREE from 'three'

export interface Figure {
  root: THREE.Group
  /** The eyes, together, so a blink can squash both at once. */
  eyes: THREE.Group
  dispose: () => void
}

/** A stream of numbers from a seed. xorshift32 over an FNV-1a hash — see `stage.ts` for the same. */
function stream(seed: string): () => number {
  let state = 0x811c9dc5
  for (let at = 0; at < seed.length; at++) {
    state ^= seed.charCodeAt(at)
    state = Math.imul(state, 0x01000193)
  }
  state = state >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x100000000
  }
}

/**
 * The colours a bot can be painted in.
 *
 * Primaries and near-primaries — the colours of moulded plastic rather than of anything alive. No
 * orange and no brown: those are the two that turn a rounded head with eyes into a face, which is
 * the thing these are deliberately not.
 *
 * Muted rather than pure. Each is its primary at roughly two thirds of full saturation, pulled a
 * little toward mid lightness — the difference between a poster and a painted wooden toy. Fully
 * saturated versions were the first thing tried and they shouted: eight of them down a column, each
 * one small and each one at maximum chroma, is a lot of noise beside a list of quiet grey text, and
 * the avatar started competing with the name it belongs to. What is kept is the *hue*, which is the
 * part doing the identifying — a bot is still recognisably the blue one or the green one.
 *
 * `yellow` and `lime` are the pair that needs watching. Muting moves everything toward grey, and
 * two hues 40° apart both heading for the same grey converge — so `lime` is pushed greener and
 * darker than a straight muting would give it, to keep the two apart at 38 pixels.
 *
 * Named, because the name is what a test reads: `data-avatar` says `blue-round-…`, and a driver
 * asserting that two bots differ should be able to say how.
 */
const PAINT: { name: string; hex: string }[] = [
  { name: 'red', hex: '#c26058' },
  { name: 'blue', hex: '#5a80c0' },
  { name: 'yellow', hex: '#d4b45c' },
  { name: 'green', hex: '#57a06d' },
  { name: 'violet', hex: '#8a6fc4' },
  { name: 'cyan', hex: '#4aa7b5' },
  { name: 'pink', hex: '#c66a99' },
  { name: 'lime', hex: '#8fae55' },
]

/** The traits a seed picks. Named, because they are also what the window reports for a driver. */
export interface Traits {
  head: 'round' | 'squat' | 'tall' | 'boxy'
  crown: 'none' | 'antenna' | 'bobble' | 'tuft'
  ears: boolean
  eyes: 'wide' | 'close' | 'big'
  body: 'dome' | 'barrel' | 'pill'
  collar: boolean
  /** The one colour the whole figure is painted in, by name. Its parts differ by shade. */
  paint: string
}

const HEADS: Traits['head'][] = ['round', 'squat', 'tall', 'boxy']
const CROWNS: Traits['crown'][] = ['none', 'antenna', 'bobble', 'tuft']
const EYES: Traits['eyes'][] = ['wide', 'close', 'big']
const BODIES: Traits['body'][] = ['dome', 'barrel', 'pill']

/** Which figure a seed describes. Exported so the window can say, without drawing anything. */
export function traitsOf(seed: string): Traits {
  const next = stream(seed)
  const pick = <T,>(from: T[]): T => from[Math.floor(next() * from.length)] as T
  const head = pick(HEADS)
  const crown = pick(CROWNS)
  const ears = next() < 0.45
  const eyes = pick(EYES)
  const body = pick(BODIES)
  const collar = next() < 0.5
  const paint = pick(PAINT)
  return { head, crown, ears, eyes, body, collar, paint: paint.name }
}

/** A short stable string naming the figure, for a test that must not compare pixels. */
export function signature(seed: string): string {
  const t = traitsOf(seed)
  return [
    t.paint,
    t.head,
    t.crown,
    t.ears ? 'ears' : 'plain',
    t.eyes,
    t.body,
    t.collar ? 'collar' : 'bare',
  ].join('-')
}

/** A named paint, or the first one if the name is not one this build has. */
function paintOf(name: string): THREE.Color {
  const found = PAINT.find((paint) => paint.name === name) ?? PAINT[0]
  return new THREE.Color(found!.hex)
}

/**
 * The three shades a figure is painted in.
 *
 * Deep is a straight darkening; pale is mixed toward white rather than lightened, which keeps a
 * saturated colour from simply clipping to its own hue at full brightness and staying the same
 * shade. The gaps are wide on purpose — see the note about 38 pixels above.
 */
function shades(name: string): { base: THREE.Color; deep: THREE.Color; pale: THREE.Color } {
  const base = paintOf(name)
  return {
    base,
    deep: base.clone().multiplyScalar(0.58),
    pale: base.clone().lerp(new THREE.Color('#ffffff'), 0.42),
  }
}

/** The three shades a seed paints a bot in, as hex, for anything that is not three.js. */
export function paintsOf(seed: string): { base: string; deep: string; pale: string } {
  const { base, deep, pale } = shades(traitsOf(seed).paint)
  const hex = (colour: THREE.Color): string => `#${colour.getHexString()}`
  return { base: hex(base), deep: hex(deep), pale: hex(pale) }
}

/**
 * The materials a figure is made of.
 *
 * Lambert rather than a physical material: these are 40 pixels across and lit by hand, so roughness
 * and metalness are cost with nothing to show for it, and a matte surface is friendlier than a
 * shiny one — a gloss highlight reads as hard plastic or metal, and these are meant to read as
 * painted wood.
 */
function palette(traits: Traits): {
  shell: THREE.Material
  trim: THREE.Material
  bright: THREE.Material
  spark: THREE.Material
  glint: THREE.Material
} {
  const { base, deep, pale } = shades(traits.paint)
  // A little of the colour emitted as well as reflected, so the hue stays itself where the light
  // falls away. Without it a saturated blue goes to near-black on its shadowed side and the figure
  // reads as two different objects rather than as one painted one — which matters more now that
  // being one object in one colour is the whole idea.
  const glow = (colour: THREE.Color): THREE.Color => colour.clone().multiplyScalar(0.16)
  return {
    // The head: the colour itself, which is what somebody will remember the bot as.
    shell: new THREE.MeshLambertMaterial({ color: base, emissive: glow(base) }),
    // The body, deeper — it sits below and behind, so a darker shade is also what the light would
    // have done to it, and the figure reads as lit rather than as two-tone.
    trim: new THREE.MeshLambertMaterial({ color: deep, emissive: glow(deep) }),
    // The small pieces — an ear, a bobble, a collar — in the palest shade. Anything nearer the
    // body's own would vanish into it at this size, which is the one failure mode of a
    // single-colour figure.
    bright: new THREE.MeshLambertMaterial({ color: pale, emissive: glow(pale) }),
    // The eyes, and the one thing that is not painted: a very dark neutral, so they read as eyes
    // against any of the colours above. Basic, so they stay flat and dark wherever the light falls
    // — a lit sphere here would catch the key light and go grey.
    spark: new THREE.MeshBasicMaterial({ color: '#20222b' }),
    // The catchlight in each eye. White rather than a tint of the paint, and unlit like the eye it
    // sits in: it is standing in for a reflection of the room, which is not the colour of the bot.
    glint: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
  }
}

/** The head, by trait. Spheres scaled rather than four different geometries. */
function headMesh(traits: Traits, material: THREE.Material): THREE.Mesh {
  if (traits.head === 'boxy') {
    // The one flat-sided head, and still round: a box with a radius on every edge. A hard cube
    // among the spheres would be the one unfriendly face in the set.
    const geometry = new THREE.SphereGeometry(1, 24, 20)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.set(1.02, 0.94, 0.9)
    // Flattening the sphere's sides towards a rounded box, by hand, so there is still no seam.
    // `position` is optional on the attribute map's type; a sphere always has one, and a head
    // drawn as a plain sphere is a fine head, so the absence is skipped rather than asserted.
    const position = geometry.attributes.position as THREE.BufferAttribute | undefined
    if (!position) return mesh
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i)
      const y = position.getY(i)
      const z = position.getZ(i)
      const soften = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 0.62)
      position.setXYZ(i, soften(x), soften(y), soften(z))
    }
    geometry.computeVertexNormals()
    return mesh
  }

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 22), material)
  if (traits.head === 'squat') mesh.scale.set(1.12, 0.86, 1)
  else if (traits.head === 'tall') mesh.scale.set(0.9, 1.12, 0.94)
  else mesh.scale.set(1, 0.98, 0.98)
  return mesh
}

/** The body, by trait. Under the head and mostly hidden by it, so it is a silhouette job. */
function bodyMesh(traits: Traits, material: THREE.Material): THREE.Mesh {
  if (traits.body === 'barrel') {
    return new THREE.Mesh(new THREE.CylinderGeometry(0.74, 0.86, 1.0, 24, 1, false), material)
  }
  if (traits.body === 'pill') {
    return new THREE.Mesh(new THREE.CapsuleGeometry(0.66, 0.5, 8, 20), material)
  }
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.92, 24, 18), material)
  mesh.scale.set(1, 0.78, 0.94)
  return mesh
}

export function buildFigure(seed: string): Figure {
  const traits = traitsOf(seed)
  const materials = palette(traits)
  const owned: (THREE.BufferGeometry | THREE.Material)[] = Object.values(materials)

  const root = new THREE.Group()
  const keep = <T extends THREE.Mesh>(mesh: T): T => {
    owned.push(mesh.geometry)
    return mesh
  }

  // --- body -------------------------------------------------------------------------------
  const body = keep(bodyMesh(traits, materials.trim))
  body.position.y = -1.35
  root.add(body)

  if (traits.collar) {
    const collar = keep(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.1, 10, 26), materials.bright))
    collar.rotation.x = Math.PI / 2
    collar.position.y = -0.92
    root.add(collar)
  }

  // --- head -------------------------------------------------------------------------------
  // Its own group, tipped back a little, so everything on it tips with it — see the note above
  // about looking fractionally up.
  const head = new THREE.Group()
  head.position.y = 0.12
  head.rotation.x = -0.07
  root.add(head)
  head.add(keep(headMesh(traits, materials.shell)))

  if (traits.ears) {
    for (const side of [-1, 1]) {
      const ear = keep(new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), materials.bright))
      ear.position.set(side * 1.0, -0.05, 0)
      ear.scale.set(0.6, 1, 0.85)
      head.add(ear)
    }
  }

  if (traits.crown === 'antenna') {
    // Short. A tall one is the tallest thing in the set and would decide how far back the camera
    // has to sit for every other figure — one bot's aerial costing every other bot's face the
    // room it needed.
    const stalk = keep(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 8), materials.trim))
    stalk.position.y = 1.06
    head.add(stalk)
    const tip = keep(new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 12), materials.bright))
    tip.position.y = 1.28
    head.add(tip)
  } else if (traits.crown === 'bobble') {
    const bobble = keep(new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 14), materials.bright))
    bobble.position.y = 1.1
    bobble.scale.set(1, 0.82, 1)
    head.add(bobble)
  } else if (traits.crown === 'tuft') {
    // Three small spheres in a row, which at this size reads as a tuft of hair rather than as
    // three spheres — and is the friendliest thing on offer to put on top of a head.
    for (const [index, side] of [-1, 0, 1].entries()) {
      const puff = keep(new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), materials.bright))
      puff.position.set(side * 0.26, 1.0 + (index === 1 ? 0.12 : 0), 0)
      head.add(puff)
    }
  }

  // --- eyes -------------------------------------------------------------------------------
  // Low on the face, which is the single strongest cue for "young, and therefore harmless". Eyes
  // set at the middle of a head read as an adult; set below it, as a child.
  const spread = traits.eyes === 'wide' ? 0.44 : traits.eyes === 'close' ? 0.29 : 0.37
  const size = traits.eyes === 'big' ? 0.23 : 0.18

  const eyes = new THREE.Group()
  eyes.position.set(0, -0.12, 0)
  head.add(eyes)

  for (const side of [-1, 1]) {
    const socket = new THREE.Group()
    socket.position.set(side * spread, 0, 0.86)
    eyes.add(socket)

    const eye = keep(new THREE.Mesh(new THREE.SphereGeometry(size, 18, 14), materials.spark))
    eye.scale.z = 0.55
    socket.add(eye)

    // The highlight, up and toward the outside on both — the same place on each, because two
    // highlights in different places make a face look cross-eyed.
    const glint = keep(new THREE.Mesh(new THREE.SphereGeometry(size * 0.34, 10, 8), materials.glint))
    glint.position.set(size * 0.34, size * 0.36, size * 0.4)
    socket.add(glint)
  }

  // No scaling or nudging here: the camera above decides the crop, and a figure that also moved
  // itself would mean two places deciding the same thing and neither of them alone.


  return {
    root,
    eyes,
    dispose: () => {
      for (const thing of owned) thing.dispose()
    },
  }
}
