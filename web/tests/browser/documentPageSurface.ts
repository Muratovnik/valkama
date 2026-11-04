import type { BrowserContext, Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { NESTED, NESTED_PATH } from './nestedDocumentFixture.ts'

/**
 * A project's documents as the page of one of them reads them: a plan with a front
 * matter, a table, code, anchors and references of every kind, the notes it links to, and
 * the refusals the server gives. Shared by the specs of `/doc`.
 */

export const SESSION = '12345678-1234-4234-8234-123456789abc'

const PLAN = `---
status: proposed
card: 12
---

# The migration plan <!-- kb:plan-head -->

Why this plan exists, in a paragraph long enough to wrap at any width this page takes, so
that a reader sees how its lines run together instead of breaking where the file does.

It came from MAIN-12, in the session ${SESSION}. See [the notes](notes.md) and \`src/a.ts\`.

| Step | Owner | State | Where it stands | What it still waits for from anyone else |
| --- | --- | --- | --- | --- |
| Read | Person | Done | \`docs/plan.md\` | Nothing at all, it has been finished for a while now |
| Write | an_identifier_long_enough_that_it_cannot_wrap_in_a_narrow_column | Open | here | Time |

\`\`\`text
A line of code long enough that a phone has to scroll it inside its own frame and nowhere else.
\`\`\`

## Part two

${Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1} of the second part.`).join('\n\n')}

## The target <!-- kb:a7f3 -->

The block an anchor lands on, far enough down that landing on it has to scroll.

${Array.from({ length: 30 }, (_, index) => `Closing paragraph ${index + 1}.`).join('\n\n')}
`

const FILES: Record<string, string> = {
  'docs/plan.md': PLAN,
  'docs/notes.md': '# The notes\n\nBack to [the plan](plan.md#part-two).\n',
  [NESTED_PATH]: NESTED,
}

const confirmed = (relative: string, markdown = true) => ({
  status: 'file',
  project: 'demo',
  relative,
  markdown,
})

const KNOWN: Record<string, object> = {
  'docs/plan.md': confirmed('docs/plan.md'),
  'docs/notes.md': confirmed('docs/notes.md'),
  [NESTED_PATH]: confirmed(NESTED_PATH),
  'src/a.ts': confirmed('src/a.ts', false),
}

const REFUSED: Record<string, { code: string; status: number }> = {
  'docs/gone.md': { code: 'not_found', status: 404 },
  '../outside.md': { code: 'outside_root', status: 403 },
}

export async function installDocuments(on: BrowserContext | Page) {
  await on.route('**/api/documents/resolve*', async (route) => {
    const paths = new URL(route.request().url()).searchParams.getAll('path')
    await route.fulfill({
      json: { paths: paths.map((path) => ({ path, ...(KNOWN[path] ?? { status: 'missing' }) })) },
    })
  })
  await on.route('**/api/documents/read*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? ''
    const markdown = FILES[path]
    const refusal = REFUSED[path] ?? { code: 'not_found', status: 404 }
    await (markdown === undefined
      ? route.fulfill({ status: refusal.status, json: { error: { code: refusal.code } } })
      : route.fulfill({
          json: {
            project: 'demo',
            path,
            markdown,
            size: markdown.length,
            modified_at: '2026-11-03T15:12:09Z',
            revision: '9f2c41d0a7b3e655',
          },
        }))
  })
}

export const addressOf = (path: string, fragment = '') =>
  `/doc?project=demo&path=${encodeURIComponent(path)}${fragment}`

export async function openPage(page: Page, path: string, fragment = '') {
  const backend = await installBackend(page)
  await installDocuments(page)
  await page.goto(addressOf(path, fragment))
  return backend
}

export const linkIn = (scope: Locator | Page, path: string) =>
  scope.getByRole('link', { name: `Open the document in Valkama: ${path}` })

export const target = (page: Page) => page.locator('.document-block.is-target')

/** Where a shot goes when a person asks for shots; a run without the setting takes none. */
export async function shot(page: Page, name: string) {
  const folder = process.env.VALKAMA_SHOT_DIR
  if (folder) await page.screenshot({ path: `${folder}/${name}.png` })
}
