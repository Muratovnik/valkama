'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ANCHOR = /^kb:[a-z0-9][a-z0-9-]*$/i

function parseSourceReference(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('Source is empty')
  if (source.includes('\0')) throw new Error('Source contains a null byte')
  const separator = source.indexOf('#')
  const relativePath = (separator === -1 ? source : source.slice(0, separator)).trim()
  const anchor = separator === -1 ? '' : source.slice(separator + 1).trim()

  if (
    !relativePath ||
    /^[a-z][a-z0-9+.-]*:/i.test(relativePath) ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath)
  ) {
    throw new Error('Source must be a relative workspace path')
  }
  if (path.extname(relativePath).toLowerCase() !== '.md') {
    throw new Error('Source must point to a Markdown document')
  }
  if (anchor && !ANCHOR.test(anchor)) throw new Error('Source anchor is malformed')
  return { relativePath, anchor }
}

function resolveSourceReference(root, source) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('Approved source root must be an absolute path')
  }
  const approvedRoot = path.resolve(root)
  const parsed = parseSourceReference(source)
  const absolutePath = path.resolve(approvedRoot, parsed.relativePath)
  assertContained(approvedRoot, absolutePath)
  return { ...parsed, absolutePath }
}

function assertContained(approvedRoot, candidate) {
  const relative = path.relative(approvedRoot, candidate)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Source escapes the approved workspace root')
  }
}

async function locateSourceReference(root, source) {
  const reference = resolveSourceReference(root, source)
  const [realRoot, realFile] = await Promise.all([
    fs.realpath(path.resolve(root)),
    fs.realpath(reference.absolutePath),
  ])
  assertContained(realRoot, realFile)
  const canonical = { ...reference, absolutePath: realFile }
  const stat = await fs.stat(canonical.absolutePath)
  if (!stat.isFile()) throw new Error('Source is not a file')
  if (!canonical.anchor) return { ...canonical, line: 1, column: 1 }

  const content = await fs.readFile(canonical.absolutePath, 'utf8')
  const escaped = canonical.anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`<!--\\s*${escaped}\\s*-->`, 'i').exec(content)
  if (!match) throw new Error(`Source anchor #${canonical.anchor} was not found`)
  const line = content.slice(0, match.index).split(/\r?\n/).length
  return { ...canonical, line, column: 1 }
}

function toVsCodeUrl(absolutePath, line, column = 1) {
  const fileUrl = pathToFileURL(absolutePath)
  return `vscode://file${fileUrl.pathname}:${line}:${column}`
}

module.exports = {
  locateSourceReference,
  parseSourceReference,
  resolveSourceReference,
  toVsCodeUrl,
}
