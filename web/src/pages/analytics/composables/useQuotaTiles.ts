/**
 * What the quota's two tiles on the rail say: for its five hours and for its week, the tightest
 * window across accounts (`tightest`), by its account's name, with its share and, beside the
 * section's name, its state in words, over a thin bar of that one window with its pace tick.
 *
 * A tile says one account's one window and never a sum. Where it has no window to name it says
 * why in words of its own, so no source, a window that reset since it was read and a fresh 0 %
 * never read alike: an organization nobody's source read is «No source», a fresh 0 % is the
 * account with «0%» and «fresh», a silent window says «silent» and is hatched. Before its first
 * answer the tile waits as the others do (`RailTile`), and a read that failed says so.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { QuotaRead } from '@/pages/analytics/composables/useQuotaRead.ts'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import { reading, standing } from '@/pages/analytics/composables/useRailTiles.ts'
import type { RailTileModel } from '@/pages/analytics/composables/useRailTiles.ts'
import { sectionWindows, tightest } from '@/pages/analytics/utils/quotaFigures.ts'

import { QUOTA_SECTIONS } from '@/shared/api/analyticsAddress.ts'
import type { QuotaSection } from '@/shared/api/analyticsAddress.ts'
import type { Quota } from '@/shared/api/analyticsApi.ts'

export function useQuotaTiles(options: {
  /** The moment the tiles stand at, in ms: a window whose reset has passed stands no more. */
  now: () => number
  read: () => QuotaRead
}) {
  const { t } = useI18n()
  const words = useQuotaWords()

  /** Why a section has no window to name: no account, no source, a reset since, no reading. */
  function nothing(quota: Quota, section: QuotaSection): RailTileModel {
    if (!quota.accounts.length) return standing('empty', t('analytics.quota.tile.noAccount'))
    const windows = quota.accounts.flatMap((account) => sectionWindows(account, section))
    if (windows.length) return standing('empty', t('analytics.quota.tile.reset'))
    if (quota.accounts.some((account) => account.no_source))
      return standing('empty', t('analytics.quota.tile.noSource'))
    return standing('empty', t('analytics.quota.tile.noWindow'))
  }

  function tile(section: QuotaSection): RailTileModel {
    const read = options.read()
    if (read.status === 'loading') return reading()
    if (read.status === 'failed') return standing('failed', t('analytics.rail.failed'))
    const { quota } = read
    const found = tightest(quota, section, options.now())
    if (!found) return { ...nothing(quota, section), busy: read.refreshing }
    const { account, window } = found
    const name = words.accountName(account)
    return {
      ...standing('ready', window.kind === 'week_model' ? `${name}, ${window.model}` : name),
      quiet: false,
      leadDetail: t('analytics.quota.tile.detail', {
        window: words.windowName(window),
        account: `${name} — ${words.accountDetail(account)}`,
      }),
      aside: words.share(window.latest.used_percent),
      count: words.state(window),
      busy: read.refreshing,
      meter: {
        label: words.barLabel(window),
        used: window.latest.used_percent,
        even: window.even_percent,
        held: window.state !== 'fresh',
      },
    }
  }

  const tiles = computed(() =>
    Object.fromEntries(QUOTA_SECTIONS.map((section) => [section, tile(section)])),
  )

  return { tiles }
}
