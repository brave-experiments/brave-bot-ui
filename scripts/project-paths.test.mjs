import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)
function load(path, electron = {}) {
  electron = { ...electron, app: { getAppPath: () => process.cwd(), isPackaged: false, ...electron.app } }
  const source = buildSync({ entryPoints: [path], bundle: true, write: false, platform: 'node', format: 'cjs', external: ['electron'] }).outputFiles[0].text
  const module = { exports: {} }
  new Function('require', 'module', 'exports', source)((id) => id === 'electron' ? electron : require(id), module, module.exports)
  return module.exports
}
const { isProjectPath, projectName } = load('src/shared/recents.ts')

test('project paths are absolute on either platform, a network share included', () => {
  for (const path of ['/Users/me/project', 'C:\\Users\\me\\project', 'd:/work', '\\\\server\\share\\project', '\\\\server\\share']) assert.equal(isProjectPath(path), true, path)
  for (const path of ['project', 'C:project', '\\\\server', '\\\\server\\', '\\\\?\\C:\\project', '\\\\.\\pipe\\name', '\\\\..\\share\\project', '', 'C:\\bad\0name', 42]) assert.equal(isProjectPath(path), false, String(path))
})

test('a project is labelled by its last segment, and only a Windows path splits on a backslash', () => {
  assert.equal(projectName('/Users/me/project'), 'project')
  assert.equal(projectName('C:\\Users\\me\\project'), 'project')
  assert.equal(projectName('C:\\Users\\me\\project\\'), 'project')
  assert.equal(projectName('C:\\'), 'C:')
  assert.equal(projectName('\\\\server\\share\\project'), 'project')
  assert.equal(projectName('\\\\server\\share'), 'share')
  assert.equal(projectName('/srv/odd\\name'), 'odd\\name')
})

test('an attachment in a folder is named with forward slashes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bravebot-paths-'))
  mkdirSync(join(root, 'docs'))
  const selected = join(root, 'docs', 'notes.txt')
  writeFileSync(selected, 'Nested review context')
  const files = load('src/main/files.ts', { dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }) } })
  files.noteRoot('a', root)
  try {
    const [file] = await files.chooseAttachments({}, 'a')
    assert.equal(file.path, 'docs/notes.txt')
    assert.deepEqual(files.attachmentPaths('a', [file.id]), ['docs/notes.txt'])
    assert.equal(files.preview('a', 'docs/notes.txt').text, 'Nested review context')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('on Windows a backslash or colon in a relative path is refused rather than resolved', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'bravebot-paths-'))
  mkdirSync(join(root, 'docs'))
  writeFileSync(join(root, 'docs', 'notes.txt'), 'text')
  const files = load('src/main/files.ts', { shell: {} })
  files.noteRoot('a', root)
  try {
    assert.notEqual(files.list('a', 'docs'), null)
    for (const path of ['docs\\notes.txt', 'docs\\..\\..', 'docs/notes.txt:stream', 'C:notes.txt']) {
      assert.equal(files.preview('a', path), null, path)
      assert.equal(files.list('a', path), null, path)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
