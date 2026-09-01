'use strict'

const path = require('node:path')
const { resolveResourceRoot } = require('./project_registry')
const { locateSourceReference, toVsCodeUrl } = require('./source_reference')

const SOURCE_REQUEST_KEYS = new Set(['source', 'resource_ref'])

function sourceRequest(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== SOURCE_REQUEST_KEYS.size || keys.some((key) => !SOURCE_REQUEST_KEYS.has(key))) {
    return null
  }
  if (typeof value.source !== 'string' || value.source.length === 0) return null
  return { source: value.source, resource_ref: value.resource_ref }
}

function approvedSourceRoot(mapping) {
  return mapping?.status === 'mapped' &&
    mapping.validated === true &&
    typeof mapping.canonical_root === 'string' &&
    path.isAbsolute(mapping.canonical_root)
    ? mapping.canonical_root
    : ''
}

async function openSourceRequest({
  senderUrl,
  appUrl,
  request,
  shell,
  readBytes,
  directoryExists,
}) {
  if (typeof senderUrl !== 'string' || !senderUrl.startsWith(appUrl)) {
    return { ok: false, mode: 'opened', error: 'Source requests are limited to the Valkama app' }
  }
  const strict = sourceRequest(request)
  if (!strict) return { ok: false, mode: 'opened', error: 'invalid-source-request' }
  const mapping = resolveResourceRoot(strict.resource_ref, { readBytes, directoryExists })
  const root = approvedSourceRoot(mapping)
  if (!root) {
    return {
      ok: false,
      mode: 'opened',
      error: 'space-root-unavailable',
    }
  }
  try {
    const reference = await locateSourceReference(root, strict.source)
    if (reference.anchor) {
      await shell.openExternal(
        toVsCodeUrl(reference.absolutePath, reference.line, reference.column),
      )
    } else {
      const failure = await shell.openPath(reference.absolutePath)
      if (failure) throw new Error(failure)
    }
    return {
      ok: true,
      mode: 'opened',
      path: reference.absolutePath,
      line: reference.line,
    }
  } catch (failure) {
    return {
      ok: false,
      mode: 'opened',
      error: failure instanceof Error ? failure.message : String(failure),
    }
  }
}

module.exports = { approvedSourceRoot, openSourceRequest }
