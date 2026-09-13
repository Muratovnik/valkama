/**
 * A read-only knowledge provider's answer, as the server gives it.
 *
 * Its own file for the reason the execution fixtures got one: a fixture belongs
 * to the module whose payload it is, and `backend.ts` is a route table rather
 * than a place where every module's data accumulates.
 */

import { now, projectId } from './planningFixtures.ts'

export const memorySearch = {
  interface_version: 'valkama-memory-api',
  project_id: projectId,
  provider_id: 'markdown-knowledge',
  capabilities: ['memory.search', 'memory.read-metadata', 'memory.open', 'memory.health'],
  results: [
    {
      connection_id: 'local',
      resource_type: 'markdown-document',
      external_id: 'decisions/0001-store.md',
      label: 'Store decision',
      observed_at: now,
      metadata: {},
      snippet: 'A ratchet only tightens.',
    },
  ],
  root: 'C:/projects/sample/docs',
  truncated: false,
  health: 'ready',
  reason: null,
}

/**
 * The provider mapping, including a project that cannot answer.
 *
 * The unreachable one is the point: it is listed rather than omitted, because
 * "nothing to say" and "cannot be asked" are different facts and the page
 * exists mostly for the second.
 */
export const memoryProviders = {
  interface_version: 'valkama-memory-api',
  providers: [
    {
      project_id: projectId,
      title: 'Sample',
      provider_id: 'markdown-knowledge',
      capabilities: ['memory.search', 'memory.read-metadata', 'memory.open', 'memory.health'],
      root: 'C:/projects/sample/docs',
      health: 'ready',
      reason: null,
    },
    {
      project_id: 'rootless',
      title: 'Rootless',
      provider_id: 'markdown-knowledge',
      capabilities: ['memory.search', 'memory.read-metadata', 'memory.open', 'memory.health'],
      root: '',
      health: 'unavailable',
      reason: {
        code: 'knowledge_root_absent',
        message: 'docs/ does not exist in this project',
      },
    },
  ],
}

/** Pointers the project's work already carries. No provider is asked for these. */
export const memoryLinks = {
  interface_version: 'valkama-memory-api',
  project_id: projectId,
  links: [
    {
      value: 'memory://record/abc123',
      label: 'Why the cutover was one-way',
      author: 'agent',
      attached_at: now,
      work_item_id: 'wi-0001',
      work_item_title: 'Convert the Board domain',
      work_item_key: 'QA-264',
      space_key: 'QA',
    },
  ],
  truncated: false,
}
