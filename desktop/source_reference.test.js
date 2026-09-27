'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  locateSourceReference,
  parseSourceReference,
  resolveSourceReference,
  toVsCodeUrl,
} = require('./source_reference')

test('a plan anchor resolves inside the approved root and maps to its exact line', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'valkama-source-'))
  try {
    const docs = path.join(root, 'docs', 'plans')
    await fs.mkdir(docs, { recursive: true })
    const file = path.join(docs, 'plan.md')
    await fs.writeFile(file, '# Plan\n\n<!-- kb:kui02 -->\n## Follow-up\n', 'utf8')

    const located = await locateSourceReference(root, 'docs/plans/plan.md#kb:kui02')
    assert.equal(located.absolutePath, await fs.realpath(file))
    assert.equal(located.line, 3)
    assert.equal(located.column, 1)
    assert.match(toVsCodeUrl(located.absolutePath, located.line), /^vscode:\/\/file\/.*:3:1$/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('unsafe, unsupported, and malformed source references are rejected', () => {
  const root = path.resolve('workspace')
  assert.throws(
    () => resolveSourceReference('relative-workspace', 'docs/plan.md#kb:x'),
    /absolute path/,
  )
  assert.throws(() => parseSourceReference('C:\\outside\\plan.md#kb:x'), /relative workspace path/)
  assert.throws(() => resolveSourceReference(root, '../plan.md#kb:x'), /escapes/)
  assert.throws(() => parseSourceReference('docs/plan.txt#kb:x'), /Markdown/)
  assert.throws(() => parseSourceReference('docs/plan.md#heading'), /malformed/)
  assert.throws(() => parseSourceReference('https://example.com/plan.md#kb:x'), /relative workspace path/)
})

test('a missing anchor fails instead of pretending to navigate', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'valkama-source-'))
  try {
    await fs.writeFile(path.join(root, 'plan.md'), '# Plan\n', 'utf8')
    await assert.rejects(
      locateSourceReference(root, 'plan.md#kb:missing'),
      /was not found/,
    )
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('a junction inside the workspace cannot escape the approved real path', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'valkama-junction-'))
  try {
    const root = path.join(parent, 'workspace')
    const outside = path.join(parent, 'outside')
    await fs.mkdir(root)
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'plan.md'), '<!-- kb:x1 -->\n', 'utf8')
    await fs.symlink(outside, path.join(root, 'linked'), 'junction')

    await assert.rejects(
      locateSourceReference(root, 'linked/plan.md#kb:x1'),
      /escapes the approved workspace root/,
    )
  } finally {
    await fs.rm(parent, { recursive: true, force: true })
  }
})
