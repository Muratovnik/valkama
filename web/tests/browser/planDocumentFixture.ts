/**
 * The project's files as the backend double knows them: the plan the fixture's item
 * points at, one Markdown file at the root, and a source file. Anything else is not there.
 */
export const PLAN_PATH = 'docs/plans/platform.md'

/** Long enough that landing on the anchor has to scroll. */
const PLAN = `# The platform plan

${'Why this plan exists, in a paragraph long enough to wrap at any width.\n\n'.repeat(40)}
## The architecture <!-- kb:arch-plan -->

The block an anchor lands on.

${'What follows it, so that the block can stand at the top.\n\n'.repeat(40)}`

const KNOWN: Record<string, object> = {
  [PLAN_PATH]: { status: 'file', project: 'demo', relative: PLAN_PATH, markdown: true },
  'src/a.ts': { status: 'file', project: 'demo', relative: 'src/a.ts', markdown: false },
}

export function resolvedPaths(paths: readonly string[]) {
  return paths.map((path) => ({ path, ...(KNOWN[path] ?? { status: 'missing' }) }))
}

export function projectDocument(path: string) {
  if (path !== PLAN_PATH) return null
  return {
    project: 'demo',
    path,
    markdown: PLAN,
    size: PLAN.length,
    modified_at: '2026-11-03T15:12:09Z',
    revision: '9f2c41d0a7b3e655',
  }
}
