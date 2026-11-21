<script setup lang="ts">
/**
 * One account of the quota panel: its name — the owner's, or else the start of its id — with the
 * menu of what can be done with the account beside it (`useAccountActions`: rename it in a field
 * that takes the name's place, add it to the page's filter, copy its whole id, which no hint
 * says), a copy's note after the menu, its plan, and each window of the section on show
 * (`QuotaWindow`), the week
 * before each model's week. As a table its windows are one table of their figures — the share,
 * the pace, the state with how long a silent one has been silent, and the forecast; past the reset
 * the share's cell says that it reset, the share before it under that — each window's facts and
 * readings after it.
 *
 * An account nobody's source read says so and shows no window, and one with no window of the
 * section says that instead, so no source, a window never read and a fresh 0 % never read alike.
 * A seat known only for its week says so. A window of money past a limit has no share: it is a
 * line of its name and its state, its age and its source in the line's hint as a window of a
 * share keeps them in its bar's, all of it in words as a table, and never a figure beside a share.
 * One nothing reads now (`uncollected`), the usage credits where only the quota poll reads them
 * and the poll is off, says that on its line instead of a state, with the way to the switch; a
 * window of a share says it in its card and in the table's row.
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
 * menu, `name-it` for «Name» and `facts` for what stands beside it.
 *
 * An account with no name of its own — the start of an id, a time its week resets — is no account
 * a person recognizes, so beside its menu stands «Name», which opens the field, and its menu has
 * no «Rename»; once the account has a name the button is gone and «Rename» is in the menu. One
 * naming action stands for each state: both at once said the same thing twice. The menu and
 * «Name» are one unit of the heading row, on one centre line at every width: beside the name while
 * both fit there, and on the next line together where they do not, the name keeping its own.
 */
import { computed, useId, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import QuotaWindow from '@/pages/analytics/components/QuotaWindow.vue'
import { useAccountActions } from '@/pages/analytics/composables/useAccountActions.ts'
import { useQuotaWords } from '@/pages/analytics/composables/useQuotaWords.ts'
import {
  pollSettingsHref,
  sectionWindows,
  spendWindows,
  uncollected,
  windowKey,
} from '@/pages/analytics/utils/quotaFigures.ts'
import { lineKey } from '@/pages/analytics/utils/quotaLine.ts'
import type { QuotaLine } from '@/pages/analytics/utils/quotaLine.ts'

import IdentityNote from '@/entities/work-item/components/IdentityNote.vue'

import type { QuotaSection } from '@/shared/api/analyticsAddress.ts'
import type { Quota, QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'
import { MAX_ACCOUNT_ALIAS_LENGTH } from '@/shared/lib/accountAliases.ts'
import ScreenLink from '@/shared/ui/ScreenLink.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
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
  /** Whether the quota poll is on, and the kinds it alone reads: the answer's `poll`. */
  poll: Quota['poll']
  section: QuotaSection
  shown: 'chart' | 'table'
  /** The answer's moment at its offset: each time is said at it, and undated on its day. */
  today: string
  /** The line of each window of the section, by `lineKey` (`sectionLines`). */
  lines?: ReadonlyMap<string, QuotaLine>
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
const { draft, entries, failure, note, noteFailed, unnamed } = actions
/** Whether the field stands in the name's place, the name kept unseen for the outline. */
const renaming = computed(() => draft.value !== null)
const menuLabel = computed(() => t('analytics.quota.actions.menu', { account: name.value }))
const nameItLabel = computed(() =>
  t('analytics.quota.actions.nameItLabel', { account: name.value }),
)
const windows = computed(() => sectionWindows(props.account, props.section))
/**
 * The windows of money, as the windows of a share say themselves: its name and state on the line
 * and how old its reading is and who read it in its hint, all of it in words in a table.
 */
const others = computed(() =>
  spendWindows(props.account).map((window) => {
    const unread = uncollected(window, props.poll, props.now)
    const said = words.uncollectedWords(window)
    return {
      key: windowKey(window),
      text: unread ? said.line : words.other(window, props.now, props.freshFor),
      state: unread ? said.line : words.otherState(window, props.now, props.freshFor),
      read: words.latest(window, props.now, props.today, props.freshFor),
      settings: unread ? said.settings : null,
    }
  }),
)
/** Where the owner switches the poll on, for a window of money nothing reads now. */
const settingsHref = pollSettingsHref()

/**
 * The windows as the table's rows. A window past its reset with no reading since says so where
 * its share stood, the share before the reset under it, as its chart leads (`ended`): its share
 * alone read as the share spent now. It has no pace and no forecast left, a dash each.
 */
const rows = computed<WindowRow[]>(() =>
  windows.value.map((window) => {
    if (uncollected(window, props.poll, props.now))
      return {
        key: windowKey(window),
        label: words.windowName(window),
        valueText: words.uncollectedWords(window).lead,
        evenText: '—',
        noteText: '—',
        forecastText: '—',
      }
    const ended = words.ended(window, props.now, props.today)
    return {
      key: windowKey(window),
      label: words.windowName(window),
      valueText: ended?.lead ?? words.share(window.latest.used_percent),
      valueDetail: ended?.before,
      evenText: ended || window.even_percent === null ? '—' : words.share(window.even_percent),
      noteText: words.stateWords(window, props.now, props.freshFor),
      forecastText: ended ? '—' : words.forecast(window, props.today),
    }
  }),
)
const tableWords = computed<WindowWords>(() => ({
  name: t('analytics.quota.table.name'),
  value: t('analytics.quota.table.value'),
  even: t('analytics.quota.table.even'),
  note: t('analytics.quota.table.note'),
  forecast: t('analytics.quota.table.forecast'),
  empty: t('analytics.quota.table.empty'),
}))

/** What a window's step line draws, as the section decided it (`sectionLines`). */
const lineOf = (window: QuotaShareWindow) => props.lines?.get(lineKey(props.account, window))
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
      <span class="quota-account-controls">
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
        <VButton
          v-if="unnamed && !renaming"
          size="compact"
          data-account-head="name-it"
          :aria-label="nameItLabel"
          @click="actions.rename"
        >
          {{ t('analytics.quota.actions.nameIt') }}
        </VButton>
      </span>
      <p
        v-if="account.plan || account.shared"
        class="quota-account-facts"
        data-account-head="facts"
      >
        <span v-if="account.plan">{{
          t('analytics.quota.panel.plan', { plan: account.plan })
        }}</span>
        <span v-if="account.shared">{{ t('analytics.quota.panel.shared') }}</span>
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
        :poll="poll"
        :fresh-for="freshFor"
        :shown="shown"
        :line="lineOf(window)"
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
        <ScreenLink
          v-if="other.settings"
          class="quota-account-settings"
          :href="settingsHref"
          data-settings
          >{{ other.settings }}</ScreenLink
        >
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

/* The account's controls, its menu and «Name», are one item of the heading row: on the name's line
   while both fit beside it, and on the next line together where they do not, centred on one line
   at the row's gap apart. As two items of the row, a phone's wrapped «Name» alone and left the menu
   at the name's end, 40px above it. */
.quota-account-controls {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-3);
  align-items: center;
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

/* The way to the poll's switch follows the words of the window nothing reads, a gap after them. */
.quota-account-settings {
  margin-inline-start: var(--space-2);
}
</style>
