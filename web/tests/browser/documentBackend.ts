import type { Locator, Page } from '@playwright/test'

import { NESTED, NESTED_PATH } from './nestedDocumentFixture.ts'
import { asked, openQuestion } from './questionBackend.ts'

/**
 * A project with Markdown files in it, and a card whose question names one, for the journeys
 * that open a document: over what it was opened from, and beside it.
 */

const PLAN = `---
status: proposed
card: 12
date: 2026-11-03
---

# The migration plan <!-- kb:plan-head -->

Why this plan exists, in a paragraph long enough to wrap at any width this viewer takes,
so that a reader sees how its lines run together instead of breaking where the file does.

See [the notes](notes.md) and [the second part](#part-two). The parser is at \`src/a.ts\`. It waits on MAIN-265.

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

export const LONG_PATH =
  'docs/plans/2026/the-second-half-of-the-year/a-rather-long-directory-name/the-plan-itself.md'

/**
 * A plan named as plans are, with a title longer than any head beside a card holds, the
 * identifiers a plan's table names, and code whose fence says what language it is.
 */
export const NAMED_PATH = 'docs/plans/2026-11-03-document-links.md'
export const IDENTIFIERS = [
  'an_identifier_long_enough_that_it_cannot_wrap_in_a_narrow_column',
  'another_identifier_long_enough_to_be_written_as_code_in_a_cell',
]
const NAMED = `# Document links in the card, and the window a document opens in

| Step | Where |
| --- | --- |
| Read | ${IDENTIFIERS[0]} |
| Write | \`${IDENTIFIERS[1]}\` |

\`\`\`ts title="links.ts"
export const aLineLongEnoughThatAPaneBesideACardScrollsIt = 'inside its own frame and nowhere else'
\`\`\`
`

const FILES: Record<string, string> = {
  'docs/plan.md': PLAN,
  [LONG_PATH]: '# The long way down\n\nA document a long way down.\n',
  [NAMED_PATH]: NAMED,
  'docs/notes.md': '# The notes\n\nBack to [the plan](plan.md#part-two).\n',
  [NESTED_PATH]: NESTED,
}

/** A file past what Valkama shows, and one whose read the server fails. */
export const HUGE_PATH = 'docs/huge.md'
export const BROKEN_PATH = 'docs/broken.md'
const REFUSALS: Record<string, { json: object; status: number }> = {
  [HUGE_PATH]: {
    status: 413,
    json: { error: { code: 'too_large', size: 986 * 1024, limit: 512 * 1024 } },
  },
  [BROKEN_PATH]: { status: 500, json: { error: { code: 'internal' } } },
}

const confirmed = (relative: string) => ({
  status: 'file',
  project: 'demo',
  relative,
  markdown: true,
})

const KNOWN: Record<string, object> = {
  'docs/plan.md': confirmed('docs/plan.md'),
  'docs/notes.md': confirmed('docs/notes.md'),
  'docs/gone.md': confirmed('docs/gone.md'),
  [LONG_PATH]: confirmed(LONG_PATH),
  [NAMED_PATH]: confirmed(NAMED_PATH),
  [NESTED_PATH]: confirmed(NESTED_PATH),
  [HUGE_PATH]: confirmed(HUGE_PATH),
  [BROKEN_PATH]: confirmed(BROKEN_PATH),
  'src/a.ts': { status: 'file', project: 'demo', relative: 'src/a.ts', markdown: false },
}

async function installDocuments(page: Page) {
  await page.route('**/api/documents/resolve*', async (route) => {
    const paths = new URL(route.request().url()).searchParams.getAll('path')
    await route.fulfill({
      json: { paths: paths.map((path) => ({ path, ...(KNOWN[path] ?? { status: 'missing' }) })) },
    })
  })
  await page.route('**/api/documents/read*', async (route) => {
    const path = new URL(route.request().url()).searchParams.get('path') ?? ''
    const markdown = FILES[path]
    await (markdown === undefined
      ? route.fulfill(REFUSALS[path] ?? { status: 404, json: { error: { code: 'not_found' } } })
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

export const LINK = 'docs/plan.md#kb:a7f3'
export const HUB_TITLE = 'Needs my answer'

export const aCardAsking = (page: Page, prompt: string) =>
  openQuestion(page, [asked({ prompt })], () => installDocuments(page))

/** The link's name says what it opens, and nothing about how the text happens to word it. */
export const linkIn = (scope: Locator, path: string) =>
  scope.getByRole('link', { name: `Open the document in Valkama: ${path}` })
