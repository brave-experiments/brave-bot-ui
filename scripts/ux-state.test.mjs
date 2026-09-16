import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { buildSync } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const require = createRequire(import.meta.url)
function load(path, electron = {}) {
  electron = { ...electron, app: { getAppPath: () => process.cwd(), ...electron.app } }
  const source = buildSync({ entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['electron'] }).outputFiles[0].text
  const module = { exports: {} }
  new Function('require', 'module', 'exports', source)((id) => id === 'electron' ? electron : require(id), module, module.exports)
  return module.exports
}

test('project search finds files in unopened folders; preview rejects traversal and escaping symlinks', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bravebot-ux-files-'))
  const root = join(directory, 'project')
  mkdirSync(join(root, 'src', 'deep'), { recursive: true })
  writeFileSync(join(root, 'src', 'deep', 'example.ts'), 'const answer = 42\n')
  writeFileSync(join(directory, 'outside.txt'), 'must not cross')
  symlinkSync(join(directory, 'outside.txt'), join(root, 'escape'))
  symlinkSync(directory, join(root, 'escaped-directory'))
  try {
    const files = load('src/main/files.ts', { shell: {} })
    files.noteRoot('test-session', root)
    assert.deepEqual((await files.search('test-session', 'example', false)).paths, ['src/deep/example.ts'])
    assert.equal(files.preview('test-session', 'src/deep/example.ts').text, 'const answer = 42\n')
    for (const path of ['../outside.txt', '/etc/passwd', 'escape', 'escaped-directory/outside.txt']) assert.equal(files.preview('test-session', path), null)
    assert.equal(files.preview('unknown-session', 'src/deep/example.ts'), null)
    assert.equal((await files.search('test-session', 'outside', false)).paths.length, 0)
    writeFileSync(join(root, 'binary'), Buffer.from([0, 1, 2]))
    assert.equal(files.preview('test-session', 'binary'), null)
    writeFileSync(join(root, 'large'), 'x'.repeat(150000))
    assert.equal(files.preview('test-session', 'large').truncated, true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('attachment grants are per session and revalidate changed files at send', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bravebot-ux-attachment-'))
  const selected = join(root, 'notes.txt')
  writeFileSync(selected, 'Explicit review context')
  const files = load('src/main/files.ts', { dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }) } })
  files.noteRoot('a', root); files.noteRoot('b', root)
  try {
    const [file] = await files.chooseAttachments({}, 'a')
    assert.deepEqual(files.attachmentPaths('a', [file.id]), ['notes.txt'])
    assert.throws(() => files.attachmentPaths('b', [file.id]))
    assert.throws(() => files.attachmentPaths('a', ['notes.txt']))
    writeFileSync(selected, Buffer.from([0, 1, 2]))
    assert.throws(() => files.attachmentPaths('a', [file.id]))
    await assert.rejects(files.chooseAttachments({}, 'a'))
    writeFileSync(selected, 'x'.repeat(300000))
    assert.throws(() => files.attachmentPaths('a', [file.id]))
    writeFileSync(selected, 'Text again')
    files.forgetRoot('a')
    assert.throws(() => files.attachmentPaths('a', [file.id]))
  } finally { rmSync(root, { recursive: true, force: true }) }
})
