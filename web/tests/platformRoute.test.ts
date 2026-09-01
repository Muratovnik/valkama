import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  parsePlatformRoute,
  resolvePlatformRoute,
  roundTripPlatformRoute,
  serializePlatformRoute,
} from '@/shared/api/platformRoute.ts'

test('canonical route round-trips every built-in at global and project scope', () => {
  const modules = [
    'planning',
    'sessions',
    'analytics',
    'improvements',
    'skills',
    'settings',
  ] as const
  for (const module_id of modules) {
    const global = { module_id, scope: { kind: 'global' as const } }
    assert.deepEqual(roundTripPlatformRoute(global), global)
    const project = {
      module_id,
      scope: { kind: 'project' as const, project_ref: { project_id: 'project-rd' } },
    }
    assert.deepEqual(roundTripPlatformRoute(project), project)
  }
})
test('entity and module-local state are canonical base64url JSON', () => {
  const route = {
    module_id: 'planning' as const,
    scope: { kind: 'global' as const },
    entity: { kind: 'work-item' as const, resource_id: 'opaque-work-item-42' },
    state: { view: 'board', query: 'urgent' },
  }
  const url = serializePlatformRoute(route)
  assert.match(url, /^\/modules\/planning\/global\?entity=[A-Za-z0-9_-]+&state=[A-Za-z0-9_-]+$/)
  assert.deepEqual(parsePlatformRoute(url), route)
})

test('route rejects every unknown or repeated query key and malformed route namespace', () => {
  for (const suffix of ['?unexpected=value', '?adapter=evil', '?entity=x&entity=y']) {
    assert.throws(() => parsePlatformRoute(`/modules/planning/global${suffix}`))
  }
  assert.equal(parsePlatformRoute('/modules/nope/global').module_id, 'nope')
  assert.throws(() => parsePlatformRoute('/modules/adapter.fake/global'), /invalid module id/)
  assert.throws(() => parsePlatformRoute('/modules/planning'), /expected \/modules/)
  assert.throws(() => parsePlatformRoute('/modules/planning/project/'), /project id is required/)
  assert.throws(
    () => parsePlatformRoute('/modules/planning/project/Project%2FR%26D/extra'),
    /invalid operating scope/,
  )
})

test('route rejects non-canonical entity/state payloads and mismatched project entity', () => {
  const projectCard = { kind: 'project', project_id: 'other' }
  const encoded = Buffer.from(JSON.stringify(projectCard), 'utf8').toString('base64url')
  assert.throws(
    () => parsePlatformRoute(`/modules/planning/project/current?entity=${encoded}`),
    /does not match route project/,
  )
  const pretty = Buffer.from('{ "query": "x" }', 'utf8').toString('base64url')
  assert.throws(() => parsePlatformRoute(`/modules/planning/global?state=${pretty}`), /canonical/)
  assert.throws(() => parsePlatformRoute('/modules/planning/global?state=not-base64!'), /base64url/)
})

test('syntactically valid future module routes await persisted authority', () => {
  const resolved = resolvePlatformRoute('/modules/future-module/global')
  assert.equal(resolved.module_id, 'future-module')
  assert.deepEqual(resolved.scope, { kind: 'global' })
  assert.equal(parsePlatformRoute('/modules/future-module/global').module_id, 'future-module')
  assert.throws(() => resolvePlatformRoute('/modules/adapter.fake/global'), /invalid module id/)
})

test('base64url tokens reject aliases, padding, pollution keys, and excessive depth', () => {
  const alias = 'e31' // decodes to {} but carries non-zero unused base64 bits
  assert.throws(() => parsePlatformRoute(`/modules/planning/global?state=${alias}`), /canonical/)
  assert.throws(() => parsePlatformRoute('/modules/planning/global?state=e30='), /base64url/)
  const pollution = Buffer.from('{"__proto__":1}', 'utf8').toString('base64url')
  assert.throws(
    () => parsePlatformRoute(`/modules/planning/global?state=${pollution}`),
    /prototype-pollution|canonical/,
  )
  let nested = '0'
  for (let index = 0; index < 40; index += 1) nested = `{"x":${nested}}`
  const deep = Buffer.from(nested, 'utf8').toString('base64url')
  assert.throws(
    () => parsePlatformRoute(`/modules/planning/global?state=${deep}`),
    /depth|module state/,
  )
})

test('project IDs and module versions remain canonical', () => {
  assert.throws(
    () =>
      serializePlatformRoute({
        module_id: 'planning',
        scope: { kind: 'project', project_ref: { project_id: 'Project/R&D' } },
      }),
    /project id|project_id/,
  )
  assert.throws(
    () => parsePlatformRoute('/modules/planning/project/Project%2FR%26D'),
    /invalid project id/,
  )
  for (const accepted of ['a', 'project-1', `a${'b'.repeat(159)}`]) {
    const route = {
      module_id: 'planning' as const,
      scope: { kind: 'project' as const, project_ref: { project_id: accepted } },
    }
    assert.deepEqual(roundTripPlatformRoute(route), route)
  }
  for (const rejected of ['', 'Project', '1project', 'project_name', `a${'b'.repeat(160)}`]) {
    assert.throws(
      () =>
        serializePlatformRoute({
          module_id: 'planning',
          scope: { kind: 'project', project_ref: { project_id: rejected } },
        }),
      /project id|project_id/,
    )
  }
})
