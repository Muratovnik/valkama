import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  fetchSkillDetail,
  SkillsContractError,
  SkillsRequestError,
  updateSkillActivation,
  validateSkillDetail,
  validateSkillsPayload,
} from '@/entities/skill/api/skillsApi.ts'

import { requestBody, requestUrl, withSecurityBootstrap } from './support/request.ts'

test('skill detail failures carry the typed backend cause', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        interface_version: 'skill-detail',
        error: { code: 'skill_file_missing' },
      }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch
  try {
    await assert.rejects(
      () => fetchSkillDetail('global:review'),
      (error: unknown) =>
        error instanceof SkillsRequestError && error.detail_code === 'skill_file_missing',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('skill detail failures without a typed cause stay generic', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => new Response('gateway error', { status: 502 })) as typeof fetch
  try {
    await assert.rejects(
      () => fetchSkillDetail('global:review'),
      (error: unknown) =>
        error instanceof SkillsRequestError && error.detail_code === 'skills_request_failed',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

const payload = {
  interface_version: 'skills',
  as_of: '2026-08-11T00:00:00Z',
  clients: [{ id: 'codex' }, { id: 'claude' }],
  registry: {
    status: 'available',
    source: 'host_runtime',
    project_count: 1,
    total_project_count: 1,
    truncated: false,
    reason: null,
  },
  roots: [
    {
      id: 'global-agent-skills',
      scope: 'global',
      source: 'user-canonical',
      relative_root: '.agents/skills',
      availability: 'available',
      validation: 'valid',
      skill_count: 1,
      truncated: false,
    },
  ],
  projects: [{ id: 'sample', project_title: 'Sample', skill_count: 0, root_status: 'missing' }],
  skills: [
    {
      key: 'global:review',
      directory_name: 'review',
      name: 'review',
      description: 'Review work.',
      scope: 'global',
      source: 'user-canonical',
      project_id: null,
      project_title: null,
      owner_project_id: null,
      owner_project_title: null,
      root_id: 'global-agent-skills',
      skill_ref: {
        provider_id: 'filesystem-catalogue',
        root_id: 'global-agent-skills',
        skill_id: 'review',
        content_hash: null,
      },
      location: '.agents/skills/review/SKILL.md',
      availability: 'available',
      duplicate: false,
      clients: {
        codex: { enabled: true, can_toggle: true, status: 'enabled', reason: null },
        claude: { enabled: false, can_toggle: true, status: 'disabled', reason: null },
      },
      validation: {
        schema: 'agentskills-v1',
        status: 'valid',
        checks: ['frontmatter'],
        code: null,
      },
      capabilities: {
        scripts: false,
        references: false,
        assets: false,
        script_entries: 0,
        reference_entries: 0,
        asset_entries: 0,
        script_entries_truncated: false,
        reference_entries_truncated: false,
        asset_entries_truncated: false,
      },
      metadata: { version: null, license: null, compatibility: null },
      provenance: {
        source: 'filesystem',
        observed_at: '2026-08-11T00:00:00Z',
        content_hash: 'a'.repeat(64),
        duplicate_of: null,
      },
    },
  ],
  summary: { roots: 1, projects: 1, skills: 1, valid: 1, invalid: 0, partial: 0, duplicates: 0 },
}

const detail = {
  interface_version: 'skill-detail',
  key: 'global:review',
  name: 'review',
  location: '.agents/skills/review/SKILL.md',
  content_hash: 'a'.repeat(64),
  markdown: '# Review\n\nUse this for bounded review.',
}

test('accepts the exact read-only skills inventory contract', () => {
  assert.deepEqual(validateSkillsPayload(payload), payload)
})

test('accepts absent registry status and rejects the former missing spelling', () => {
  const absent = {
    ...payload,
    registry: {
      ...payload.registry,
      status: 'absent',
      reason: 'workflow registry is absent',
    },
  }
  assert.deepEqual(validateSkillsPayload(absent), absent)
  assert.throws(
    () =>
      validateSkillsPayload({
        ...absent,
        registry: { ...absent.registry, status: 'missing' },
      }),
    SkillsContractError,
  )
})

test('accepts an exact bounded skill detail and rejects path leaks or additive fields', () => {
  assert.deepEqual(validateSkillDetail(detail), detail)
  for (const mutation of [
    { ...detail, interface_version: 'skills' },
    { ...detail, location: 'C:/Users/name/.agents/skills/review/SKILL.md' },
    { ...detail, markdown: 'x'.repeat(262_145) },
    { ...detail, absolute_path: 'C:/secret' },
  ]) {
    assert.throws(() => validateSkillDetail(mutation), SkillsContractError)
  }
})

test('fetches one selected skill detail with an encoded stable key', async () => {
  const original = globalThis.fetch
  let requested = ''
  globalThis.fetch = (async (url: string | URL | Request) => {
    requested = requestUrl(url)
    return { ok: true, json: async () => detail } as Response
  }) as typeof fetch
  try {
    assert.deepEqual(await fetchSkillDetail('global:review'), detail)
    assert.equal(requested, '/api/modules/skills/detail?key=global%3Areview')
  } finally {
    globalThis.fetch = original
  }
})

test('accepts additive client definitions without widening the inventory schema', () => {
  const extended = {
    ...payload,
    clients: [...payload.clients, { id: 'cursor' }],
    skills: [
      {
        ...payload.skills[0],
        clients: {
          ...payload.skills[0].clients,
          cursor: {
            enabled: null,
            can_toggle: false,
            status: 'unavailable',
            reason: 'client_not_supported',
          },
        },
      },
    ],
  }
  assert.deepEqual(validateSkillsPayload(extended), extended)
})

test('rejects wrong markers, absolute paths, bodies, and malformed stable keys', () => {
  for (const mutation of [
    { ...payload, interface_version: 'skills-old' },
    {
      ...payload,
      skills: [{ ...payload.skills[0], location: 'C:/Users/name/.agents/skills/review/SKILL.md' }],
    },
    { ...payload, skills: [{ ...payload.skills[0], body: 'secret' }] },
    { ...payload, skills: [{ ...payload.skills[0], key: 'review' }] },
  ]) {
    assert.throws(() => validateSkillsPayload(mutation), SkillsContractError)
  }
})

test('rejects silent truncation and untyped registry failures', () => {
  for (const mutation of [
    { ...payload, registry: { ...payload.registry, truncated: true, reason: null } },
    {
      ...payload,
      roots: [
        {
          ...payload.roots[0],
          truncated: true,
          availability: 'available',
          validation: 'valid',
          reason: null,
        },
      ],
    },
  ]) {
    assert.throws(() => validateSkillsPayload(mutation), SkillsContractError)
  }
})

test('updates exactly one client activation and validates the returned inventory', async () => {
  const original = globalThis.fetch
  let request: RequestInit | undefined
  globalThis.fetch = withSecurityBootstrap(async (_url, init) => {
    request = init
    return { ok: true, json: async () => payload } as Response
  })
  try {
    assert.deepEqual(await updateSkillActivation('global:review', 'codex', false), payload)
    assert.equal(request?.method, 'POST')
    assert.equal(new Headers(request?.headers).get('Content-Type'), 'application/json')
    assert.equal(new Headers(request?.headers).get('X-Valkama-Session'), 'S'.repeat(64))
    assert.deepEqual(JSON.parse(requestBody(request?.body)), {
      key: 'global:review',
      client: 'codex',
      enabled: false,
    })
  } finally {
    globalThis.fetch = original
  }
})
