import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  parsePlatformRoute,
  resolvePlatformRoute,
  roundTripPlatformRoute,
  sameScope,
  serializePlatformRoute,
  withoutQuestionReveal,
  withoutQuestionsAsk,
} from '@/shared/api/platformRoute.ts'

const space = { data_scope_id: '123e4567-e89b-42d3-a456-426614174000', space_key: 'MAIN' }
const spacePath = '/modules/planning/space/123e4567-e89b-42d3-a456-426614174000/MAIN'

const ask = (address: string) => withoutQuestionsAsk(new URL(address, 'http://127.0.0.1:8642'))

test('an address asks for the panel of questions in one spelling, and leaves the rest', () => {
  // The address the listener and the desktop app send, spelled by hand from their copies.
  assert.equal(ask('/modules/planning/global?panel=questions'), '/modules/planning/global')
  assert.equal(
    ask('/modules/planning/global?panel=questions&state=e30'),
    '/modules/planning/global?state=e30',
  )
  for (const other of [
    '/modules/planning/global',
    '/modules/planning/global?panel=other',
    '/modules/planning/global?panel=',
    '/modules/planning/global?panel=questions&panel=questions',
    '/modules/planning/global?state=panel',
  ])
    assert.equal(ask(other), null, other)
})

const reveal = (address: string) => withoutQuestionReveal(new URL(address, 'http://127.0.0.1:8642'))

test('an address asks for a card’s waiting question in one spelling, and leaves the rest', () => {
  // The address the listener and the desktop app send, spelled by hand from their copies.
  assert.equal(reveal(`${spacePath}?entity=abc&reveal=question`), `${spacePath}?entity=abc`)
  assert.equal(
    reveal(`${spacePath}?entity=abc&state=e30&reveal=question`),
    `${spacePath}?entity=abc&state=e30`,
  )
  for (const other of [
    `${spacePath}?entity=abc`,
    `${spacePath}?entity=abc&reveal=other`,
    `${spacePath}?entity=abc&reveal=`,
    `${spacePath}?entity=abc&reveal=question&reveal=question`,
    '/modules/planning/global?panel=questions',
  ])
    assert.equal(reveal(other), null, other)
  // The order is not part of a route, and the canonical grammar never reads it as one.
  assert.throws(() => parsePlatformRoute('/modules/planning/global?reveal=question'))
})

test('canonical route round-trips every built-in at every space, a space and a project of it', () => {
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
    const inSpace = { module_id, scope: { kind: 'space' as const, space_ref: space } }
    assert.deepEqual(roundTripPlatformRoute(inSpace), inSpace)
    const narrowed = {
      module_id,
      scope: {
        kind: 'space' as const,
        space_ref: space,
        project_ref: { project_id: 'project-rd' },
      },
    }
    assert.deepEqual(roundTripPlatformRoute(narrowed), narrowed)
  }
  assert.equal(
    serializePlatformRoute({ module_id: 'planning', scope: { kind: 'space', space_ref: space } }),
    spacePath,
  )
  assert.equal(
    serializePlatformRoute({
      module_id: 'planning',
      scope: { kind: 'space', space_ref: space, project_ref: { project_id: 'project-rd' } },
    }),
    `${spacePath}/project/project-rd`,
  )
})

test('two scopes are one place only in the same space narrowed by the same project', () => {
  const inSpace = { kind: 'space' as const, space_ref: space }
  const narrowed = { ...inSpace, project_ref: { project_id: 'one' } }
  assert.equal(sameScope({ kind: 'global' }, { kind: 'global' }), true)
  assert.equal(sameScope({ kind: 'global' }, inSpace), false)
  assert.equal(sameScope(inSpace, { kind: 'space', space_ref: { ...space } }), true)
  assert.equal(sameScope(inSpace, narrowed), false)
  assert.equal(sameScope(narrowed, { ...inSpace, project_ref: { project_id: 'two' } }), false)
  assert.equal(
    sameScope(inSpace, { kind: 'space', space_ref: { ...space, space_key: 'OTHER' } }),
    false,
  )
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
  assert.throws(() => parsePlatformRoute(`${spacePath}/project/`), /project_id is required/)
  assert.throws(() => parsePlatformRoute(`${spacePath}/extra`), /invalid operating scope/)
  assert.throws(() => parsePlatformRoute('/modules/planning/space/MAIN'), /invalid operating scope/)
})

test('route rejects non-canonical entity and state payloads', () => {
  const pretty = Buffer.from('{ "query": "x" }', 'utf8').toString('base64url')
  assert.throws(() => parsePlatformRoute(`/modules/planning/global?state=${pretty}`), /canonical/)
  assert.throws(() => parsePlatformRoute('/modules/planning/global?state=not-base64!'), /base64url/)
})

test('syntactically valid future module routes await persisted authority', () => {
  const resolved = resolvePlatformRoute('/modules/future-module/global')
  assert.ok('module_id' in resolved, 'a well-formed route is held as a route, not refused')
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

/** Planning in the space, narrowed to this project. */
const narrowed = (project_id: string) => ({
  module_id: 'planning' as const,
  scope: { kind: 'space' as const, space_ref: space, project_ref: { project_id } },
})

test('a space and a project are named only in their canonical spelling', () => {
  assert.throws(
    () => parsePlatformRoute(`${spacePath}/project/Project%2FR%26D`),
    /invalid project_id/,
  )
  for (const accepted of ['a', 'project-1', `a${'b'.repeat(159)}`])
    assert.deepEqual(roundTripPlatformRoute(narrowed(accepted)), narrowed(accepted))
  for (const rejected of ['', 'Project', '1project', 'project_name', `a${'b'.repeat(160)}`])
    assert.throws(() => serializePlatformRoute(narrowed(rejected)), /project id|project_id/)
  for (const path of [
    '/modules/planning/space/123E4567-E89B-42D3-A456-426614174000/MAIN',
    '/modules/planning/space/not-a-store/MAIN',
    '/modules/planning/space/123e4567-e89b-42d3-a456-426614174000/main',
    '/modules/planning/space/123e4567-e89b-42d3-a456-426614174000/M',
  ])
    assert.throws(() => parsePlatformRoute(path), /invalid (data_scope_id|space_key)/, path)
})

test('an address that names a project where a space is now named opens nothing it named', () => {
  for (const address of [
    '/modules/planning/project/example',
    '/modules/analytics/project/example?state=e30',
    '/modules/planning/project/example?entity=anything&state=anything',
  ]) {
    const resolved = resolvePlatformRoute(address)
    assert.ok(!('module_id' in resolved), address)
    assert.deepEqual(resolved, {
      status: 'unavailable',
      reason: 'retired-scope',
      input_module_id: address.split('/')[2],
      input_scope: { kind: 'global' },
      recovery: { kind: 'choose-space' },
    })
  }
  // The strict grammar still refuses the retired form: only resolution answers it.
  assert.throws(() => parsePlatformRoute('/modules/planning/project/example'))
})
