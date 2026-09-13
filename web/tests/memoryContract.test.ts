import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import { fetchMemoryLinks, fetchMemoryProviders, searchMemory } from '@/shared/api/memoryApi.ts'

afterEach(() => vi.unstubAllGlobals())

function respond(payload: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => payload })),
  )
}

test('memory reads reject version skew and project identity drift', async () => {
  respond({ interface_version: 'old-memory-api', providers: [] })
  await assert.rejects(fetchMemoryProviders(), /memory\.providers\.interface_version/)

  respond({
    interface_version: 'valkama-memory-api',
    project_id: 'other',
    links: [],
    truncated: false,
  })
  await assert.rejects(fetchMemoryLinks('sample'), /does not match requested project/)
})

test('memory search rejects duplicate and malformed result identities', async () => {
  const item = {
    connection_id: 'markdown',
    external_id: 'doc.md',
    label: 'Doc',
    metadata: {},
    observed_at: '',
    resource_type: 'markdown-document',
    snippet: '',
  }
  respond({
    interface_version: 'valkama-memory-api',
    project_id: 'sample',
    provider_id: 'markdown',
    capabilities: ['memory.search'],
    root: 'C:/project/docs',
    results: [item, item],
    truncated: false,
    health: 'ready',
    reason: null,
  })
  await assert.rejects(searchMemory('sample', 'doc'), /duplicate memory identity/)
})

test('memory links identify attachments by work item and pointer', async () => {
  const attachment = {
    attached_at: '2026-08-30T00:00:00Z',
    author: 'agent',
    label: 'Shared evidence',
    space_key: 'QA',
    value: 'memory://record/shared',
    work_item_id: 'work-1',
    work_item_key: 'QA-1',
    work_item_title: 'First use',
  }
  respond({
    interface_version: 'valkama-memory-api',
    project_id: 'sample',
    links: [
      attachment,
      {
        ...attachment,
        work_item_id: 'work-2',
        work_item_key: 'QA-2',
        work_item_title: 'Second use',
      },
    ],
    truncated: false,
  })
  const result = await fetchMemoryLinks('sample')
  assert.equal(result.links.length, 2)

  respond({
    interface_version: 'valkama-memory-api',
    project_id: 'sample',
    links: [attachment, attachment],
    truncated: false,
  })
  await assert.rejects(fetchMemoryLinks('sample'), /duplicate memory attachment/)
})
