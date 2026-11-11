/**
 * The browser specs that touch the system clipboard are named in one list, which a run of the
 * allowed set leaves out. A spec that grants or writes the clipboard and is not on it would
 * run with the rest; a name on it that is no longer a spec would let the renamed one back in.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { clipboardListGaps, clipboardSpecs } from './browser/clipboardSpecs.ts'

const suite = fileURLToPath(new URL('browser/', import.meta.url))

function suiteSources(): Map<string, string> {
  return new Map(
    readdirSync(suite)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => [name, readFileSync(`${suite}${name}`, 'utf8')]),
  )
}

const quiet = "import { test } from './test.ts'\ntest('reads', async () => {})\n"

describe('the clipboard specs', () => {
  it('lists every spec of the suite that grants or writes the clipboard, and only specs', () => {
    expect(clipboardListGaps(suiteSources())).toEqual({ unlisted: [], stale: [] })
  })

  it('fails on the suite as it is when one of its clipboard specs is left off', () => {
    const listed = clipboardSpecs.filter((name) => name !== 'production-card-source.spec.ts')
    expect(clipboardListGaps(suiteSources(), listed).unlisted).toEqual([
      'production-card-source.spec.ts',
    ])
  })

  it('catches an unlisted spec that is granted the clipboard', () => {
    const sources = new Map([
      [
        'production-copies.spec.ts',
        "test('copies', async ({ page }) => {\n" +
          "  await page.context().grantPermissions(['clipboard-write'])\n})\n",
      ],
      ['production-quiet.spec.ts', quiet],
    ])
    expect(clipboardListGaps(sources, []).unlisted).toEqual(['production-copies.spec.ts'])
  })

  it('catches an unlisted spec that writes the clipboard through a module it imports', () => {
    const sources = new Map([
      ['ui-copies.spec.ts', "import { copy } from './copyHelper.ts'\ntest('copies', copy)\n"],
      [
        'copyHelper.ts',
        "import './test.ts'\n" +
          'export const copy = ({ page }) =>\n' +
          "  page.evaluate(() => navigator.clipboard.writeText('x'))\n",
      ],
      ['test.ts', "import './copyHelper.ts'\n"],
    ])
    expect(clipboardListGaps(sources, []).unlisted).toEqual(['ui-copies.spec.ts'])
  })

  it('leaves alone a spec that only replaces the clipboard with one kept in the page', () => {
    const stub =
      "Object.defineProperty(navigator, 'clipboard', {\n" +
      '  value: { writeText: (text: string) => Promise.resolve() },\n})\n'
    expect(clipboardListGaps(new Map([['ui-stub.spec.ts', stub]]), []).unlisted).toEqual([])
  })

  it('reports a listed name that is no longer a spec', () => {
    const sources = new Map([['production-card-notes.spec.ts', quiet]])
    expect(
      clipboardListGaps(sources, ['production-card-notes.spec.ts', 'production-gone.spec.ts'])
        .stale,
    ).toEqual(['production-gone.spec.ts'])
  })
})
