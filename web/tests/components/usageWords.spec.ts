/**
 * How the numbers of a usage read are said. The oracle is the contract and the owner's rule for
 * the line: cached reads stay out, reasoning is part of output and is not counted twice, and no
 * data is never a zero.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import {
  saysAnything,
  tokensAnew,
  useUsageWords,
} from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import { messages, pluralRules } from '@/shared/i18n/index.ts'

import { NO_TOKENS, noUsage, richUsage, SPENT } from '../fixtures/usage.ts'

const drawsNothing = () => null

function wordsIn(locale: 'en' | 'ru') {
  let words: ReturnType<typeof useUsageWords> | undefined
  mount(
    {
      setup() {
        words = useUsageWords()
        return drawsNothing
      },
    },
    { global: { plugins: [createI18n({ legacy: false, locale, messages, pluralRules })] } },
  )
  if (!words) throw new Error('the words were not set up')
  return words
}

const line = (overrides = {}) => ({
  seconds: 0,
  tokens: NO_TOKENS,
  estimated_api_cost_usd: null,
  ...overrides,
})

describe('the tokens on the line', () => {
  it('add up input, both cache writes and output, and nothing else', () => {
    expect(tokensAnew(SPENT)).toBe(5_000_000 + 11_000_000 + 400_000 + 1_900_000)
  })

  it('count no reasoning apart, which is already in the output', () => {
    expect(tokensAnew({ ...NO_TOKENS, output: 100, reasoning: 40 })).toBe(100)
  })

  it('leave cached reads out, however large', () => {
    expect(tokensAnew({ ...NO_TOKENS, cached_read: 392_000_000 })).toBeNull()
  })

  it('are no data when no request reported any, and not a zero', () => {
    expect(tokensAnew(NO_TOKENS)).toBeNull()
    expect(wordsIn('en').tokens(NO_TOKENS)).toBe('')
  })

  it.each([
    ['en', 1, '1 token'],
    ['en', 850, '850 tokens'],
    ['en', 19_651_453, '19.7M tokens'],
    ['en', 2_345_000_000, '2.3B tokens'],
    ['ru', 1, '1\u{A0}токен'],
    ['ru', 3, '3\u{A0}токена'],
    ['ru', 850, '850\u{A0}токенов'],
    ['ru', 1_001_000, '1\u{A0}млн\u{A0}токенов'],
    ['ru', 19_651_453, '19,7\u{A0}млн\u{A0}токенов'],
    ['ru', 2_345_000_000, '2,3\u{A0}млрд\u{A0}токенов'],
  ] as const)('in %s say %i as «%s»', (locale, input, said) => {
    expect(wordsIn(locale).tokens({ ...NO_TOKENS, input })).toBe(said)
  })
})

describe('a cost', () => {
  it('is said as an estimate', () => {
    expect(wordsIn('en').cost(240.67)).toBe('≈\u{A0}$240.67')
    expect(wordsIn('ru').cost(240.67)).toBe('≈\u{A0}240,67\u{A0}$')
  })

  it('holds a large sum whole', () => {
    expect(wordsIn('en').cost(13_000)).toBe('≈\u{A0}$13,000.00')
  })

  it('is marked when models are left out of it', () => {
    expect(wordsIn('en').cost(12.4, true)).toBe('≈\u{A0}$12.40+')
  })

  it('is no data when nothing had a price, and not a zero', () => {
    expect(wordsIn('en').cost(null)).toBe('')
  })

  it('under a cent does not read as nothing', () => {
    expect(wordsIn('en').cost(0.0004)).toBe('<\u{A0}$0.01')
  })
})

describe('a span of work', () => {
  it('is said in the app’s own two units, marked when it is an estimate', () => {
    expect(wordsIn('en').time(27_521)).toBe('7\u{A0}h\u{A0}38\u{A0}min')
    expect(wordsIn('ru').time(27_521, true)).toBe('≈\u{A0}7\u{A0}ч\u{A0}38\u{A0}мин')
  })

  it('of a second reads as under a minute', () => {
    expect(wordsIn('en').time(1)).toBe('under a minute')
  })

  it('of nothing is not said', () => {
    expect(wordsIn('en').time(0)).toBe('')
  })
})

describe('the figures of a row', () => {
  it('say no data where a row has none, and never a zero', () => {
    const said = wordsIn('en')
      .figures(line({ seconds: 90 }))
      .map((figure) => figure.text)
    expect(said).toEqual(['1\u{A0}min', 'no data', 'no data'])
  })

  it('say that a model called on the side has no time of its own', () => {
    const [time] = wordsIn('en').figures(line({ estimated_api_cost_usd: 66.32 }))
    expect(time.text).toBe('on the side')
  })
})

describe('what the numbers are', () => {
  it('says once that agents worked in parallel when the two times read differently', () => {
    const { notes, ...words } = wordsIn('en')
    expect(words.span(27_520)).not.toBe(words.span(40_480))
    expect(notes(richUsage()).filter((note) => note.includes('in parallel'))).toHaveLength(1)
    const same = richUsage({ elapsed_seconds: 3600, agent_seconds: 3601 })
    expect(notes(same).filter((note) => note.includes('in parallel'))).toHaveLength(0)
  })

  it('says the cost is no bill only where there is a cost', () => {
    const { notes } = wordsIn('ru')
    expect(notes(richUsage()).join(' ')).toContain('не счёт')
    expect(notes(noUsage()).join(' ')).not.toContain('не счёт')
  })

  it('says how much of the time is rebuilt, whole or in part, and nothing when it was seen', () => {
    const { notes } = wordsIn('en')
    expect(notes(richUsage({ quality: 'estimated' })).join(' ')).toContain(
      'The time is an estimate',
    )
    const mixed = notes(richUsage({ quality: 'mixed', estimated_seconds: 3600 })).join(' ')
    expect(mixed).toContain('1\u{A0}h of 11\u{A0}h\u{A0}14\u{A0}min')
    expect(notes(richUsage({ quality: 'observed' })).join(' ')).not.toContain('transcripts')
  })

  it('names the models with no price and says what that does to the cost', () => {
    const { notes } = wordsIn('en')
    const incomplete = notes(richUsage({ unpriced_models: ['one', 'two'] })).join(' ')
    expect(incomplete).toContain('The cost is incomplete: no price for one, two.')
    const unknown = notes(
      richUsage({ estimated_api_cost_usd: null, unpriced_models: ['one'] }),
    ).join(' ')
    expect(unknown).toContain('The cost is unknown: no price for one.')
  })
})

describe('whether a line says anything', () => {
  it('is no when the read has nothing in it', () => {
    expect(saysAnything(line())).toBe(false)
  })

  it('is yes for time alone, tokens alone or a cost alone', () => {
    expect(saysAnything(line({ seconds: 1 }))).toBe(true)
    expect(saysAnything(line({ tokens: { ...NO_TOKENS, cached_read: 5 } }))).toBe(true)
    expect(saysAnything(line({ estimated_api_cost_usd: 0.5 }))).toBe(true)
  })
})
