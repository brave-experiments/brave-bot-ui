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
