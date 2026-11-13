/**
 * The inventory of the Analytics page's words holds every message the page has, and the words
 * keep the rules the inventory serves: a caveat is a whole sentence, said in a section's «ⓘ»
 * (`production-analytics-words.spec.ts` reads it there), and no word of the page is «пока» or
 * its English «so far», a calque that read as a goodbye under the period still running.
 */
import { describe, expect, it } from 'vitest'

import { messages } from '@/shared/i18n/index.ts'

import { ANALYTICS_WORDS, CAVEATS, entryOf, flatten } from './fixtures/analyticsWords.ts'

const LOCALES = ['en', 'ru'] as const

describe.each(LOCALES)('the analytics words in %s', (locale) => {
  const all = flatten(messages[locale].analytics, 'analytics')

  it('are each of one kind in the inventory', () => {
    expect(all.length).toBeGreaterThan(250)
    expect(all.filter(([key]) => !entryOf(key)).map(([key]) => key)).toEqual([])
  })

  it('leave no entry of the inventory that holds no message', () => {
    const used = new Set(all.map(([key]) => entryOf(key)))
    expect(Object.keys(ANALYTICS_WORDS).filter((entry) => !used.has(entry))).toEqual([])
  })

  it('say each caveat as a sentence of its own, with nothing to fill in', () => {
    const caveats = all.filter(([key]) => ANALYTICS_WORDS[entryOf(key) ?? ''] === 'caveat')
    expect(caveats.map(([key]) => key).sort()).toEqual(Object.keys(CAVEATS).sort())
    for (const [key, text] of caveats) {
      expect(text, key).toMatch(/^\p{Lu}.*[.]$/u)
      expect(text, key).not.toMatch(/\{\w+\}/u)
    }
  })

  it('never say «пока» or «so far»', () => {
    const said = all.filter(([, text]) => /(?<!\p{L})пока(?!\p{L})|\bso far\b/iu.test(text))
    expect(said.map(([key]) => key)).toEqual([])
  })
})
