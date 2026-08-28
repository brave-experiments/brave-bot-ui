// Launch the app and poke it, so a change can be seen rather than inferred.
// macOS has a real display, so no xvfb: this drives the actual window.
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const shots = '/tmp/bravebot-ui'
mkdirSync(shots, { recursive: true })

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  timeout: 40000,
})

const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')

// Surface renderer errors here rather than letting them vanish into the window.
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()))
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

// The session list is populated by an async round-trip to bravebot-rpc.
await page.waitForTimeout(2500)

const sessions = await page.locator('.session').count()
const columns = await page.locator('.sessions, .transcript, .context').count()
console.log(`columns rendered : ${columns}/3`)
console.log(`sessions listed  : ${sessions}`)

if (sessions > 0) {
  const titles = await page.locator('.session-title').allTextContents()
  const where = await page.locator('.session-where').allTextContents()
  titles.forEach((t, i) => console.log(`  - ${t.slice(0, 54)}  [${where[i]}]`))
}

const build = await page.locator('.build').textContent().catch(() => null)
console.log(`agent build      : ${build ?? '(none shown)'}`)

await page.screenshot({ path: `${shots}/01-launched.png`, fullPage: false })

// The filter box. Driven before anything is opened, and left empty, because every other
// driver clicks `.session` first and expects that to be the newest session.
if (sessions > 0) {
  const box = page.locator('.session-find')
  const first = (await page.locator('.session-title').first().textContent()) ?? ''
  // A word from the newest session's title, long enough not to be in every other one.
  const word = first.split(/\s+/).find((w) => w.length > 4) ?? first.slice(0, 6)
  // Read before anything is filtered: the project is the first field of the secondary line.
  const firstWhere = (await page.locator('.session-where').first().textContent()) ?? ''

  await box.fill(word)
  await page.waitForTimeout(200)
  const byTitle = await page.locator('.session').count()
  const kept = await page.locator('.session-title').first().textContent()
  console.log(`filter "${word}"`.padEnd(17) + `: ${byTitle}/${sessions} rows, first is ${kept === first ? 'the same' : 'DIFFERENT'}`)

  // A project, which no title need contain: the secondary line has to be searchable too, or
  // "which session was that, in bravebot?" has no answer here.
  const project = firstWhere.split(' · ')[0] ?? ''
  await box.fill(project)
  await page.waitForTimeout(200)
  const byProject = await page.locator('.session').count()
  const lines = await page.locator('.session-where').allTextContents()
  const allInIt = lines.every((line) => line.startsWith(project))
  console.log(`filter "${project}"`.padEnd(17) + `: ${byProject}/${sessions} rows, all in that project: ${allInIt}`)

  await box.fill('zzzznothingmatchesthis')
  await page.waitForTimeout(200)
  const none = await page.locator('.session').count()
  const empty = (await page.locator('.empty').textContent().catch(() => '')) ?? ''
  console.log(`filter with junk : ${none} rows, says ${empty.includes('matches') ? '"no match"' : `"${empty.slice(0, 30)}"`}`)
  await page.screenshot({ path: `${shots}/01-filtered.png` })

  // Escape clears it, and the whole list comes back.
  await box.press('Escape')
  await page.waitForTimeout(200)
  const back = await page.locator('.session').count()
  console.log(`after Escape     : ${back}/${sessions} rows${back === sessions ? '' : '  FAIL'}`)
}

// Open the newest session and let the transcript fill.
if (sessions > 0) {
  await page.locator('.session').first().click()
  await page.waitForTimeout(1800)
  const bubbles = await page.locator('.bubble, .tool.replayed').count()
  console.log(`transcript rows  : ${bubbles}`)
  const head = await page.locator('.transcript-head h1').textContent().catch(() => null)
  console.log(`opened           : ${head}`)
  await page.screenshot({ path: `${shots}/02-session.png` })
}

await app.close()
console.log(`screenshots in ${shots}`)
