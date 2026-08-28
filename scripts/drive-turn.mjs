// A live inference request through the app window, which is the thing that was failing.
// Launched from a shell with the credentials explicitly unset, to prove the binary
// carries them rather than inheriting them.
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'

mkdirSync('/tmp/bravebot-ui', { recursive: true })

const app = await electron.launch({ args: ['.'], cwd: process.cwd(), timeout: 40000 })
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))

await page.waitForTimeout(2000)
await page.locator('.session').first().click()
await page.waitForTimeout(1200)

await page.locator('.composer textarea').fill('Reply with exactly the word: baked')
await page.locator('.send').click()
console.log('sent; waiting for the turn…')

// Either an answer, or the screen that says why there cannot be one.
const answered = page.locator('.bubble.assistant').last()
const blocked = page.locator('.unconfigured')
for (let i = 0; i < 60; i++) {
  if (await blocked.isVisible().catch(() => false)) {
    console.log('RESULT: unconfigured screen shown')
    await page.screenshot({ path: '/tmp/bravebot-ui/03-unconfigured.png' })
    await app.close()
    process.exit(1)
  }
  const running = await page.locator('.working').isVisible().catch(() => false)
  if (!running && i > 3) break
  await page.waitForTimeout(1000)
}

const failed = await page.locator('.bubble.failed').count()
if (failed > 0) {
  console.log('RESULT: turn failed ->', await page.locator('.bubble.failed').last().textContent())
} else {
  console.log('RESULT: replied ->', (await answered.textContent())?.slice(0, 120))
}
await page.screenshot({ path: '/tmp/bravebot-ui/03-turn.png' })
await app.close()
