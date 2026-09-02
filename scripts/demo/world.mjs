// A world to film in, so nothing real ends up in the video.
//
// A demo of this app is a demo of somebody's session list, and a session list is a list of
// what they have actually been doing: real project names, real prompts, real paths, and — in
// the file tree — the real contents of a real directory. None of that belongs in a recording
// that leaves the machine. So the demo does not film the machine.
//
// `$HOME` is most of it, and not all of it. The agent finds `~/.bravebot` — sessions, history,
// standing instructions — by reading `HOME` and nothing else (`crates/agent/src/home.rs`), so
// pointing that at a directory of ours sanitises everything the *agent* holds. This app's own
// remembered state — the recents list especially, which is real project paths and is filmed in
// File ▸ Open Recent — is a separate matter: on macOS Electron derives `userData` from the
// password database rather than from the environment, so it needs `--user-data-dir` as well.
// Both are set, here and in `stage.mjs`. Point them at a directory of ours and the app comes up
// in a world containing exactly what this file put there: two invented checkouts, and the
// sessions the demo earned in them.
//
// **The sessions are earned rather than written.** Seeding them by hand would mean encoding
// the agent's own on-disk record format here — a format that is upstream, is not ours, and is
// rewritten after every turn. A demo that hard-coded it would break silently on a bump, months
// later, in a recording somebody was about to publish. So the world is built by driving the
// product: real prompts against the fixture checkouts, once, cached in the world for every run
// afterwards. It costs a few tokens the first time and nothing after that.
import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/** The checked-in templates. Copied into the world rather than filmed in place, so a turn
 *  that edits a file edits the copy and this checkout stays clean. */
const TEMPLATES = join(here, 'project')

/**
 * Outside the repository, so `git clean` does not throw away sessions that cost tokens — and
 * outside the home directory, because every path in this world ends up on screen. The
 * transcript header, the file tree's root and the session list's second line all show one, and
 * a home directory has somebody's name in it. `/Users/Shared` is a real, persistent, writable
 * macOS directory whose path says nothing about whose machine this is. `--world` overrides it.
 */
export const DEFAULT_WORLD = '/Users/Shared/bravebot-ui-demo'

/**
 * What the world is asked for, in the order the video wants it.
 *
 * Two checkouts, because grouping the session list by checkout is one of the things being
 * demonstrated and one heading is not a demonstration of grouping. Two prompts in the first,
 * because forking cuts in front of the second.
 *
 * The prompts are chosen to be cheap, to be safe, and to leave the right evidence behind: a
 * markdown table for the formatting scene, files read for the context panels, a command for
 * the approval card, and enough tool calls to make a run worth folding.
 */
const RECIPES = [
  {
    project: 'harbour-lights',
    prompts: [
      'Read src/lib/tides.ts and src/App.tsx, then describe what this app does in a short ' +
        'markdown table of its components and what each is for. Do not change anything.',
      'Which file under src/ is the longest, and what is in it? Do not change anything.',
    ],
  },
  {
    project: 'tide-tables',
    prompts: [
      'Run `wc -l src/*.ts` here and tell me the total number of lines. Do not change anything.',
    ],
  },
]

/** Where the world's copies of the fixture checkouts live. */
export const projectsIn = (world) =>
  RECIPES.map((recipe) => join(world, 'projects', recipe.project))

/** Has anything been filmed here before? A world with no sessions is a world with no video. */
const seeded = (world) => {
  const sessions = join(world, '.bravebot', 'sessions')
  try {
    return readdirSync(sessions).some((name) => !name.startsWith('.'))
  } catch {
    return false
  }
}

/** Lay out the checkouts. Cheap, and idempotent, so it runs on every launch. */
function layOut(world, { rebuild }) {
  if (rebuild && existsSync(world)) rmSync(world, { recursive: true, force: true })
  mkdirSync(join(world, 'projects'), { recursive: true })
  for (const recipe of RECIPES) {
    const to = join(world, 'projects', recipe.project)
    if (!existsSync(to)) cpSync(join(TEMPLATES, recipe.project), to, { recursive: true })
  }
}

/**
 * Bring the world up to something worth filming, building the sessions if it has none.
 *
 * Returns `null` for the sessions when it could not build them — no credentials, a refusal, a
 * turn that never finished — rather than throwing. A world with checkouts and no sessions is
 * still a world the file-tree scene can be filmed in, and the scenes that need a transcript
 * already know how to bow out.
 */
export async function ensureWorld(world, opts) {
  layOut(world, opts)
  if (seeded(world) && !opts.rebuild) return { world, built: false }

  console.log(`building the demo world in ${world}`)
  console.log('  this drives real turns against the fixture checkouts, once — later runs reuse them')
  const built = await build(world)
  return { world, built }
}

/** Everything the seeding run needs to know about a turn that is still going. */
const busy = (page) => page.locator('.working').isVisible().catch(() => false)

/**
 * Drive a turn to a standstill, answering whatever it stops to ask.
 *
 * Approvals are given here without ceremony, which is the one place in this repository that
 * happens. It is defensible only because of where it happens: the agent is confined to a
 * checkout this file laid out itself, from templates in this repository, and the prompts it
 * was given ask it to read and to count. It is not a pattern to copy anywhere a real
 * directory is involved.
 */
async function settle(page, seconds = 180) {
  const until = Date.now() + seconds * 1000
  // `:has(.confirm-actions)` because a card that has been answered stays in the transcript —
  // that is the record of the decision — and `.confirm` alone would keep matching it forever.
  const asking = page.locator('.confirm:has(.confirm-actions)')
  while (Date.now() < until) {
    const card = asking.first()
    if (await card.isVisible().catch(() => false)) {
      // A series of questions has to be answered before it can be sent; everything else is a
      // single button. `:not(.always)` because vouching is a broader answer than was asked for.
      for (const block of await card.locator('.ask-question').all()) {
        const choice = block.locator('.choices .choice').first()
        if (await choice.count()) await choice.click()
        else await block.locator('.typed').first().fill('whatever you think best')
      }
      const approve = card.locator('.confirm-actions .approve:not(.always)').first()
      await (await approve.count() ? approve : card.locator('.confirm-actions .approve').first()).click()
      await page.waitForTimeout(800)
      continue
    }
    if (!(await busy(page))) {
      // Settled — but a turn pauses between steps, so this waits to be sure rather than
      // taking the first quiet frame as the end of it.
      await page.waitForTimeout(2500)
      if (!(await busy(page)) && !(await asking.first().isVisible().catch(() => false))) {
        return true
      }
      continue
    }
    await page.waitForTimeout(1000)
  }
  return false
}

/** Launch the app inside the world and earn its sessions. */
async function build(world) {
  // Both redirections, for the reason `stage.mjs` gives at length: `HOME` moves the agent's own
  // store, and only `--user-data-dir` moves this app's. Without the second, seeding a world would
  // write the real recents list — the checkouts it opens here would appear in somebody's File ▸
  // Open Recent afterwards, which is the opposite of what a sanitised world is for.
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${join(world, 'userData')}`],
    cwd: process.cwd(),
    timeout: 40000,
    env: { ...process.env, HOME: world },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message))
  await page.waitForTimeout(2500)

  if (await page.locator('.unconfigured').isVisible().catch(() => false)) {
    console.log('  the agent has no credentials built in, so there are no turns to drive')
    console.log('  the checkouts are there; the scenes needing a transcript will bow out')
    await app.close()
    return false
  }

  let made = 0
  try {
    for (const recipe of RECIPES) {
      const directory = join(world, 'projects', recipe.project)
      // The picker is a native sheet and would hang this, so it answers itself. The path is
      // one this file laid out, not one the window composed — the same rule the app keeps.
      await app.evaluate(({ dialog }, where) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [where] })
      }, directory)

      await page.locator('.new').first().click()
      await page.waitForTimeout(1500)
      if (await page.locator('.trust').isVisible().catch(() => false)) {
        await page.locator('.trust-actions .approve').click()
        await page.waitForTimeout(800)
      }

      for (const prompt of recipe.prompts) {
        console.log(`  ${recipe.project}: ${prompt.slice(0, 62)}…`)
        await page.locator('.composer textarea').fill(prompt)
        await page.locator('.composer .send').click()
        if (!(await settle(page))) {
          console.log('    the turn did not finish in time; keeping what it managed')
          break
        }
        made++
      }
    }
  } finally {
    await app.close()
  }

  console.log(made ? `  built ${made} turn${made === 1 ? '' : 's'}` : '  nothing was built')
  return made > 0
}
