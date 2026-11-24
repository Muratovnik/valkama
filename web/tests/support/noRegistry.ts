/**
 * The space window's client for a spec about something else: the project registry answers that
 * it holds no project, so the line of projects in no space draws nothing and nothing reaches the
 * network. Vitest hoists `vi.mock` per file, so each spec that mounts «All spaces» or its empty
 * state names this module in its own mock.
 */
import { vi } from 'vitest'

export async function noRegistryModule() {
  const actual = await vi.importActual<typeof import('@/shared/api/spaceWindowApi.ts')>(
    '@/shared/api/spaceWindowApi.ts',
  )
  return {
    ...actual,
    fetchRegisteredProjects: vi.fn(async () => ({
      registry: { status: 'available' as const, reason: '' },
      projects: [],
    })),
  }
}
