import { defineComponent, h } from 'vue'

/**
 * What a quota window says in each state it can be in, held to DESIGN.md § Analytics rather than
 * to the code. A window that stands says its share and its forecast «by the reset» or «before the
 * reset», which are still ahead; one past its reset spends nothing more, so it says the share it
 * ended at, «62% by the reset», as a past window does, and that the limit ran out before it where a
 * reading reached 100 %, and never «before the reset: 62%», which read as what is left until a
 * reset to come. Every share kind alike, in both languages.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'

import type { QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { analyticsI18n } from '../support/analyticsReads.ts'

const HOUR = 3_600_000
/** The panel's moment, written at Moscow's offset as the read writes it. */
const TODAY = '2026-11-11T10:00:00.000+03:00'
const NOW = Date.parse(TODAY)

/** An instant as the read writes it, at the answer's offset. */
const at = (ms: number) => `${new Date(ms + 3 * HOUR).toISOString().slice(0, 23)}+03:00`

type Kind = QuotaShareWindow['kind']
const LENGTH: Record<Kind, number> = {
  five_hour: 5 * HOUR,
  week: 168 * HOUR,
  week_model: 168 * HOUR,
}

/**
 * A window of `kind` whose reset is `left` ms from the panel's moment, before it where negative,
 * last read at `used` % by `source` an hour before its reset or the moment, whichever is earlier.
 */
function window(
  kind: Kind,
  {
    used,
    left,
    source = 'mod',
  }: { left: number; used: number; source?: 'mod' | 'poll' | 'import' },
): QuotaShareWindow {
  const reset = NOW + left
  const read = Math.min(reset, NOW) - HOUR
  const reading = { at: at(read), used_percent: used, source }
  return {
    kind,
    model: kind === 'week_model' ? 'model-a' : null,
    state: 'fresh',
    resets_at: at(reset),
    latest: reading,
    started_at: at(reset - LENGTH[kind]),
    even_percent: null,
    readings: [reading],
    restarts: [],
    previous: null,
    forecast: null,
  }
}

/** A host that renders nothing, for words read in a component's setup. */
const renderNothing = () => h('span')

function wordsIn(locale: 'en' | 'ru') {
  let words: ReturnType<typeof useQuotaWords> | undefined
  mount(
    defineComponent({
      setup() {
        words = useQuotaWords()
        return renderNothing
      },
    }),
    { global: { plugins: [analyticsI18n(locale)] } },
  )
  if (!words) throw new Error('no words')
  return words
}

/** Words as a reader reads them: a figure and its unit are kept together with a no-break space. */
const plain = (text: string) => text.replaceAll('\u{A0}', ' ')

const KINDS: Kind[] = ['five_hour', 'week', 'week_model']

describe('a window past its reset', () => {
  it.each(KINDS)('%s says the share it ended at, by the reset', (kind) => {
    const ended = window(kind, { used: 62, left: -HOUR })
    const en = wordsIn('en')
    const ru = wordsIn('ru')
    expect(plain(en.ended(ended, NOW, TODAY)?.before ?? '')).toBe('62% by the reset')
    expect(plain(ru.ended(ended, NOW, TODAY)?.before ?? '')).toBe('62 % к сбросу')
    // The bar's words for a reader who cannot see it say the same.
    expect(plain(en.barLabel(ended, NOW, TODAY, 900))).toMatch(/; 62% by the reset$/u)
    expect(plain(ru.barLabel(ended, NOW, TODAY, 900))).toMatch(/; 62 % к сбросу$/u)
  })

  it.each(KINDS)('%s says the limit ran out before the reset where it did', (kind) => {
    const spent = window(kind, { used: 100, left: -HOUR })
    expect(plain(wordsIn('en').ended(spent, NOW, TODAY)?.before ?? '')).toBe(
      '100% by the reset · the limit ran out before it',
    )
    expect(plain(wordsIn('ru').ended(spent, NOW, TODAY)?.before ?? '')).toBe(
      '100 % к сбросу · лимит закончился раньше сброса',
    )
  })

  it('never says «before the reset:» nor «до сброса:» in any state of any kind', () => {
    const states = KINDS.flatMap((kind) => [
      window(kind, { used: 40, left: 2 * HOUR }),
      window(kind, { used: 40, left: -HOUR }),
      window(kind, { used: 100, left: -HOUR }),
    ])
    for (const locale of ['en', 'ru'] as const) {
      const words = wordsIn(locale)
      const said = states.flatMap((one) => [
        words.ended(one, NOW, TODAY)?.lead ?? '',
        words.ended(one, NOW, TODAY)?.before ?? '',
        words.barLabel(one, NOW, TODAY, 900),
        words.reset(one, NOW, TODAY),
      ])
      expect(said.filter(Boolean).length).toBeGreaterThan(states.length)
      for (const text of said) expect(text).not.toMatch(/before the reset:|до сброса:/u)
    }
  })

  it('stands, and says no ended share, while its reset is ahead', () => {
    expect(wordsIn('en').ended(window('week', { used: 40, left: HOUR }), NOW, TODAY)).toBeNull()
  })
})
