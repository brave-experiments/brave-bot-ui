// Exercise the real composer with deterministic model/session replies; no paid inference.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright-core'

const profile = mkdtempSync(join(tmpdir(), 'bravebot-model-picker-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], cwd: process.cwd(), timeout: 40000 })
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const defaultModel = 'openrouter/anthropic/claude-haiku-4.5'
    const directory = '/tmp/bravebot-model-picker-project'
    const rows = ['A', 'B'].map((id) => ({ id, directory, title: `Conversation ${id}`,
      project: 'model-picker-project', branch: null, updated: 1, bytes: 1 }))
    globalThis.modelTest = { sent: [], fail: false, loading: false }
    ipcMain.removeHandler('bravebot:choose-directory')
    ipcMain.handle('bravebot:choose-directory', () => directory)
    ipcMain.removeHandler('bravebot:request')
    ipcMain.handle('bravebot:request', async (_, method, params) => {
      if (method === 'models.list') {
        if (globalThis.modelTest.fail) return { error: { code: 'offline', message: 'Model listing is offline.' } }
        if (globalThis.modelTest.loading) await new Promise((resolve) => setTimeout(resolve, 500))
        return { ok: { defaultModel, warnings: [], models: [
          { id: defaultModel, name: 'Claude Haiku 4.5', provider: 'OpenRouter', premium: false, contextWindow: 200000, capabilities: ['text', 'vision', 'tools'] },
          { id: 'openrouter/anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', provider: 'OpenRouter', premium: false, contextWindow: 200000, capabilities: ['text', 'vision', 'tools', 'reasoning'] },
          { id: 'brave-model', name: 'Brave model', provider: 'Brave', premium: false, contextWindow: 24000 },
        ] } }
      }
      if (method === 'session.list') return { ok: { sessions: rows } }
      if (method === 'session.new') return { ok: { session: 's-new', directory, branch: null, model: defaultModel } }
      if (method === 'session.open') return { ok: { session: `s-${params.id}`, model: defaultModel,
        record: { ...rows.find((row) => row.id === params.id), started: 1, turns: 0, tokens: 0, build: 'fixture' },
        said: [], todos: {}, context: '', trust: { known: true, rules: [] }, archived: 0,
        branchNote: null, buildNote: null } }
      if (method === 'turn.send') {
        globalThis.modelTest.sent.push(params)
        return { ok: { turn: 1 } }
      }
      if (method === 'agent.info') return { ok: { build: 'fixture', version: '1', home: null } }
      return { ok: {} }
    })
    globalThis.finishModelTurn = () => BrowserWindow.getAllWindows()[0].webContents.send('bravebot:event', {
      event: 'turn.done', session: 's-new', data: { id: 'A', turn: 1, reply: 'Done', archived: 0 },
    })
  })
  await page.reload()
  await page.getByRole('button', { name: /^\+ New session$/ }).click()
  await page.getByRole('button', { name: "Don't trust", exact: true }).click()
  const trigger = page.locator('.model-trigger')
  await trigger.waitFor()
  assert.match(await trigger.getAttribute('aria-label'), /claude-haiku-4.5/)
  assert.equal(await page.locator('.model-current').innerText(), 'claude-haiku-4.5')
  const triggerBox = await trigger.boundingBox()
  const entryBox = await page.locator('.composer textarea').boundingBox()
  assert(triggerBox.x + triggerBox.width <= entryBox.x, 'model icon is left of the text entry')
  const controls = await page.locator('.model-trigger, .composer textarea, .export-open, .composer .send').evaluateAll((elements) =>
    elements.map((element) => { const rect = element.getBoundingClientRect(); return { top: rect.top, height: rect.height } }))
  assert.equal(controls.length, 4)
  assert(controls.every((rect) => rect.top === controls[0].top && rect.height === controls[0].height),
    `composer controls must align exactly: ${JSON.stringify(controls)}`)
  console.log('Composer alignment:', JSON.stringify(controls))

  await trigger.click()
  await page.getByRole('option', { name: /Claude Sonnet/ }).waitFor()
  assert.deepEqual(await page.getByRole('option', { name: /Claude Sonnet/ }).locator('.model-capability').allTextContents(), ['Text', 'Vision', 'Tools', 'Reasoning'])
  assert.equal(await page.getByRole('option', { name: /Brave model/ }).locator('.model-capability').count(), 0)
  const search = page.getByRole('combobox', { name: 'Search models' })
  await search.fill('VISION')
  assert.equal(await page.getByRole('option').count(), 2)
  await search.fill('openrouter reasoning')
  assert.equal(await page.getByRole('option').count(), 1)
  assert.match(await page.getByRole('option').innerText(), /Sonnet/)
  await search.fill('brave tools')
  assert.equal(await page.getByRole('option').count(), 0)
  await search.fill('sonnet')
  assert.equal(await page.getByRole('option').count(), 1)
  await search.press('Enter')
  assert.equal(await page.locator('.model-popover').count(), 0)
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true)
  assert.match(await trigger.getAttribute('aria-label'), /Sonnet|sonnet/)
  assert.equal(await page.locator('.model-current').innerText(), 'Claude Sonnet 4.5')
  await page.screenshot({ path: '/tmp/bravebot-model-label.png' })

  const entry = page.locator('.composer textarea')
  await entry.fill('')
  await entry.press('Enter')
  assert.equal(await app.evaluate(() => globalThis.modelTest.sent.length), 0)
  await entry.fill('Use this conversation’s selected model')
  await entry.press('Shift+Enter')
  await entry.pressSequentially('On a second line')
  assert.equal(await entry.inputValue(), 'Use this conversation’s selected model\nOn a second line')
  assert.equal(await app.evaluate(() => globalThis.modelTest.sent.length), 0)
  await entry.press('Enter')
  assert.equal(await trigger.isDisabled(), true)
  const sent = await app.evaluate(() => globalThis.modelTest.sent)
  assert.equal(sent[0].model, 'openrouter/anthropic/claude-sonnet-4.5')
  assert.equal(sent[0].prompt, 'Use this conversation’s selected model\nOn a second line')
  await app.evaluate(() => globalThis.finishModelTurn())
  await page.waitForFunction(() => !document.querySelector('.model-trigger').disabled)
  await page.waitForFunction(() => localStorage.getItem('bravebot.conversation-model:["/tmp/bravebot-model-picker-project","A"]')?.includes('sonnet'))

  await page.locator('.session').filter({ hasText: 'Conversation B' }).click()
  await page.waitForFunction(() => document.querySelector('.model-trigger')?.getAttribute('aria-label')?.includes('haiku'))
  assert.match(await trigger.getAttribute('aria-label'), /haiku/)
  await page.locator('.session').filter({ hasText: 'Conversation A' }).click()
  await page.waitForFunction(() => document.querySelector('.model-trigger')?.getAttribute('aria-label')?.includes('sonnet'))
  assert.match(await trigger.getAttribute('aria-label'), /sonnet/)
  await page.reload()
  await page.locator('.session').filter({ hasText: 'Conversation A' }).click()
  await page.waitForFunction(() => document.querySelector('.model-trigger')?.getAttribute('aria-label')?.includes('sonnet'))
  assert.match(await trigger.getAttribute('aria-label'), /sonnet/)

  await trigger.click()
  await search.fill('no-such-model')
  await page.getByText('No models match your search.').waitFor()
  await search.press('Escape')
  assert.equal(await trigger.evaluate((element) => element === document.activeElement), true)
  await app.evaluate(() => { globalThis.modelTest.fail = true })
  await trigger.click()
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /offline/)
  await app.evaluate(() => { globalThis.modelTest.fail = false })
  await search.fill('')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await page.getByRole('option', { name: /Claude Haiku/ }).waitFor()
  await page.screenshot({ path: '/tmp/bravebot-model-picker.png' })
  assert.deepEqual(errors, [])
  console.log('PASS: default, picker placement, search, keyboard/focus, turn payload, running state, per-conversation persistence, empty/error/retry states')
} finally {
  await app.close()
  rmSync(profile, { recursive: true, force: true })
}
