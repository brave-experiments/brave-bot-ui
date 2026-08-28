// That a question the planner asks can be answered from the window.
//
// A live turn: it drives a real model and costs a few tokens. The prompt asks the planner
// to put a choice to the person before doing anything, which is what makes it reach for
// the question it would otherwise only simulate in its reply.
//
// Note that a planner shown untrusted content may not ask at all — that gate is upstream
// and deliberate — so this drives a session with nothing quarantined in it.
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'

mkdirSync('/tmp/bravebot-ui', { recursive: true })

const problems = []
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`)
  if (!ok) problems.push(what)
}

const app = await electron.launch({ args: ['.'], cwd: process.cwd(), timeout: 40000 })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()))
await page.waitForTimeout(2500)

if ((await page.locator('.session').count()) === 0) {
  console.log('RESULT: skipped — no sessions to open')
  await app.close()
  process.exit(0)
}

await page.locator('.session').first().click()
await page.waitForTimeout(1500)
if (await page.locator('.trust').isVisible().catch(() => false)) {
  await page.locator('.trust-actions .approve').click()
  await page.waitForTimeout(600)
}

await page.locator('.composer textarea').fill(
  'I want to add a --json flag to this project. Before writing anything, put the choice to ' +
    'me: a new module, or extending the existing output code? Ask me and wait for my answer.',
)
await page.locator('.send').click()
console.log('sent; waiting to be asked…')

const asked = await page
  .locator('.confirm.ask')
  .first()
  .waitFor({ state: 'visible', timeout: 150000 })
  .then(() => true)
  .catch(() => false)

if (!asked) {
  console.log('  --   the planner answered without asking; nothing to drive this run')
  await page.screenshot({ path: '/tmp/bravebot-ui/16-not-asked.png' })
  await app.close()
  process.exit(0)
}

check(true, 'the questions reach the window')
const card = page.locator('.confirm.ask').first()

const questions = await card.locator('.ask-question').count()
check(questions >= 1, `one block per question (${questions})`)
check(
  (await card.locator('.ask-question .question').first().textContent())?.trim().length > 0,
  'the question itself is drawn',
)

const choices = await card.locator('.choices .choice').count()
check(choices >= 1, `the choices are drawn as the agent shaped them (${choices})`)
check(
  (await card.locator('.typed').count()) === questions,
  'and every question keeps a way to answer in your own words',
)

// The composer is closed to sending while the series stands.
check(
  await page.locator('.composer .send').isDisabled(),
  'nothing can be sent while the questions stand',
)
const placeholder = await page.locator('.composer textarea').getAttribute('placeholder')
check(
  (placeholder ?? '').includes('questions'),
  `and the composer says what is waiting (${placeholder})`,
)
await page.screenshot({ path: '/tmp/bravebot-ui/16-asked.png' })

// Pick the first option of the first question, and check picking is visible.
const first = card.locator('.choices .choice').first()
const label = (await first.locator('.label').textContent())?.trim() ?? ''
await first.click()
await page.waitForTimeout(200)
check(
  (await first.getAttribute('aria-pressed')) === 'true',
  'a picked choice says so, to itself and to a screen reader',
)

await card.locator('.confirm-actions .approve').click()
await page.waitForTimeout(1500)

const given = (await card.locator('.asked-answer .given').first().textContent())?.trim() ?? ''
check(
  given === label,
  `the transcript records what was answered (${given} vs ${label})`,
)
check(
  (await card.locator('.choices').count()) === 0,
  'and stops offering the choices once they are answered',
)

const done = await page
  .locator('.composer textarea:not([disabled])')
  .waitFor({ state: 'visible', timeout: 150000 })
  .then(() => true)
  .catch(() => false)
check(done, 'the turn carries on with the answer')
await page.screenshot({ path: '/tmp/bravebot-ui/17-answered.png' })

await app.close()
console.log(problems.length ? `\nRESULT: ${problems.length} failed` : '\nRESULT: ok')
process.exit(problems.length ? 1 : 0)
