/**
 * What the Volumes page says of what its read covers, against a double of the server's read
 * (`volumesDouble`). The oracle is DESIGN.md «Volumes» and the read's contract
 * (`docs/connection-contract.md`): a source the read could not reach is said over the numbers in
 * the words and with the reason the questions window gives it (`coverage`), and an incomplete
 * read with no work shows its zeros under them rather than «There is no work in this scope»;
 * while a store attached beside the main one holds work (`attached_work`), one line over the
 * goals says the sections under the numbers count the main store's spaces alone, and with no
 * such store nothing is said.
 */
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { goalRow, volumesAnswer, volumesDouble } from '../support/volumesDouble.ts'
import type { VolumesInput } from '../support/volumesDouble.ts'
import { forgetShell, GLOBAL, mountPage } from './volumesPageHost.ts'
import type { Page } from './volumesPageHost.ts'

enableAutoUnmount(afterEach)
afterEach(() => {
  vi.unstubAllGlobals()
  forgetShell()
})

/** A store attached beside the main one, which the read could not open. */
const SKIPPED = [
  {
    space_ref: { data_scope_id: '00000000-0000-4000-8000-0000000000bb', space_key: 'BETA' },
    reason: 'store_unreadable',
  },
]

const WORDS = {
  en: {
    incomplete: 'Results are incomplete. Some sources are unavailable.',
    source: 'BETA: Store could not be opened',
    ownStore:
      'Goals, work outside goals, the flow and the estimates count the main store’s spaces only.',
  },
  ru: {
    incomplete: 'Результаты неполные. Некоторые источники недоступны.',
    source: 'BETA: Хранилище не открылось',
    ownStore:
      'Цели, работа вне целей, поток и оценки считают только пространства основного хранилища.',
  },
} as const

function mountTop(input: VolumesInput, locale: 'en' | 'ru' = 'en') {
  const answer = volumesAnswer({
    space: null,
    categories: { ready: 2 },
    goals: [goalRow({ reference: 'MAIN-10', total: 2 })],
    ...input,
  })
  return mountPage(
    volumesDouble(() => answer),
    GLOBAL,
    { locale },
  )
}

/** Whether `first` stands before `second` in the page. */
function before(first: Element, second: Element): boolean {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING)
}

const notes = (page: Page, kind: string) => page.findAll(`[data-coverage-note="${kind}"]`)

describe('what the top of the Volumes page covers', () => {
  for (const locale of ['en', 'ru'] as const) {
    it(`says over the numbers that a source was not read, and which, in ${locale}`, async () => {
      const page = mountTop({ skipped: SKIPPED }, locale)
      await flushPromises()
      const incomplete = notes(page, 'incomplete')
      const sources = notes(page, 'source')
      expect(incomplete).toHaveLength(1)
      expect(incomplete[0]?.text()).toBe(WORDS[locale].incomplete)
      expect(sources.map((line) => line.text())).toEqual([WORDS[locale].source])
      // Over the numbers, which count without the source.
      expect(
        before(
          page.get('[data-coverage-note="source"]').element,
          page.get('[data-number="triage"]').element,
        ),
      ).toBe(true)
    })
  }

  it('says nothing of it while every source was read', async () => {
    const page = mountTop({})
    await flushPromises()
    expect(page.find('[data-number="ready"]').exists()).toBe(true)
    expect(page.findAll('[data-coverage-note]')).toHaveLength(0)
  })

  it('shows the zeros of an incomplete read with no work under the words, not «no work»', async () => {
    const page = mountTop({ skipped: SKIPPED, categories: {}, goals: [] })
    await flushPromises()
    expect(notes(page, 'incomplete')).toHaveLength(1)
    expect(page.get('[data-number="ready"] [data-part="figure"]').text()).toBe('0')
    expect(page.text()).not.toContain('There is no work in this scope')
  })
})

describe('the line over the sections that count the main store alone', () => {
  for (const locale of ['en', 'ru'] as const) {
    it(`stands between the numbers and the goals while an attached store holds work, in ${locale}`, async () => {
      const page = mountTop({ attachedWork: true }, locale)
      await flushPromises()
      const lines = page.findAll('[data-volumes-note="own-store"]')
      expect(lines).toHaveLength(1)
      expect(lines[0]?.text()).toBe(WORDS[locale].ownStore)
      const line = page.get('[data-volumes-note="own-store"]').element
      expect(before(page.get('[data-number="commits"]').element, line)).toBe(true)
      expect(before(line, page.get('tr[data-reference="MAIN-10"]').element)).toBe(true)
    })
  }

  it('is not there when no attached store holds work', async () => {
    const page = mountTop({ attachedWork: false })
    await flushPromises()
    expect(page.find('tr[data-reference="MAIN-10"]').exists()).toBe(true)
    expect(page.findAll('[data-volumes-note="own-store"]')).toHaveLength(0)
  })
})
