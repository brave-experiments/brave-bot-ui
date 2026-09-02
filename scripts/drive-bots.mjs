// That a bot is a thing you can make, find again, and tell apart from the bot beside it.
//
// Four claims, and the third and fourth are the ones worth a driver rather than a unit test:
//
//  1. The column has two lists and remembers which was on screen.
//  2. A bot made in the window is still there after a relaunch, with what was typed into it.
//  3. Two bots do not have the same face. The pattern is generated, so "they differ" is a claim
//     about the generator that nothing but running it can make.
//  4. A bot's face is the *same* face after a relaunch and after a rename. That is the whole
//     reason the seed is stored rather than derived from the name, and it is exactly the sort of
//     thing that works until somebody simplifies it into `hash(bot.name)` a year from now.
//
// What is not here: sending a bot a turn. That needs credentials and a model, which the drivers
// do not have — `smoke-turn.sh` is where a real turn is driven.
//
// Like the other drivers this perturbs `bravebot-ui.json`, and it puts its own key back: the bots
// list is this driver's to write and the rest of that file is somebody's arrangement of the window.

import { _electron as electron } from 'playwright-core'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

mkdirSync('/tmp/bravebot-ui', { recursive: true })

const problems = []
const check = (ok, what) => {
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`)
  if (!ok) problems.push(what)
}

const launch = () => electron.launch({ args: ['.'], cwd: process.cwd(), timeout: 40000 })

// Where the app keeps what it remembers, asked of the app rather than composed here: `userData` is
// Electron's to decide and differs by platform. A launch of its own, because this driver's key has
// to be cleared before the first launch that is measured — a bot left behind by an earlier run
// would be a row these assertions did not make.
const naming = await launch()
const userData = await naming.evaluate(({ app }) => app.getPath('userData'))
await naming.close()

const stateFile = join(userData, 'bravebot-ui.json')
const readState = () => {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'))
  } catch {
    return {}
  }
}

// What was there before this ran, so it can be there after. This driver's two keys only.
//
// `bots` is not like the other keys a driver borrows. A column width is a preference and putting
// back the wrong one costs somebody a drag; a bots list is *somebody's bots* — a name they wrote, a
// purpose they wrote, the id of a session with a history in it, and a seed that is the only copy of
// what their bot's face looks like. A run that is interrupted between clearing that and restoring
// it destroys all of it, and this driver was written that way and did exactly that.
//
// So it does not clear the list any more. It adds two bots of its own, asserts about those, and
// takes only those away again — which is the same rule the README states about this file, applied
// one level down: replace only what is yours, and inside a shared key that means your own rows and
// not the key.
const MINE = ['release-notes', 'triage']
const hadView = readState().view

const putKey = (key, value) => {
  const state = readState()
  if (value === undefined) delete state[key]
  else state[key] = value
  try {
    writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    // The app has not written the file yet, which is a state it handles on every first launch.
  }
}

// A checkout for the bots to work in. Real, because making a bot writes a `.bravebot-ui` folder
// into the directory it is pinned to, and a path that is not there would be a refusal rather than
// a bot. Removed at the end, along with everything the app put in it.
const checkout = join(tmpdir(), 'bravebot-ui-drive-bots')
rmSync(checkout, { recursive: true, force: true })
mkdirSync(checkout, { recursive: true })

// Only this driver's own rows, in case an earlier run was interrupted before its teardown.
putKey('bots', (readState().bots ?? []).filter((bot) => !MINE.includes(bot.slug)))
putKey('view', undefined)

/**
 * Make a bot without the folder picker.
 *
 * The picker is native and a driver cannot answer one, so the two bots below are written through
 * the same channel the form writes through — which is the channel under test, and leaves only the
 * picker itself undriven. The window is then told to read the list back, exactly as it does after
 * saving one.
 */
const makeBot = (page, name, purpose) =>
  page.evaluate(
    ([name, purpose, directory]) => window.bravebot.writeBot({ name, purpose, directory }),
    [name, purpose, checkout],
  )

const app = await launch()
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')
page.on('pageerror', (error) => console.log('PAGE ERROR:', error.message))
page.on('console', (message) => message.type() === 'error' && console.log('CONSOLE ERROR:', message.text()))
await page.waitForTimeout(2500)

// --- the column has two lists ----------------------------------------------------------

const tabs = page.locator('.sidebar-tab')
check((await tabs.count()) === 2, 'the column offers two lists')
check(
  (await tabs.nth(0).getAttribute('aria-pressed')) === 'true',
  'and opens on the sessions, which is what every launch before this showed',
)

await tabs.nth(1).click()
await page.waitForTimeout(300)
check((await tabs.nth(1).getAttribute('aria-pressed')) === 'true', 'pressing Bots shows the bots')
// Only where the list is genuinely empty. This driver no longer clears somebody's bots to make it
// so — that key is not a preference, it is their bots — so on a machine that has some, the empty
// state is not a thing that can be shown and saying it was would be a false ok.
if ((await page.locator('.bot').count()) === 0) {
  check(
    await page.locator('.session-list .empty').first().isVisible(),
    'and an empty list says what a bot is rather than nothing',
  )
} else {
  console.log('  --   the empty state is untested: this machine already has bots')
}
await page.screenshot({ path: '/tmp/bravebot-ui/20-bots-empty.png' })

// The session list is hidden rather than unmounted, which is what lets a filter and a fold
// survive a look at the other tab.
check(
  (await page.locator('#sessions-column .sidebar-body').first().isHidden()) &&
    (await page.locator('.session-find').count()) === 1,
  'the list not on screen is hidden rather than thrown away',
)

// --- two bots, two faces ----------------------------------------------------------------

await makeBot(page, 'Release Notes', 'Draft release notes from the commits since the last tag.')
await makeBot(page, 'Triage', 'Read new issues and say which are duplicates.')
// The list is the main process's; the window reads it back the way it does after saving one.
await page.reload()
await page.waitForTimeout(2000)
await page.locator('.sidebar-tab').nth(1).click()
await page.waitForTimeout(400)

// Located by name rather than by position. The list holds whatever bots the person running this
// already had, sorted by slug, so "the first row" is not this driver's row and asserting on it
// would be asserting about somebody's own bot.
const rowFor = (name) =>
  page.locator('.bot').filter({ has: page.locator('.bot-name', { hasText: new RegExp(`^${name}$`) }) })
const mine = rowFor('Release Notes')
const other = rowFor('Triage')

check((await mine.count()) === 1 && (await other.count()) === 1, 'both bots are in the list')
check(
  (await mine.locator('.bot-name').textContent())?.trim() === 'Release Notes',
  'and are named what they were called',
)
check(
  (await mine.locator('.bot-where').textContent())?.includes('not spoken to yet'),
  'a bot nothing has spoken to says so, rather than showing a time it was never at',
)

// The form the seed chose — `round-antenna-ears-wide-dome-collar` — rather than the pixels. The
// face is a figure that is turning while it is looked at, so two screenshots of one avatar differ
// and two avatars caught at the same instant may not; the thing that is actually stable, and
// actually the claim, is which figure was built.
const faceOf = (row) => row.locator('.bot-avatar').getAttribute('data-avatar')

const first = await faceOf(mine)
const second = await faceOf(other)
check(!!first && !!second, `each bot has a face (${first})`)
check(first !== second, `and two bots do not have the same one (${second})`)
await page.screenshot({ path: '/tmp/bravebot-ui/21-bots-listed.png' })

// --- the face survives a rename ----------------------------------------------------------

// The seed is stored rather than derived, so renaming a bot must not repaint it. A face that
// changed when its name did would not be a face.
await mine.locator('.bot-edit').click()
await page.waitForTimeout(300)
check((await page.locator('.bot-form').count()) === 1, 'the edit control opens the form')
await page.screenshot({ path: '/tmp/bravebot-ui/23-bots-form.png' })
await page.locator('.bot-form input').fill('Release Notes (weekly)')
await page.locator('.bot-save').click()
await page.waitForTimeout(600)

const renamed = rowFor('Release Notes \\(weekly\\)')
check((await renamed.count()) === 1, 'a renamed bot is called what it was renamed to')
check((await faceOf(renamed)) === first, 'and keeps the face it had — the point of storing the seed')

// --- and a relaunch ----------------------------------------------------------------------

await app.close()

const second_app = await launch()
const back = await second_app.firstWindow()
await back.waitForLoadState('domcontentloaded')
await back.waitForTimeout(2500)

const backRow = (name) =>
  back.locator('.bot').filter({ has: back.locator('.bot-name', { hasText: new RegExp(`^${name}$`) }) })
const backMine = backRow('Release Notes \\(weekly\\)')

check(
  (await back.locator('.sidebar-tab').nth(1).getAttribute('aria-pressed')) === 'true',
  'the column comes back on the tab it was left on',
)
check(
  (await backMine.count()) === 1 && (await backRow('Triage').count()) === 1,
  'and both bots are still there',
)
check(
  (await backMine.locator('.bot-name').textContent())?.trim() === 'Release Notes (weekly)',
  'with the name that was typed into them',
)
check(
  (await backMine.locator('.bot-avatar').getAttribute('data-avatar')) === first,
  'and the same face, built from a seed on disk rather than from the name',
)
await back.screenshot({ path: '/tmp/bravebot-ui/22-bots-relaunched.png' })

// --- forgetting one ----------------------------------------------------------------------

await backMine.locator('.bot-edit').click()
await back.waitForTimeout(300)
await back.locator('.bot-remove').click()
await back.waitForTimeout(600)
check(
  (await backMine.count()) === 0 && (await backRow('Triage').count()) === 1,
  'forgetting a bot takes it out of the list, and takes nothing else',
)

// Put the column back on the sessions before leaving, whatever was there before. Every other
// driver is about that list, and one left on the bots would have them all clicking at rows that
// are in the DOM and invisible. The same courtesy `drive-panels.mjs` pays when it turns every
// panel back on — and the restore below is not enough on its own, since it puts back whatever
// this driver *found*, which may itself have been a bots tab left by an interrupted run.
await back.locator('.sidebar-tab').first().click()
await back.waitForTimeout(300)

await second_app.close()

// What this driver touched, put back. Only its own two keys — the rest of that file is somebody's
// arrangement of this window — and the checkout it made, with the memory folder the app wrote into
// it.
putKey('bots', (readState().bots ?? []).filter((bot) => !MINE.includes(bot.slug)))
putKey('view', { ...(hadView ?? { grouped: false, collapsed: [] }), tab: 'sessions' })
rmSync(checkout, { recursive: true, force: true })

console.log(problems.length ? `\nRESULT: ${problems.length} problem(s)` : '\nRESULT: ok')
process.exit(problems.length ? 1 : 0)
