import { defineComponent, h } from 'vue'

/**
 * What a quota window says in each state it can be in, held to DESIGN.md § Analytics rather than
 * to the code. A window that stands says its share and its forecast «by the reset» or «before the
 * reset», which are still ahead; one past its reset spends nothing more, so it says the share it
 * ended at, «62% by the reset», as a past window does, and that the limit ran out before it where a
 * reading reached 100 %, and never «before the reset: 62%», which read as what is left until a
 * reset to come. Every share kind alike, in both languages.
 *
 * A window nothing reads now — a model's week or the usage credits, which the quota poll alone of
 * the live sources reads, with the poll off and no reading of the poll in its current span — says
 * that only the poll reads it and that the poll is off, with the way to the switch, and draws no
 * bar, no readings and no forecast from readings that are history; with the poll on, or for a kind
 * another source reads, it is a window as any other.
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import QuotaWindow from '@/pages/analytics/components/QuotaWindow.vue'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import { uncollected } from '@/pages/analytics/utils/quotaFigures.ts'

import type { Quota, QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import StepLine from '@/shared/ui/StepLine.vue'
import StepLineTable from '@/shared/ui/StepLineTable.vue'
import WindowBar from '@/shared/ui/WindowBar.vue'

import { serveUsage } from '../fixtures/analytics.ts'
import { POLL_ON, quotaAnswer, quotaAt } from '../fixtures/quota.ts'
import { analyticsI18n, mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { accountNamed, showTable } from '../support/quotaPanel.ts'

const HOUR = 3_600_000
/** The panel's moment, written at Moscow's offset as the read writes it. */
const TODAY = '2026-11-11T10:00:00.000+03:00'
const NOW = Date.parse(TODAY)
const POLL_OFF: Quota['poll'] = {
  on: false,
  only: ['extra_usage', 'week_model'],
}

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

describe('a window nothing reads now', () => {
  it('is a kind only the poll reads, the poll off, with no reading of the poll in its span', () => {
    const model = window('week_model', {
      used: 9,
      left: -HOUR,
      source: 'import',
    })
    expect(uncollected(model, POLL_OFF, NOW)).toBe(true)
    // Standing on an imported reading alone: nothing reads it now either.
    expect(
      uncollected(window('week_model', { used: 9, left: HOUR, source: 'import' }), POLL_OFF, NOW),
    ).toBe(true)
    // The controls: the poll on; a reading of the poll in the standing span; a kind the mod reads.
    expect(uncollected(model, POLL_ON, NOW)).toBe(false)
    expect(
      uncollected(window('week_model', { used: 9, left: HOUR, source: 'poll' }), POLL_OFF, NOW),
    ).toBe(false)
    expect(uncollected(window('week', { used: 9, left: -HOUR }), POLL_OFF, NOW)).toBe(false)
    const credits = {
      kind: 'extra_usage',
      model: null,
      state: 'silent',
      resets_at: null,
      latest: { at: at(NOW - 72 * HOUR), source: 'import' },
    } as const
    expect(uncollected(credits, POLL_OFF, NOW)).toBe(true)
    expect(uncollected(credits, POLL_ON, NOW)).toBe(false)
  })

  const ACCOUNT: QuotaAccount = {
    account: 'org-a/acc-a',
    organization: 'org-a',
    account_uuid: 'acc-a',
    weekly_reset: null,
    shared: false,
    plan: null,
    name: 'Work',
    organization_name: null,
    no_source: false,
    windows: [],
  }

  const card = (poll: Quota['poll'], shown: 'chart' | 'table' = 'chart') =>
    mount(QuotaWindow, {
      props: {
        account: ACCOUNT,
        window: window('week_model', {
          used: 9,
          left: -HOUR,
          source: 'import',
        }),
        poll,
        now: NOW,
        today: TODAY,
        freshFor: 900,
        shown,
      },
      global: { plugins: [analyticsI18n('en')] },
    })

  it.each(['chart', 'table'] as const)(
    'says only the poll reads it, the poll off, with the way to the switch, as a %s',
    (shown) => {
      const off = card(POLL_OFF, shown)
      expect(off.get('[data-window]').attributes('data-state')).toBe('uncollected')
      expect(off.findAll('[data-lead]').map((one) => one.attributes('data-lead'))).toEqual([
        'uncollected',
      ])
      expect(off.get('[data-lead="uncollected"]').text()).toBe(
        'Only the quota poll reads this window, and the poll is off',
      )
      const way = off.get('a[data-settings]')
      expect(way.text()).toBe('Quota settings')
      expect(way.attributes('href')).toMatch(/^\/modules\/settings\/global\b/u)
      // No share, no bar, no readings and no forecast drawn from its history.
      expect(off.find('[role="meter"]').exists()).toBe(false)
      expect(off.find('[data-fact]').exists()).toBe(false)
      expect(off.findComponent(StepLine).exists()).toBe(false)
      expect(off.findComponent(StepLineTable).exists()).toBe(false)
      expect(off.findComponent(WindowBar).exists()).toBe(false)
    },
  )

  it('is a window as any other with the poll on: its reset and its ended share', () => {
    const on = card(POLL_ON)
    expect(on.find('a[data-settings]').exists()).toBe(false)
    expect(on.findComponent(StepLine).exists()).toBe(true)
    expect(on.findComponent(WindowBar).exists()).toBe(true)
    expect(on.findAll('[data-lead]').map((one) => one.attributes('data-lead'))).toEqual([
      'ended',
      'before',
    ])
    expect(plain(on.get('[data-lead="before"]').text())).toBe('9% by the reset')
  })
})

/** A reading as an import of history gives it. */
const imported = <T extends { source: string }>(reading: T) => ({ ...reading, source: 'import' })

/** A window of «Work» last read by an import: a model's week whole, the credits' latest. */
function readByImport(one: QuotaAccount['windows'][number]) {
  if (one.kind === 'week_model')
    return {
      ...one,
      latest: imported(one.latest),
      readings: one.readings.map((reading) => imported(reading)),
    }
  if (one.kind === 'extra_usage') return { ...one, latest: imported(one.latest) }
  return one
}

const pageUsage = (query: URLSearchParams) => serveUsage([], query)

describe('an account whose model week and credits nothing reads now', () => {
  /** The panel's moment for the page, as the page's fixtures write it at the local offset. */
  const PAGE = new Date(2026, 10, 11, 14, 30)
  const ONLY_POLL = /: only the quota poll reads it, and the poll is off/u

  /** `quotaAt` with the poll as `poll` says, «Work»'s model week and credits last read by an import. */
  function answer(poll: Quota['poll']) {
    const quota = quotaAt(PAGE)
    const accounts = quota.accounts.map((account) =>
      account.name === 'Work'
        ? { ...account, windows: account.windows.map((one) => readByImport(one)) }
        : account,
    )
    return quotaAnswer({ ...quota, poll, accounts } as Quota)
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: PAGE })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('says so in the model week’s card and row and on the credits’ line, the week read as before', async () => {
    stubAnalyticsReads(pageUsage, () => answer(POLL_OFF))
    const page = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const work = accountNamed(page, 'Work')
    const model = work.getComponent('.quota-window[data-window="week_model"]')
    expect(model.attributes('data-state')).toBe('uncollected')
    expect(model.find('a[data-settings]').exists()).toBe(true)
    expect(model.findComponent(WindowBar).exists()).toBe(false)
    // The control: the week, which the mod and the status line read too, keeps its bar.
    const week = work.getComponent('.quota-window[data-window="week"]')
    expect(week.attributes('data-state')).not.toBe('uncollected')
    expect(week.findComponent(WindowBar).exists()).toBe(true)
    const credits = work.get('.quota-account-others li')
    expect(plain(credits.text())).toMatch(ONLY_POLL)
    expect(credits.get('a[data-settings]').text()).toBe('Quota settings')

    await showTable(page)
    const table = accountNamed(page, 'Work')
    const cells = table
      .findAll('.quota-account-table tbody tr')
      .map((row) => row.findAll('td').map((one) => plain(one.text())))
    const [unread, ...rest] = cells.filter(([value]) => value?.startsWith('Only the quota poll'))
    expect(rest).toEqual([])
    expect(unread?.[0]).toBe('Only the quota poll reads this window, and the poll is off')
    expect([unread?.[1], unread?.[3]]).toEqual(['—', '—'])
    // The week's row keeps its share.
    expect(cells.some(([value = '']) => /^\d+(\.\d+)?%$/u.test(value))).toBe(true)
    expect(plain(table.get('.quota-account-others li').text())).toMatch(ONLY_POLL)
  })

  it('reads them as every other window with the poll on', async () => {
    stubAnalyticsReads(pageUsage, () => answer(POLL_ON))
    const page = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const work = accountNamed(page, 'Work')
    const model = work.getComponent('.quota-window[data-window="week_model"]')
    expect(model.attributes('data-state')).not.toBe('uncollected')
    expect(model.findComponent(WindowBar).exists()).toBe(true)
    expect(work.find('[data-settings]').exists()).toBe(false)
    expect(plain(work.get('.quota-account-others li').text())).not.toMatch(ONLY_POLL)
  })
})
