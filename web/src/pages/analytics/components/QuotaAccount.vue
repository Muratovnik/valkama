<script setup lang="ts">
/**
 * One account of the quota panel: its name — the owner's, or else the start of its id — with the
 * menu of what can be done with the account beside it (`useAccountActions`: rename it in a field
 * that takes the name's place, add it to the page's filter, copy its whole id, which no hint
 * says), a copy's note after the menu, its plan, and each window of the section on show
 * (`QuotaWindow`), the week
 * before each model's week. As a table its windows are one table of their figures — the share,
 * the pace, the state with how long a silent one has been silent, and the forecast, or past the
 * reset that it has reset — each window's facts and readings after it.
 *
 * An account nobody's source read says so and shows no window, and one with no window of the
 * section says that instead, so no source, a window never read and a fresh 0 % never read alike.
 * A seat known only for its week says so. A window of money past a limit has no share: it is a
 * line of its name and its state, its age and its source in the line's hint as a window of a
 * share keeps them in its bar's, all of it in words as a table, and never a figure beside a share.
 *
 * It is a group of the panel on a surface of its own, its windows side by side where the width
 * keeps each readable and one under the next where it does not (`PanelLevel`). Two windows side by
 * side stand 32px apart (`apart`) with a hairline of the rule's ink midway between them: 16px apart and with
 * nothing between, the moment ending one window's axis and the one starting the next stood a few
 * pixels apart and read as one axis.
 *
 * What a reader of the page selects it by: the account is `data-account`, its name; the parts of
 * its head are `data-account-head`, `name` for its name, `field` for the field that renames it,
 * which stands in the name's place while the name is kept for the outline unseen, `menu` for its
 * menu and `facts` for what stands beside it.
 */
import { computed, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import QuotaWindow from '@/pages/analytics/components/QuotaWindow.vue'
import { useAccountActions } from '@/pages/analytics/composables/useAccountActions.ts'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import {
  sectionWindows,
  spendWindows,
  stands,
  windowKey,
} from '@/pages/analytics/utils/quotaFigures.ts'

import IdentityNote from '@/entities/work-item/components/IdentityNote.vue'

import type { QuotaSection } from '@/shared/api/analyticsAddress.ts'
import type { QuotaAccount } from '@/shared/api/analyticsApi.ts'
import { MAX_ACCOUNT_ALIAS_LENGTH } from '@/shared/lib/accountAliases.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VMenu from '@/shared/ui/VMenu.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'
import WindowBarTable from '@/shared/ui/WindowBarTable.vue'
import type { WindowRow, WindowWords } from '@/shared/ui/windowGeometry.ts'

const props = defineProps<{
  account: QuotaAccount
  /**
   * How old a reading may be and still be fresh, in seconds: the answer's `fresh_for_seconds`,
   * against which each window's state is judged at `now` (`stateAt`).
   */
  freshFor: number
  /** The moment the panel stands at, in ms. */
  now: number
  section: QuotaSection
  shown: 'chart' | 'table'
  /** The answer's moment at its offset: each time is said at it, and undated on its day. */
  today: string
}>()

/** The account's name was saved, which the quota's answer says only once it is read again. */
const emit = defineEmits<{ renamed: [] }>()

const { t } = useI18n()
const words = useQuotaWords()

const name = computed(() => words.accountName(props.account))

const menuBox = useTemplateRef<HTMLElement>('menuBox')
const fieldId = `${useId()}-name`
const actions = useAccountActions({
  account: () => props.account,
  fieldId,
  focusMenu: () => menuBox.value?.querySelector<HTMLElement>('button')?.focus(),
  renamed: () => emit('renamed'),
})
const { draft, entries, failure, note, noteFailed } = actions
/** Whether the field stands in the name's place, the name kept unseen for the outline. */
const renaming = computed(() => draft.value !== null)
const menuLabel = computed(() => t('analytics.quota.actions.menu', { account: name.value }))
const windows = computed(() => sectionWindows(props.account, props.section))
/**
 * The windows of money, as the windows of a share say themselves: its name and state on the line
 * and how old its reading is and who read it in its hint, all of it in words in a table.
 */
const others = computed(() =>
  spendWindows(props.account).map((window) => ({
    key: windowKey(window),
    text: words.other(window, props.now, props.freshFor),
    state: words.otherState(window, props.now, props.freshFor),
    read: words.latest(window, props.now, props.today, props.freshFor),
  })),
)

const rows = computed<WindowRow[]>(() =>
  windows.value.map((window) => ({
    key: windowKey(window),
    label: words.windowName(window),
    valueText: words.share(window.latest.used_percent),
    evenText: window.even_percent === null ? '—' : words.share(window.even_percent),
    noteText: words.stateWords(window, props.now, props.freshFor),
    forecastText: stands(window, props.now)
      ? words.forecast(window, props.today)
      : words.reset(window, props.now, props.today),
  })),
)
const tableWords = computed<WindowWords>(() => ({
  name: t('analytics.quota.table.name'),
  value: t('analytics.quota.table.value'),
  even: t('analytics.quota.table.even'),
  note: t('analytics.quota.table.note'),
  forecast: t('analytics.quota.table.forecast'),
  empty: t('analytics.quota.table.empty'),
}))
</script>

<template>
  <PanelLevel
    class="quota-account"
    level="group"
    as="li"
    columns="fit"
    column-min="24rem"
    :data-account="name"
    apart
    surface
  >
    <template #heading>
      <span
        class="quota-account-name"
        data-account-head="name"
        :class="{ 'visually-hidden': renaming }"
        >{{ name }}</span
      >
    </template>
    <template #beside>
      <VTextInput
        v-if="draft !== null"
        class="quota-account-field"
        data-account-head="field"
        autocomplete="off"
        size="compact"
        :control-id="fieldId"
        :model-value="draft"
        :label="t('analytics.quota.actions.name')"
        :maxlength="MAX_ACCOUNT_ALIAS_LENGTH"
        :error="failure"
        hide-label
        @update:model-value="actions.type"
        @keydown="actions.press"
        @focusout="actions.save"
      />
      <span
        ref="menuBox"
        class="quota-account-menu"
        data-account-head="menu"
      >
        <VMenu
          size="compact"
          align="start"
          :label="menuLabel"
          :entries="entries"
        />
        <IdentityNote
          :failed="noteFailed"
          :text="note"
        />
      </span>
      <p
        v-if="account.plan || account.seat"
        class="quota-account-facts"
        data-account-head="facts"
      >
        <span v-if="account.plan">{{
          t('analytics.quota.panel.plan', { plan: account.plan })
        }}</span>
        <span v-if="account.seat">{{ t('analytics.quota.panel.provisional') }}</span>
      </p>
    </template>
    <p
      v-if="account.no_source"
      class="quota-account-none"
      data-state="no-source"
    >
      {{ t('analytics.quota.panel.noSource') }}
    </p>
    <p
      v-else-if="!windows.length"
      class="quota-account-none"
      data-state="no-window"
    >
      {{ t(`analytics.quota.panel.noWindow.${section}`) }}
    </p>
    <template v-else>
      <WindowBarTable
        v-if="shown === 'table'"
        class="quota-account-table"
        :label="t('analytics.quota.table.caption', { account: name })"
        :rows="rows"
        :words="tableWords"
      />
      <QuotaWindow
        v-for="window in windows"
        :key="windowKey(window)"
        class="quota-account-window"
        :account="account"
        :window="window"
        :today="today"
        :now="now"
        :fresh-for="freshFor"
        :shown="shown"
      />
    </template>
    <ul
      v-if="others.length"
      class="quota-account-others"
    >
      <li
        v-for="other in others"
        :key="other.key"
      >
        <span
          v-if="shown === 'chart'"
          v-tooltip.detail="other.read"
          >{{ other.state }}</span
        >
        <template v-else>{{ other.text }}</template>
      </li>
    </ul>
  </PanelLevel>
</template>

<style scoped>
/* The hairline between two windows side by side, midway in the gap before every window that does
   not start a row. Where a row starts follows from the grid: as many windows a row as keep 24rem
   with the gap between, which is 50rem for two and 76rem for three in the account's width. */
.quota-account-window {
  position: relative;

  &::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: calc(-1 * (var(--space-8) + var(--space-hair)) / 2);
    display: none;
    border-inline-start: var(--space-hair) solid var(--color-rule);
  }
}

@container (width >= 50rem) {
  .quota-account-window:nth-child(2n of .quota-account-window)::before {
    display: block;
  }
}

@container (width >= 76rem) {
  .quota-account-window:nth-child(2n of .quota-account-window)::before {
    display: none;
  }

  .quota-account-window:not(:nth-child(3n + 1 of .quota-account-window))::before {
    display: block;
  }
}

/* The menu at the name, with a copy's note after it on the name's line. */
.quota-account-menu {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
}

/* The field that renames the account, in the name's place, as wide as a name reads. The name
   stands unseen in the heading for the outline, which leaves the heading row's gap (`--space-3`)
   before the field: the field takes that gap back, so it starts where the name did. */
.quota-account-field {
  flex: 0 1 20rem;
  min-width: 0;
  margin-inline-start: calc(-1 * var(--space-3));
}

/* What is not a window takes the group's whole width, over or under its windows. */
.quota-account-none,
.quota-account-table,
.quota-account-others {
  grid-column: 1 / -1;
}

.quota-account-facts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.quota-account-none,
.quota-account-others {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.quota-account-others {
  display: grid;
  gap: var(--space-1);
  padding: 0;
  list-style: none;
}
</style>
