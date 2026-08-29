// A whole piece of work, live, through the window: a prompt that writes a library, a page
// that uses it, and a screenshot of it running — approved from the interface at every step.
//
// Nothing here is faked. It drives a real model against a real checkout and answers every
// one of the five questions the agent can ask, saying yes to each, because the point is to
// follow one long turn end to end rather than to test a single card in isolation.
//
// Needs credentials baked into bravebot-rpc (`npm run bridge` in a configured shell).
import { _electron as electron } from 'playwright-core'
import { mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const shots = '/tmp/bravebot-ui/astar'
mkdirSync(shots, { recursive: true })

// A checkout of its own. The turn writes files, and pointing it at this repository would
// mix the agent's output into the tree the driver was started from.
const project = process.env.ASTAR_DIR ?? '/tmp/bravebot-astar'
mkdirSync(project, { recursive: true })
if (!existsSync(`${project}/.git`)) execFileSync('git', ['init', '-q', project])

const PROMPT =
  'Build out a typescript implementation of an a star pathfinding library. ' +
  'Use this library in a sample threejs page to show the results. ' +
  'Load the page containing the sample and screenshot the operations of the pathfinding operation.'

// What a resumed run says instead. The same last sentence of the work, so the turn it
// drives is the part that was left unfinished rather than the whole build again.
const FOLLOW_UP =
  process.env.ASTAR_FOLLOW_UP ??
  'Carry on: serve the sample page, load it, and screenshot the pathfinding running. ' +
    'Start any server so that the command returns instead of holding the terminal, and ' +
    'save the screenshot into this directory.'

// How long to keep answering before giving up on the turn. A build like this is minutes,
// not seconds, and a driver that timed out at 120s would report a failure about itself.
const BUDGET_MS = Number(process.env.ASTAR_BUDGET_MS ?? 30 * 60 * 1000)

const problems = []
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`)
  if (!ok) problems.push(what)
}
const note = (what) => console.log(`  --   ${what}`)

let shot = 0
const capture = async (page, what) =>
  page.screenshot({ path: `${shots}/${String(++shot).padStart(2, '0')}-${what}.png` })

const app = await electron.launch({ args: ['.'], cwd: process.cwd(), timeout: 60000 })

// The folder picker is native, so Playwright cannot reach it. Answered in the main process
// instead, which leaves the renderer's path exactly as it is: the button is clicked, the
// picker is asked, and a directory comes back — the same sequence a hand would produce.
await app.evaluate(({ dialog }, directory) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
}, project)

const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()))
await page.waitForTimeout(2500)
await capture(page, 'launched')

// --- a session in a checkout of its own -------------------------------------------------
// Or the one already there. A turn this long is worth continuing rather than starting over:
// `ASTAR_RESUME` opens the newest session in the project and sends the follow-up instead,
// which is the same path a person takes the morning after.
const resume = process.env.ASTAR_RESUME === '1'
if (resume) {
  const row = page
    .locator('.session')
    .filter({ has: page.locator('.session-where', { hasText: project.split('/').pop() }) })
    .first()
  const found = await row.isVisible().catch(() => false)
  check(found, `the project's session is in the list (${project})`)
  if (!found) {
    await app.close()
    process.exit(1)
  }
  await row.click()
  await page.waitForTimeout(2500)
  // A session whose record kept no trust map asks again on open.
  if (await page.locator('.trust').isVisible().catch(() => false)) {
    await page.locator('.trust-actions .approve').click()
    await page.waitForTimeout(800)
  }
  check(
    (await page.locator('.bubble, .tool').count()) > 0,
    'the earlier turn is replayed into the transcript',
  )
  await capture(page, 'resumed')
} else {
await page.locator('.new').click()
await page.waitForTimeout(1500)
const asked = (await page.locator('.trust .path').textContent().catch(() => null)) ?? ''
check(asked === project, `a new session asks about the chosen directory (${asked || 'nothing'})`)
await capture(page, 'trust-asked')
await page.locator('.trust-actions .approve').click()
await page.waitForTimeout(800)
check(
  !(await page.locator('.trust').isVisible().catch(() => false)),
  'trusting the directory clears the question',
)
}

// --- the prompt --------------------------------------------------------------------------
// A dry run opens the session and reports what the window shows, without spending a turn.
// The one thing worth checking on an already-finished session is that it is *there*: a
// session begun in this window has to be one the store kept.
if (process.env.ASTAR_INSPECT === '1') {
  const rows = await page.locator('.context .files li').allTextContents()
  console.log(`context lists ${rows.length} row(s):`)
  rows.forEach((row) => console.log(`    ${row.replace(/\s+/g, ' ').trim()}`))
  await capture(page, 'inspected')
  await app.close()
  process.exit(0)
}

await page.locator('.composer textarea').fill(resume ? FOLLOW_UP : PROMPT)
await capture(page, 'prompt-typed')
await page.locator('.send').click()
console.log(`\nsent. answering questions for up to ${Math.round(BUDGET_MS / 60000)} minutes…\n`)

// --- answer everything, in the order it is put ------------------------------------------
// One undecided card at a time is all the protocol allows, so this is a poll rather than a
// race: find whichever of the five is standing, answer yes to it, and go round again.
const seen = { confirm: 0, run: 0, output: 0, ask: 0, vouch: 0 }
const standing = () => page.locator('.confirm').filter({ has: page.locator('.confirm-actions') })

const started = Date.now()
let finished = false
let turns = 0
let blockedChecked = false

// Not "the composer came back": drafting is allowed *while* a question stands, so an
// enabled textarea means either the turn ended or somebody is being asked something. What
// says the turn is over is the working line going away with nothing left outstanding.
const over = async () =>
  (await page.locator('.working').count()) === 0 && (await standing().count()) === 0

while (Date.now() - started < BUDGET_MS) {
  if (await over()) {
    // Settle before believing it: a card is mounted a frame or two after the working line
    // goes, and the gap between two tool calls looks the same as an ending.
    await page.waitForTimeout(2500)
    if (await over()) {
      finished = true
      break
    }
  }
  const card = standing().last()
  if (!(await card.isVisible().catch(() => false))) {
    await page.waitForTimeout(1000)
    continue
  }

  const kind = await card.evaluate((el) =>
    ['run', 'output', 'ask', 'vouch'].find((k) => el.classList.contains(k)) ?? 'confirm',
  )
  // The head names the kind and the directory; for a command the argv is the interesting
  // half, and a log of eight identical `run /private/tmp/…` lines says nothing about what
  // was approved.
  const head = (
    kind === 'run'
      ? ((await card.locator('.stages .argv').first().textContent().catch(() => '')) ?? '')
      : ((await card.locator('.confirm-head').textContent().catch(() => '')) ?? '')
  )
    .replace(/\s+/g, ' ')
    .trim()
  seen[kind] += 1
  turns += 1
  console.log(`  ${String(turns).padStart(3)}  ${kind.padEnd(7)} ${head.slice(0, 96)}`)

  // Only the first of each kind is worth a picture; a hundred write cards are a hundred
  // copies of the same screenshot.
  if (seen[kind] === 1) await capture(page, `asked-${kind}`)

  // Once, on the first question of the run: a prompt cannot be sent past a decision
  // nobody has made, and the composer says which of the five is waiting.
  if (!blockedChecked) {
    blockedChecked = true
    check(await page.locator('.composer .send').isDisabled(), 'nothing can be sent while a question stands')
    const placeholder = (await page.locator('.composer textarea').getAttribute('placeholder')) ?? ''
    check(placeholder.includes('above first'), `and says which question is waiting (${placeholder})`)
  }

  if (kind === 'ask') {
    // Yes to a series means answering it rather than declining: take the first choice of
    // each question that offers any, and leave the rest to the agent's own default.
    for (const question of await card.locator('.ask-question').all()) {
      const first = question.locator('.choice').first()
      if (await first.isVisible().catch(() => false)) await first.click()
    }
  }
  // "Run once" rather than the vouch: the point is to watch each decision land, and a
  // standing rule would answer questions this run never puts on screen.
  const yes = kind === 'run' ? card.locator('.confirm-actions .approve:not(.always)') : card.locator('.confirm-actions .approve')
  await yes.click({ timeout: 15000 }).catch((e) => console.log(`  !!   could not answer: ${e.message}`))
  await page.waitForTimeout(700)
}

console.log('')
check(finished, `the turn ran to completion (${Math.round((Date.now() - started) / 1000)}s)`)
console.log(
  `questions answered: ${Object.entries(seen).map(([k, n]) => `${k} ${n}`).join(', ')}`,
)

// --- what the window has to show for it -------------------------------------------------
await page.waitForTimeout(1500)
await capture(page, 'turn-done')

const verbs = await page.locator('.tool .verb').allTextContents()
check(verbs.length > 0, `the transcript reports the calls by verb (${[...new Set(verbs)].join(', ')})`)
const bubbles = await page.locator('.bubble').count()
const replies = await page.locator('.bubble.assistant').count()
check(replies > 0, `the reply is in the transcript (${bubbles} bubbles, ${replies} from the agent)`)

// The context column is the other half of the claim: what the session touched should be
// the files the turn actually wrote.
// A live session's panel names paths; a reopened one names the calls the record kept,
// which is a different list under a different heading. This is the live case.
const touched = await page.locator('.context .files li:not(.from-record) code').allTextContents()
check(touched.length > 0, `the context panel names what the session touched (${touched.length} paths)`)
touched.slice(0, 20).forEach((path) => console.log(`    ${path}`))
await capture(page, 'context')

// And the checkout itself, which is the claim no screenshot can make.
const wrote = execFileSync('git', ['-C', project, 'status', '--short'], { encoding: 'utf8' }).trim()
console.log(`\nthe checkout now holds:\n${wrote || '  (nothing)'}`)
check(wrote.length > 0, 'files were actually written into the checkout')

await app.close()
console.log(`\nscreenshots in ${shots}`)
console.log(problems.length ? `RESULT: ${problems.length} failed` : 'RESULT: ok')
process.exit(problems.length ? 1 : 0)
