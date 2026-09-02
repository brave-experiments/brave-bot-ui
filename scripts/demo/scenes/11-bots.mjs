// Bots: the other list in the left column.
//
// Every scene before this one is about a *session* — an occasion, named after whatever was asked
// first, and finished with. A bot is somebody who has one: a name, a purpose, a memory, and one
// checkout, in front of a single session that is resumed forever rather than begun again. So the
// shot is the tab first, because the column having two lists is the thing a viewer has to be told
// before anything else here makes sense.
//
// **It makes a bot on camera, and the folder picker answers itself.** Choosing a checkout opens a
// native panel, which would hang the run behind a sheet nobody can dismiss — so the stage stubs it
// at the same point it stubs the save panel, pointed at one of the world's own fixture checkouts.
// The caption says the folder comes from the system's picker, because on camera it simply appears.
//
// The bot is removed before it is made, off camera, so every take films the same thing: a run
// against a world that already has one would otherwise skip the part worth watching. Nothing
// accumulates.
import { rmSync } from 'node:fs'
import { join } from 'node:path'

const NAME = 'Harbour Watch'
const PURPOSE =
  'You look after the harbour-lights checkout. Keep an eye on what changes in it, ' +
  'and say what you would want to be told about it a week from now.'

export default {
  id: '11-bots',
  title: 'Bots',

  async run(s) {
    const { page } = s

    // Off camera: take away anything this pair of scenes left behind last time, so every take
    // films the same thing.
    //
    // The definition goes through the window's own channel — `removeBot` forgets a bot and leaves
    // its session and memory where they are, which is what the control in the window does too. The
    // *memory file* then has to be taken away here, from the disk, and it is the one that matters:
    // `12-bot-memory` asks the bot to remember two things, and a bot whose memory already says them
    // rightly writes nothing and answers that it knew. That is the bot behaving well and the take
    // being wasted, and the run reports it as "no memory write was offered" — which reads like a
    // broken feature and is not one.
    const gone = await page.evaluate(async (name) => {
      const bots = await window.bravebot.readBots()
      const taken = []
      for (const bot of bots) {
        if (bot.name !== name) continue
        taken.push({ slug: bot.slug, directory: bot.directory })
        await window.bravebot.removeBot(bot.slug)
      }
      return taken
    }, NAME)
    for (const bot of gone) {
      rmSync(join(bot.directory, '.bravebot-ui', 'bots', `${bot.slug}.md`), { force: true })
    }

    const tab = page.locator('.sidebar-tab').nth(1)
    if (!(await tab.count())) s.skip('this build has no bots tab')

    await s.say('Bots', 'The left column holds two lists. This is the other one.', 2.2)
    await s.glideTo(tab)
    await s.click(tab)
    await page.waitForTimeout(700)
    await s.say('Bots', 'A session is an occasion. A bot is somebody who has one.', 2.4)
    await s.shot('11-bots')

    // --- making one -----------------------------------------------------------------------

    // Scoped to the bots panel. Both lists are in the DOM at once — the one not on screen is
    // hidden rather than unmounted, so a filter or a half-filled form survives a look at the other
    // tab — which means `.new` on its own matches the session list's button first.
    const panel = page.locator('.sidebar-body').nth(1)

    await s.say('Make one', 'A name, and what it is for.')
    await s.click(panel.locator('.new'))
    await page.waitForTimeout(600)

    const form = page.locator('.bot-form')
    if (!(await form.count())) s.skip('the new-bot form did not open')

    await s.slowType(form.locator('input').first(), NAME)
    await s.beat(0.5)
    await s.slowType(form.locator('textarea').first(), PURPOSE)
    await s.beat(0.8)

    const choose = form.locator('.bot-choose')
    if (await choose.count()) {
      await s.glideTo(choose)
      await s.say('And one checkout', 'Chosen from the system’s own folder panel, and pinned from then on.', 2.6)
      await s.click(choose)
      await page.waitForTimeout(700)
    }

    await s.say('A folder will appear in it', 'Holding the bot’s memory. It ignores itself, so it is nobody’s diff.', 2.8)
    const note = page.locator('.bot-note')
    if (await note.count()) {
      await s.spotlight(note, 1.6)
      await s.unspot()
    }

    await s.click(form.locator('.bot-save'))
    await page.waitForTimeout(1200)

    const row = page
      .locator('.bot')
      .filter({ has: page.locator('.bot-name', { hasText: new RegExp(`^${NAME}$`) }) })
    if (!(await row.count())) s.skip('the bot was not added to the list')

    await s.say('And there it is', 'Not spoken to yet — a bot writes no session until it has something to say.', 2.6)
    await s.spotlight(row, 1.8)
    await s.unspot()
    await s.shot('11-bot-made')

    // --- the face -------------------------------------------------------------------------

    const face = row.locator('.bot-avatar')
    if (await face.count()) {
      await s.glideTo(face)
      await s.say('Every bot has a face', 'Built from a seed it is given once, so it is the same face tomorrow.', 2.6)
      await s.spotlight(face, 2.4)
      await s.unspot()
      // Long enough to see it turn. The motion is a function of the clock rather than of frames,
      // so this reads the same on a fast machine and a slow one — which is the point of it.
      await s.say('It turns, slowly', 'One colour each, and the parts told apart by shade of it.', 2.8)
      await s.beat(1.6)
    }

    // --- what is in one -------------------------------------------------------------------

    await s.say('What a bot holds', 'Its purpose, and the memory it keeps.')
    await s.click(row.locator('.bot-edit'))
    await page.waitForTimeout(700)

    const purpose = page.locator('.bot-form textarea').first()
    if (await purpose.count()) {
      await s.spotlight(purpose, 2.0)
      await s.unspot()
    }
    const memory = page.locator('.bot-memory')
    if (await memory.count()) {
      await s.glideTo(memory)
      await s.say('Its memory', 'A real file in the checkout, which the bot edits and the transcript records.', 3.0)
      await s.spotlight(memory, 2.2)
      await s.unspot()
      await s.shot('11-bot-memory')
    }

    const cancel = page.locator('.bot-actions button', { hasText: 'Cancel' })
    if (await cancel.count()) await s.click(cancel.first())
    await page.waitForTimeout(500)

    await s.say('One session, resumed', 'Not a new one each time — which is what makes a bot persistent.', 2.6)
    await s.beat(0.8)
  },
}
