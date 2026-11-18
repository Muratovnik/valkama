<script setup lang="ts">
/**
 * The owner's names for the organizations agent work was billed to and their accounts: a row per
 * organization the past year's work or the quota saw, the most agent time first and with its share
 * of it, and under it a row per account of it, the most first; then any
 * organization or account already named that neither saw, so that name can still be taken away
 * (`seenAccountRows.ts`). Each row says which it is (`data-account-row`: `organization` or
 * `account`). An organization's row is its whole id; an account's is its UUID, or when
 * its week resets for one known by its weekly reset alone, with that two accounts' readings may run
 * under it where they may. Each row has a field for its name and a way to clear it; the field's
 * placeholder says what Analytics shows without one (`accountLabel.ts`), and the Analytics page and
 * the quota alerts say the name wherever they would have said that, with no hint of the id.
 *
 * Nothing on this machine names most accounts: the name is the owner's, kept in Valkama by the
 * account's id or the organization's (`accountNamesStore.ts`), so every device says the same one.
 * The field keeps what is typed until it is left or Enter is pressed, so a space between two words
 * can be typed; then the name is saved, with its spaces collapsed. Saving, a saved name, a save
 * that failed and a cleared name each say so on the group's status line, as its reads do, with a
 * way to try a failed save again; the field keeps what was typed until the save holds. Clearing
 * leaves the field in focus, as a colour's reset does.
 */
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'
import { useSeenAccounts } from '@/pages/settings/composables/useSeenAccounts.ts'
import { seenAccountRows } from '@/pages/settings/utils/seenAccountRows.ts'
import type { AccountRow } from '@/pages/settings/utils/seenAccountRows.ts'

import { accountNamesFailure } from '@/shared/api/quotaApi.ts'
import { aliasOf, cleanAlias, MAX_ACCOUNT_ALIAS_LENGTH } from '@/shared/lib/accountAliases.ts'
import type { AccountAliases } from '@/shared/lib/accountAliases.ts'
import { accountLabel, idStart, resetWords } from '@/shared/lib/accountLabel.ts'
import { useAccountNamesStore } from '@/shared/stores/accountNamesStore.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

type Outcome = 'cleared' | 'failed' | 'saved' | 'saving'

const { t, locale } = useI18n()
const namesStore = useAccountNamesStore()
const { names, known, state: namesState } = storeToRefs(namesStore)
const { organizations, read, state } = useSeenAccounts()
const id = useId()

/** What is being typed in a field, until its save holds. */
const drafts = ref<Record<string, string>>({})
/** What the latest write came to, for the group's status line. */
const outcome = ref<{ key: string; kind: Outcome; reason?: string } | null>(null)
/** The latest write, so an earlier one's answer does not speak over it. */
let latest = 0

const fieldId = (key: string) => `${id}-${key}`

function shareWords(share: number | null) {
  if (share === null) return t('settings.accountAliases.unseen')
  const digits = share > 0 && share < 0.01 ? 1 : 0
  const said = new Intl.NumberFormat(locale.value, {
    style: 'percent',
    maximumFractionDigits: digits,
  }).format(share)
  return t('settings.accountAliases.share', { share: said })
}

/** What Analytics calls an account by the names given (`accountLabel.ts`). */
const labelOf = (row: Extract<AccountRow, { kind: 'account' }>, given: AccountAliases) =>
  accountLabel(given, row, {
    locale: locale.value,
    unplaced: (organization) => t('analytics.values.seat.unplaced', { organization }),
    weekly: (organization, reset) => t('analytics.values.seat.weekly', { organization, reset }),
  })

/** A row's words: what it is, its fields' names, and what the status line calls it. */
function wordsOf(row: AccountRow) {
  if (row.kind === 'organization')
    return {
      label: row.id,
      isId: true,
      underOrganization: false,
      hint: shareWords(row.share),
      fieldLabel: t('settings.accountAliases.organization.field', { id: row.id }),
      clearLabel: t('settings.accountAliases.organization.clearName', { id: row.id }),
      shown: idStart(row.id),
      short: idStart(row.id),
      status: 'settings.accountAliases.organization.',
    }
  const others = Object.fromEntries(Object.entries(names.value).filter(([key]) => key !== row.id))
  const hint = shareWords(row.share)
  return {
    label:
      row.uuid ??
      t('settings.accountAliases.weekly', {
        reset: resetWords(row.weeklyReset ?? '', locale.value),
      }),
    isId: row.uuid !== null,
    underOrganization: true,
    hint: row.shared ? `${hint} · ${t('settings.accountAliases.shared')}` : hint,
    fieldLabel: t('settings.accountAliases.field', { id: row.id }),
    clearLabel: t('settings.accountAliases.clearName', { id: row.id }),
    // What Analytics says while the field is empty: the rule without the account's own name.
    shown: labelOf(row, others),
    short: labelOf(row, {}),
    status: 'settings.accountAliases.',
  }
}

const rows = computed(() => {
  // Until Valkama's names are known a field could not say whether an account has one.
  if (!known.value || state.value !== 'ready') return []
  return seenAccountRows(organizations.value, Object.keys(names.value)).map((row) => {
    const words = wordsOf(row)
    const alias = aliasOf(names.value, row.id)
    const draft = drafts.value[row.id]
    return {
      ...row,
      ...words,
      clearable: alias !== null || Boolean(draft),
      text: draft ?? alias ?? '',
      fieldId: fieldId(row.id),
      placeholder: t('settings.accountAliases.placeholder', { short: words.shown }),
    }
  })
})

function type(key: string, value: string) {
  drafts.value = { ...drafts.value, [key]: value }
}

/** The field shows the kept name again, unless more was typed meanwhile. */
function forget(key: string, typed: string) {
  if (drafts.value[key] !== typed) return
  drafts.value = Object.fromEntries(Object.entries(drafts.value).filter(([named]) => named !== key))
}

/** Save what the field holds, where it differs from the name Valkama keeps. */
async function commit(key: string) {
  const typed = drafts.value[key]
  if (typed === undefined) return
  const said = cleanAlias(typed)
  if (said === (aliasOf(names.value, key) ?? '')) {
    forget(key, typed)
    return
  }
  const write = ++latest
  outcome.value = { key, kind: 'saving' }
  try {
    await namesStore.save(key, said)
    forget(key, typed)
    if (write === latest) outcome.value = { key, kind: said ? 'saved' : 'cleared' }
  } catch (error) {
    if (write === latest)
      outcome.value = { key, kind: 'failed', reason: accountNamesFailure(error, t) }
  }
}

function press(key: string, event: KeyboardEvent) {
  if (event.key === 'Enter') void commit(key)
}

function clear(key: string) {
  drafts.value = { ...drafts.value, [key]: '' }
  void commit(key)
  document.querySelector<HTMLElement>(`#${CSS.escape(fieldId(key))}`)?.focus()
}

const retryable = computed(
  () =>
    state.value === 'failed' || namesState.value === 'failed' || outcome.value?.kind === 'failed',
)

function retry() {
  if (state.value === 'failed') void read()
  if (namesState.value === 'failed') void namesStore.read()
  if (outcome.value?.kind === 'failed') void commit(outcome.value.key)
}

const status = computed(() => {
  if (state.value === 'failed') return t('settings.accountAliases.failed')
  if (namesState.value === 'failed') return t('settings.accountAliases.namesFailed')
  if (state.value === 'loading' || !known.value) return t('settings.accountAliases.loading')
  const said = outcome.value
  const row = said && rows.value.find((one) => one.id === said.key)
  if (said && row)
    return t(`${row.status}${said.kind === 'failed' ? 'saveFailed' : said.kind}`, {
      short: row.short,
      reason: said.reason ?? '',
    })
  return rows.value.length ? '' : t('settings.accountAliases.none')
})

onMounted(() => void namesStore.read())
</script>

<template>
  <SettingsGroup :title="t('settings.accountAliases.title')">
    <SettingsRow
      v-for="row in rows"
      :key="row.id"
      :class="{ 'account-row': row.underOrganization }"
      :data-account-row="row.kind"
      :label="row.label"
      :hint="row.hint"
    >
      <template #label>
        <span :class="{ 'account-id': row.isId }">{{ row.label }}</span>
      </template>
      <div class="account-field">
        <VTextInput
          v-tooltip.detail="t('settings.accountAliases.kept')"
          class="account-input"
          autocomplete="off"
          size="compact"
          :control-id="row.fieldId"
          :model-value="row.text"
          :label="row.fieldLabel"
          :maxlength="MAX_ACCOUNT_ALIAS_LENGTH"
          :placeholder="row.placeholder"
          hide-label
          @focusout="commit(row.id)"
          @keydown="press(row.id, $event)"
          @update:model-value="type(row.id, $event)"
        />
        <VButton
          variant="ghost"
          size="compact"
          :disabled="!row.clearable"
          :aria-label="row.clearLabel"
          @click="clear(row.id)"
        >
          {{ t('settings.accountAliases.clear') }}
        </VButton>
      </div>
    </SettingsRow>
    <div
      v-if="status"
      class="accounts-status"
    >
      <span role="status">{{ status }}</span>
      <VButton
        v-if="retryable"
        size="compact"
        @click="retry"
      >
        {{ t('platform.actions.retry') }}
      </VButton>
    </div>
  </SettingsGroup>
</template>

<style scoped>
/* An account stands under its organization, set in as a list's item is. */
.account-row {
  padding-inline-start: var(--space-8);
}

.account-id {
  font-family: var(--font-family-mono);
  overflow-wrap: anywhere;
}

.account-field {
  display: flex;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  min-width: 0;
}

.account-input {
  flex: 1;
  min-width: 0;
}

.accounts-status {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  padding: var(--space-3) var(--space-4);
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
