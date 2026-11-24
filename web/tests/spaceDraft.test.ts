/**
 * The space window's draft: what it starts from, what it lets the reader do before a save,
 * and the save it sends. The oracle is the window's contract in `docs/connection-contract.md`
 * («The owner's space window») and DESIGN.md: a space with projects has exactly one default;
 * the default has no remove while the space has others; a project that is another space's
 * default while that space keeps others cannot be added; a creation sends no `space`, an edit
 * names the space it started from.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  draftChanged,
  draftGap,
  draftOf,
  emptyDraft,
  projectChoices,
  projectIdOf,
  removable,
  saveOf,
  withDefault,
  withFreshProject,
  withoutProject,
  withProject,
} from '@/features/space-window/spaceDraft.ts'

import type { RegisteredProject } from '@/shared/api/spaceWindowApi.ts'

const SCOPE = '11111111-1111-4111-8111-111111111111'
const ATL = { data_scope_id: SCOPE, space_key: 'ATL' }
const NW = { data_scope_id: SCOPE, space_key: 'NW' }

const project = (id: string, space: typeof ATL | null, isDefault = false): RegisteredProject => ({
  project_id: id,
  display_name: id,
  root: `D:/code/${id}`,
  space,
  default: isDefault,
})

const REGISTERED = [
  project('atlas-web', ATL, true),
  project('atlas-api', ATL),
  project('lighthouse', null),
  project('nw-app', NW, true),
  project('nw-tools', NW),
]

const FORM = { name: 'Atlas', key: 'ATL', key_locked: true, work_items: 214 }
const row = (id: string) => ({
  project_id: id,
  display_name: id,
  root: `D:/code/${id}`,
  fresh: false,
})

describe('the draft of an edited space', () => {
  test('starts from the space’s projects as the registry binds them, its default included', () => {
    const { origin, draft } = draftOf(ATL, FORM, REGISTERED)
    assert.deepEqual(
      draft.projects.map((one) => one.project_id),
      ['atlas-web', 'atlas-api'],
    )
    assert.equal(draft.default, 'atlas-web')
    assert.equal(origin.keyLocked, true)
    assert.equal(draftChanged(draft, origin), false)
  })

  test('the default has no remove while the space has others, and has one once alone', () => {
    const { draft } = draftOf(ATL, FORM, REGISTERED)
    assert.equal(removable(draft, 'atlas-web'), false)
    assert.equal(withoutProject(draft, 'atlas-web'), draft)
    const alone = withoutProject(draft, 'atlas-api')
    assert.equal(removable(alone, 'atlas-web'), true)
    const none = withoutProject(alone, 'atlas-web')
    assert.deepEqual(none.projects, [])
    assert.equal(none.default, null)
  })

  test('changing the default, adding and removing a project are changes; undoing them is not', () => {
    const { origin, draft } = draftOf(ATL, FORM, REGISTERED)
    assert.equal(draftChanged(withDefault(draft, 'atlas-api'), origin), true)
    const added = withProject(draft, row('lighthouse'))
    assert.equal(draftChanged(added, origin), true)
    assert.equal(draftChanged(withoutProject(added, 'lighthouse'), origin), false)
    assert.equal(draftChanged({ ...draft, name: 'Atlas 2' }, origin), true)
  })

  test('the save names the space it started from and one default among its projects', () => {
    const { origin, draft } = draftOf(ATL, FORM, REGISTERED)
    const save = saveOf(withDefault(withProject(draft, row('lighthouse')), 'lighthouse'), origin)
    assert.deepEqual(save, {
      space: ATL,
      name: 'Atlas',
      key: 'ATL',
      projects: [
        { project_id: 'atlas-web', default: false },
        { project_id: 'atlas-api', default: false },
        { project_id: 'lighthouse', default: true },
      ],
      new_projects: [],
    })
  })
})

describe('a new space', () => {
  test('its first project becomes the default, and the save sends no space', () => {
    const draft = withProject({ ...emptyDraft(), name: ' Atlas ', key: 'ATL' }, row('lighthouse'))
    assert.equal(draft.default, 'lighthouse')
    const save = saveOf(withProject(draft, row('nw-tools')), null)
    assert.equal('space' in save, false)
    assert.deepEqual(save, {
      name: 'Atlas',
      key: 'ATL',
      projects: [
        { project_id: 'lighthouse', default: true },
        { project_id: 'nw-tools', default: false },
      ],
      new_projects: [],
    })
  })

  test('is sendable only with a name and a key of the key’s form', () => {
    assert.equal(draftGap(emptyDraft()), 'name')
    assert.equal(draftGap({ ...emptyDraft(), name: 'Атлас' }), 'key')
    assert.equal(draftGap({ ...emptyDraft(), name: 'Атлас', key: '1AB' }), 'key')
    assert.equal(draftGap({ ...emptyDraft(), name: 'Атлас', key: 'A' }), 'key')
    assert.equal(draftGap({ ...emptyDraft(), name: 'Атлас', key: 'ATL' }), null)
  })

  test('a folder’s project is registered by the save and leaves it again when removed', () => {
    const fresh = {
      project_id: 'atlas-docs',
      display_name: 'Atlas docs',
      canonical_root: 'D:/code/atlas-docs',
    }
    const draft = withFreshProject({ ...emptyDraft(), name: 'Atlas', key: 'ATL' }, fresh)
    assert.deepEqual(saveOf(draft, null).new_projects, [fresh])
    assert.equal(draft.projects[0]?.fresh, true)
    assert.deepEqual(withoutProject(draft, 'atlas-docs').fresh, [])
  })
})

describe('the list «Add project»', () => {
  test('offers projects in no space first, then others’, and holds another space’s default', () => {
    const { draft } = draftOf(ATL, FORM, REGISTERED)
    const choices = projectChoices(draft, REGISTERED, ATL)
    assert.deepEqual(
      choices.map((one) => [one.project.project_id, one.from?.space_key ?? null, one.held]),
      [
        ['lighthouse', null, false],
        ['nw-app', 'NW', true],
        ['nw-tools', 'NW', false],
      ],
    )
  })

  test('a default alone in its space can move, and a project the draft dropped is in no space', () => {
    const registered = [project('atlas-web', ATL, true), project('solo', NW, true)]
    const { draft } = draftOf(ATL, FORM, registered)
    const dropped = withoutProject(draft, 'atlas-web')
    const choices = projectChoices(dropped, registered, ATL)
    assert.deepEqual(
      choices.map((one) => [one.project.project_id, one.from?.space_key ?? null, one.held]),
      [
        ['atlas-web', null, false],
        ['solo', 'NW', false],
      ],
    )
  })
})

describe('a folder’s project id', () => {
  test('is the folder’s name in a project id’s form, or nothing that form takes', () => {
    assert.equal(projectIdOf('D:\\code\\Atlas Docs\\'), 'atlas-docs')
    assert.equal(projectIdOf('/srv/code/atlas_web'), 'atlas-web')
    assert.equal(projectIdOf('D:/code/2024-notes'), 'notes')
    assert.equal(projectIdOf('D:/code/Заметки'), '')
  })
})
