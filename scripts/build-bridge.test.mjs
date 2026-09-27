import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { buildPlan } from './build-bridge.mjs'

const cargo = ['cargo', 'build', '-p', 'bravebot-bridge', '-p', 'bravebot-ui-files']
const agent = join('checkout', 'bravebot')

test('without direnv the build runs cargo directly and says credentials are missing', () => {
  const plan = buildPlan({ agent, agentExists: true, configured: false, direnv: 'absent', args: ['--locked'] })
  assert.deepEqual(plan.command, [...cargo, '--locked'])
  assert.match(plan.warning, /WITHOUT backend credentials/)
  assert.doesNotMatch(plan.warning, /is not allowed/)
})

test('an allowed .envrc wraps the same build, and a configured shell needs neither', () => {
  assert.deepEqual(buildPlan({ agent, agentExists: true, configured: false, direnv: 'allowed' }).command, ['direnv', 'exec', agent, ...cargo])
  const configured = buildPlan({ agent, agentExists: true, configured: true, direnv: 'allowed' })
  assert.deepEqual(configured.command, cargo)
  assert.equal(configured.warning, undefined)
})

test('an untrusted .envrc or a missing checkout is reported, and the build still runs', () => {
  const denied = buildPlan({ agent, agentExists: true, configured: false, direnv: 'denied' })
  assert.deepEqual(denied.command, cargo)
  assert.match(denied.warning, /is not allowed\. Run: direnv allow/)
  const missing = buildPlan({ agent, agentExists: false, configured: true, direnv: 'absent' })
  assert.deepEqual(missing.command, cargo)
  assert.match(missing.warning, /no credential checkout/)
})
