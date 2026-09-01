'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const {
  parseRegistry,
  readRegistry,
  registryPath,
  resolveResourceRoot,
  trustedTarget,
} = require('./project_registry')

const DATA_SCOPE_ID = '22222222-2222-4222-8222-222222222222'

function planningResource(spaceKey = 'SAMPLE') {
  return {
    kind: 'planning-space',
    resource_id: Buffer.from(
      JSON.stringify({
        data_scope_id: DATA_SCOPE_ID,
        space_key: spaceKey,
      }),
      'utf8',
    ).toString('base64url'),
  }
}

function projectEntry(projectId, root, options = {}) {
  return {
    project_id: projectId,
    display_name: options.board || projectId,
    canonical_root: root,
    planning_binding: options.bindings?.[0]?.resource_ref || null,
  }
}

function registryBytes(projects) {
  return Buffer.from(JSON.stringify({ schema_version: 3, projects }), 'utf8')
}

test('production registry path is fixed and ignores the former environment alias', () => {
  const beforeLocal = process.env.LOCALAPPDATA
  const beforeOverride = process.env.VALKAMA_PROJECTS_REGISTRY
  try {
    process.env.LOCALAPPDATA = 'C:\\canonical-local'
    process.env.VALKAMA_PROJECTS_REGISTRY = 'C:\\other\\projects.json'
    assert.equal(registryPath(), path.join('C:\\canonical-local', 'Valkama', 'projects.json'))
    assert.equal(registryPath.length, 0)
  } finally {
    if (beforeLocal === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = beforeLocal
    if (beforeOverride === undefined) delete process.env.VALKAMA_PROJECTS_REGISTRY
    else process.env.VALKAMA_PROJECTS_REGISTRY = beforeOverride
  }
})

test('strict bytes produce one complete, sorted desktop project set', () => {
  const raw = registryBytes([
    projectEntry('beta', 'C:\\beta', {
      board: 'Beta',
      sourceHash: 'b'.repeat(64),
    }),
    projectEntry('alpha', 'C:\\alpha', { board: 'Alpha' }),
  ])
  const answer = readRegistry({ readBytes: () => raw })
  assert.equal(answer.status, 'available')
  assert.deepEqual(
    answer.projects.map((project) => project.project_id),
    ['alpha', 'beta'],
  )
  assert.equal(answer.projects[0].canonical_root, 'C:\\alpha')
  assert.deepEqual(
    raw,
    registryBytes([
      projectEntry('beta', 'C:\\beta', {
        board: 'Beta',
        sourceHash: 'b'.repeat(64),
      }),
      projectEntry('alpha', 'C:\\alpha', { board: 'Alpha' }),
    ]),
  )
})

test('absent and malformed bytes are distinct typed empty states', () => {
  const absent = parseRegistry(null)
  const malformed = parseRegistry(Buffer.from('{', 'utf8'))
  const bom = parseRegistry(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), registryBytes([])]))
  assert.equal(absent.status, 'absent')
  assert.equal(malformed.status, 'malformed')
  assert.equal(bom.status, 'malformed')
  assert.deepEqual(absent.projects, [])
  assert.deepEqual(malformed.projects, [])
  assert.deepEqual(bom.projects, [])
})

test('one malformed project rejects the whole desktop registry', () => {
  const valid = projectEntry('valid', 'C:\\valid', { board: 'Valid' })
  const broken = projectEntry('broken', 'C:\\broken', {
    board: 'Broken',
    sourceHash: 'b'.repeat(64),
  })
  delete broken.display_name
  const answer = parseRegistry(registryBytes([valid, broken]))
  assert.equal(answer.status, 'malformed')
  assert.deepEqual(answer.projects, [])
  assert.match(answer.reason, /display_name/)
})

test('duplicate project identity rejects the whole desktop registry', () => {
  const first = projectEntry('same', 'C:\\first', { board: 'First' })
  const second = projectEntry('same', 'C:\\second', {
    board: 'Second',
    sourceHash: 'b'.repeat(64),
  })
  const answer = parseRegistry(registryBytes([first, second]))
  assert.equal(answer.status, 'malformed')
  assert.deepEqual(answer.projects, [])
})

test('opaque planning identity is retained but cannot resolve as canonical Planning JSON', () => {
  const legacyBinding = {
    resource_ref: {
      kind: 'planning-space',
      resource_id:
        'eyJib2FyZF9uYW1lIjoiU2FtcGxlIiwiZGF0YV9zY29wZV9pZCI6IjIyMjIyMjIyLTIyMjItNDIyMi04MjIyLTIyMjIyMjIyMjIyMiJ9',
    },
  }
  const answer = parseRegistry(
    registryBytes([
      projectEntry('sample', 'C:\\sample', {
        board: 'Sample',
        bindings: [legacyBinding],
      }),
    ]),
  )
  assert.equal(answer.status, 'available')
  assert.deepEqual(answer.projects[0].planning_binding, legacyBinding.resource_ref)
  assert.equal(
    resolveResourceRoot(legacyBinding.resource_ref, { readBytes: () => registryBytes([]) }).status,
    'malformed',
  )
})

test('registry maps one exact resource binding without normalizing its canonical root', () => {
  const root = 'C:\\trusted'
  const resourceRef = planningResource()
  const raw = registryBytes([
    projectEntry('sample', root, {
      board: 'Presentation only',
      bindings: [{ resource_ref: resourceRef }],
    }),
  ])
  const answer = resolveResourceRoot(resourceRef, {
    readBytes: () => raw,
    directoryExists: (value) => value === root,
  })
  assert.equal(answer.status, 'mapped')
  assert.equal(answer.canonical_root, root)
  assert.deepEqual(answer.resource_ref, resourceRef)
  assert.equal(
    resolveResourceRoot(planningResource('OTHER'), {
      readBytes: () => raw,
      directoryExists: () => true,
    }).status,
    'missing',
  )
})

test('a relative canonical root is malformed before process cwd can resolve it', () => {
  const resourceRef = planningResource()
  let directoryChecks = 0
  const answer = resolveResourceRoot(resourceRef, {
    readBytes: () =>
      registryBytes([
        projectEntry('sample', 'relative-root', {
          board: 'Presentation only',
          bindings: [{ resource_ref: resourceRef }],
        }),
      ]),
    directoryExists() {
      directoryChecks += 1
      return true
    },
  })
  assert.equal(answer.status, 'malformed')
  assert.match(answer.reason, /absolute/)
  assert.equal(directoryChecks, 0)
})

test('renderer roots and observed cwd cannot replace a missing owner mapping', () => {
  const resourceRef = planningResource()
  const mapped = trustedTarget(
    {
      resource_ref: resourceRef,
      cwd: 'C:\\observed',
      session_cwd: 'C:\\observed',
    },
    {
      readBytes: () =>
        registryBytes([
          projectEntry('sample', 'C:\\trusted', {
            board: 'Presentation only',
            bindings: [{ resource_ref: resourceRef }],
          }),
        ]),
      directoryExists: (value) => value === 'C:\\trusted',
    },
  )
  assert.equal(mapped.effective_cwd, 'C:\\trusted')
  assert.notEqual(mapped.effective_cwd, 'C:\\evil')

  const unbound = trustedTarget(
    { resource_ref: resourceRef, session_cwd: 'C:\\observed' },
    {
      readBytes: () => registryBytes([projectEntry('sample', 'C:\\trusted', { board: 'SAMPLE' })]),
      directoryExists: () => true,
    },
  )
  assert.equal(unbound.status, 'missing')
  assert.equal(unbound.effective_cwd, '')
  assert.equal(unbound.session_cwd, 'C:\\observed')
  assert.equal(unbound.fallback, false)
  assert.equal(unbound.source, 'host_runtime')
  assert.equal(Object.hasOwn(unbound, 'registry_path'), false)
})

test('non-canonical or non-Planning resource identities are refused before lookup', () => {
  let reads = 0
  const options = {
    readBytes: () => {
      reads += 1
      return registryBytes([])
    },
  }
  assert.equal(resolveResourceRoot(null, options).status, 'missing')
  assert.equal(
    resolveResourceRoot({ kind: 'project', project_id: 'sample' }, options).status,
    'malformed',
  )
  assert.equal(
    resolveResourceRoot({ kind: 'planning-space', resource_id: 'opaque' }, options).status,
    'malformed',
  )
  assert.equal(reads, 0)
})

test('desktop registry and opener expose no alternate path or object-reader seam', () => {
  const registrySource = fs.readFileSync(path.join(__dirname, 'project_registry.js'), 'utf8')
  const openerSource = fs.readFileSync(path.join(__dirname, 'session_opener.js'), 'utf8')
  assert.doesNotMatch(registrySource, /registryPath\s*[:=]/)
  assert.doesNotMatch(registrySource, /readRegistry\s*[:=]/)
  assert.doesNotMatch(openerSource, /\bregistryPath\b|\breadRegistry\b/)
  assert.doesNotMatch(registrySource, /resolveBoardRoot|request\?\.board|project\.board\s*===/)
  assert.doesNotMatch(openerSource, /\bboard_root\b|\brequest\.board\b/)
})
