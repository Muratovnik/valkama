/**
 * No sentence of the Analytics page doubles its full stop after a period or a day named in it.
 * A period named by its days ends in a month cut short in Russian, «2–5 нояб.», so a message that
 * ends in the name and is closed by a stop — its own, or the one a hint adds between sentences —
 * read «нояб..». The oracle is the reader's: one stop where a sentence ends, in both languages,
 * whatever label the message is given.
 */
import { describe, expect, it } from 'vitest'

import { messages } from '@/shared/i18n/index.ts'
import { sentences } from '@/shared/lib/sentences.ts'

import { flatten } from './fixtures/analyticsWords.ts'

/** The placeholders a period, a day or a date is put into. */
const LABELS = new Set(['period', 'day', 'date', 'from', 'to'])
/** A label that ends in a stop of its own, as the shortest Russian months do. */
const CUT_SHORT = '2–5 нояб.'

/** A message as the page says it: each label ending in its stop, anything else a word. */
const said = (message: string) =>
  message.replaceAll(/\{(\w+)\}/gu, (_, name: string) => (LABELS.has(name) ? CUT_SHORT : 'x'))

const LOCALES = ['en', 'ru'] as const

describe.each(LOCALES)('the analytics messages in %s', (locale) => {
  const all = flatten(messages[locale].analytics, 'analytics')
  const labelled = all.filter(([, message]) =>
    [...message.matchAll(/\{(\w+)\}/gu)].some(([, name = '']) => LABELS.has(name)),
  )

  it('name periods and days', () => {
    // The check below would pass over a catalog it no longer reads.
    expect(labelled.length).toBeGreaterThan(10)
  })

  it('never close a sentence with a stop right after a label', () => {
    const doubled = labelled
      .filter(([, message]) => said(message).includes('..'))
      .map(([key]) => key)
    expect(doubled).toEqual([])
  })

  it('end with one stop when a sentence follows them, as in a hint', () => {
    const doubled = labelled
      .map(([key, message]) => [key, sentences([said(message), 'Next'])] as const)
      .filter(([, text]) => text.includes('..') || !/[.…!?] Next$/u.test(text))
      .map(([key, text]) => `${key}: ${text}`)
    expect(doubled).toEqual([])
  })
})

describe('sentences', () => {
  it('closes each sentence but the last with one stop and leaves out the empty ones', () => {
    expect(sentences(['Tokens', '', null, '↓ 55% к периоду 2–5 нояб.', 'Read anew', 'last'])).toBe(
      'Tokens. ↓ 55% к периоду 2–5 нояб. Read anew. last',
    )
  })
})
