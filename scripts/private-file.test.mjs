import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
function load(path) {
  const source = buildSync({ entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['electron'] }).outputFiles[0].text
  const module = { exports: {} }
  new Function('require', 'module', 'exports', source)(id => id === 'electron' ? { app: { getAppPath: () => process.cwd(), isPackaged: false } } : require(id), module, module.exports)
  return module.exports
}
const { writePrivate } = load('src/main/project-files.ts')
const { executable } = load('src/main/executable.ts')

/** Reads the file's access list and this account's SID with PowerShell, so the check does not rely on the helper. */
function windowsAccess(path) {
  const script = "$a = (Get-Acl -LiteralPath $env:TARGET).GetSecurityDescriptorSddlForm('Access'); " +
    "$u = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value; \"$u`n$a\""
  const [account, access] = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { env: { ...process.env, TARGET: path }, encoding: 'utf8' }).trim().split(/\r?\n/)
  return { account, access }
}

test('app state is written so only this account can read it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravebot-private-'))
  try {
    const path = join(directory, 'experience.json.tmp')
    writePrivate(path, 'first')
    writePrivate(path, 'second')
    assert.equal(readFileSync(path, 'utf8'), 'second')
    assert.deepEqual(readdirSync(directory), ['experience.json.tmp'])
    if (process.platform === 'win32') {
      const { account, access } = windowsAccess(path)
      assert.equal(access, `D:P(A;;FA;;;${account})`)
    } else {
      assert.equal(statSync(path).mode & 0o777, 0o600)
    }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('binaries carry the .exe suffix on Windows only', () => {
  assert.equal(executable('bravebot-rpc', 'win32'), 'bravebot-rpc.exe')
  assert.equal(executable('bravebot-rpc', 'darwin'), 'bravebot-rpc')
  assert.equal(executable('bravebot-ui-files', 'linux'), 'bravebot-ui-files')
})
