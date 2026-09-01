import { describe, expect, it } from 'vitest'

import { validateSkillMatrix } from '@/entities/skill/api/skillMatrixApi.ts'
import { SkillsRequestError } from '@/entities/skill/api/skillsApi.ts'

import { skillMatrixPayload } from './browser/skillsFixtures.ts'

type MatrixFixture = typeof skillMatrixPayload

function matrix(): MatrixFixture {
  return structuredClone(skillMatrixPayload)
}

function firstCell(candidate: MatrixFixture) {
  return candidate.skills[0].cells[0]
}

function expectRefused(candidate: unknown) {
  expect(() => validateSkillMatrix(candidate)).toThrow(SkillsRequestError)
}

describe('skill matrix contract', () => {
  it('accepts the exact bounded comparison contract', () => {
    expect(validateSkillMatrix(matrix())).toEqual(skillMatrixPayload)
  })

  it.each([
    ['envelope', (candidate: MatrixFixture) => Reflect.set(candidate, 'debug', true)],
    ['client', (candidate: MatrixFixture) => Reflect.set(candidate.clients[0], 'label', 'Codex')],
    ['project', (candidate: MatrixFixture) => Reflect.set(candidate.projects[0], 'root', 'C:/')],
    ['skill row', (candidate: MatrixFixture) => Reflect.set(candidate.skills[0], 'body', 'secret')],
    [
      'skill reference',
      (candidate: MatrixFixture) => Reflect.set(candidate.skills[0].skill_ref, 'path', 'C:/'),
    ],
    ['project cell', (candidate: MatrixFixture) => Reflect.set(firstCell(candidate), 'index', 0)],
    [
      'activation cell',
      (candidate: MatrixFixture) =>
        Reflect.set(firstCell(candidate).clients.claude, 'source', 'guess'),
    ],
  ])('rejects an additive field on the %s', (_name, corrupt) => {
    const candidate = matrix()
    corrupt(candidate)
    expectRefused(candidate)
  })

  it('rejects arbitrary status and inconsistent values', () => {
    const arbitrary = matrix()
    firstCell(arbitrary).clients.claude.status = 'sometimes'
    expectRefused(arbitrary)

    const inconsistent = matrix()
    firstCell(inconsistent).clients.claude.status = 'enabled'
    firstCell(inconsistent).clients.claude.enabled = false
    expectRefused(inconsistent)
  })

  it('rejects an arbitrary skill reference', () => {
    const candidate = matrix()
    candidate.skills[0].skill_ref.content_hash = 'not-a-content-hash'
    expectRefused(candidate)
  })

  it('requires exactly one cell for every declared project', () => {
    const duplicate = matrix()
    duplicate.skills[0].cells[1] = structuredClone(duplicate.skills[0].cells[0])
    expectRefused(duplicate)

    const missing = matrix()
    missing.skills[0].cells.pop()
    expectRefused(missing)
  })

  it('requires every cell to carry exactly the declared clients', () => {
    const extra = matrix()
    Reflect.set(firstCell(extra).clients, 'cursor', {
      enabled: null,
      can_toggle: false,
      status: 'unavailable',
      reason: 'client_not_supported',
      project_scope: false,
    })
    expectRefused(extra)

    const missing = matrix()
    Reflect.deleteProperty(firstCell(missing).clients, 'codex')
    expectRefused(missing)

    const scopeMismatch = matrix()
    firstCell(scopeMismatch).clients.claude.project_scope = false
    expectRefused(scopeMismatch)
  })
})
