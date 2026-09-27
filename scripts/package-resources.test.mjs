import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resources } from './package-resources.mjs'

test('Windows packages the .exe binaries Cargo builds there', () => {
  assert.deepEqual(resources('win32'), { agent: 'target/debug/bravebot-rpc.exe', files: 'target/debug/bravebot-ui-files.exe' })
})

test('macOS and Linux package unsuffixed binaries, and other platforms are refused', () => {
  for (const platform of ['darwin', 'linux']) {
    assert.deepEqual(resources(platform), { agent: 'target/debug/bravebot-rpc', files: 'target/debug/bravebot-ui-files' })
  }
  assert.throws(() => resources('freebsd'), /not supported on freebsd/)
})
