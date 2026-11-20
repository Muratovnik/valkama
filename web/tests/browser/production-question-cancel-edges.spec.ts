/**
 * The list a triage group's refusal shows over its answers, measured at 1280px and 390px in
 * both languages with the scroll bars drawn, as the reader sees the panel. Its lists have no
 * marks, so each stands on the column's edge under the line over it: indented, they stood 20px
 * in from it, as a question's conditions once did.
 */
import { expect } from '@playwright/test'

import { refuse, WAITING } from './questionGroupsPage.ts'
import { test } from './test.ts'

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })
for (const width of [1280, 390])
  for (const locale of ['en', 'ru'] as const)
    test(`at ${width}px in ${locale} a refusal's lists start where its first line does`, async ({
      page,
    }) => {
      const { listed } = await refuse(page, { locale, width }, WAITING)
      await expect(listed.locator('[data-cancel-part]')).toHaveCount(2)
      const edges = await listed.evaluate((list) => {
        /** Where the first letter of an element's words stands. */
        function firstLetter(element: Element) {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const at = node.textContent?.search(/\S/u) ?? -1
            if (at < 0) continue
            const range = document.createRange()
            range.setStart(node, at)
            range.setEnd(node, at + 1)
            return range.getBoundingClientRect().left
          }
          return Number.NaN
        }
        return {
          column: list.getBoundingClientRect().left,
          lead: firstLetter(list.querySelector('[role="alert"]') as Element),
          rows: [...list.querySelectorAll('[data-cancel-part] > li')].map((row) =>
            firstLetter(row),
          ),
        }
      })
      const said = JSON.stringify(edges)
      expect(edges.rows, said).toHaveLength(2)
      expect(Math.abs(edges.lead - edges.column), said).toBeLessThanOrEqual(0.5)
      for (const row of edges.rows)
        expect(Math.abs(row - edges.lead), said).toBeLessThanOrEqual(0.5)
    })
