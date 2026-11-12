<script setup lang="ts">
/**
 * The owner's names for the accounts agent work was billed to: a row per account the past year
 * saw, the most agent time first and with its share of it, then any account already named that
 * the year did not see, so that name can still be taken away. A row is the account's whole id,
 * a field for its name and a way to clear it; the Analytics page says the name wherever it would
 * have said the start of the id, and the id in the hint.
 *
 * The usage rows hold no name for an account, only its organization id, and nothing on this
 * machine names most of them: the name is the owner's, kept with the other settings on this
 * device (`accountAliases.ts`). It is written as it is typed, with its spaces collapsed; the field
 * keeps what was typed until it is left, so a space between two words can be typed. Clearing
 * leaves the field in focus, as a colour's reset does.
 */
import { storeToRefs } from 'pinia'
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'
import { useSeenAccounts } from '@/pages/settings/composables/useSeenAccounts.ts'

import { aliasOf, MAX_ACCOUNT_ALIAS_LENGTH, withAlias } from '@/shared/lib/accountAliases.ts'
import { useSettingsStore } from '@/shared/stores/settingsStore.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

/** How much of an id Analytics names an unnamed account by, as an item's card does. */
const ID_START = 8

const { t, locale } = useI18n()
const { settings } = storeToRefs(useSettingsStore())
const { accounts, read, state } = useSeenAccounts()
const id = useId()

/** What is being typed in a field, until the field is left. */
const drafts = ref<Record<string, string>>({})

const fieldId = (account: string) => `${id}-${account}`

function shareWords(share: number) {
  const digits = share > 0 && share < 0.01 ? 1 : 0
  const said = new Intl.NumberFormat(locale.value, {
    style: 'percent',
    maximumFractionDigits: digits,
  }).format(share)
  return t('settings.accountAliases.share', { share: said })
}

const rows = computed(() => {
  const aliases = settings.value.accountAliases
  const listed = accounts.value.map((account) => ({
    id: account.id,
    hint: shareWords(account.share),
  }))
  const seenIds = new Set(listed.map((row) => row.id))
  const unseen = Object.keys(aliases)
    .filter((account) => !seenIds.has(account))
    .sort()
    .map((account) => ({ id: account, hint: t('settings.accountAliases.unseen') }))
  return [...listed, ...unseen].map((row) => {
    const alias = aliasOf(aliases, row.id)
    return {
      ...row,
      unnamed: alias === null,
      text: drafts.value[row.id] ?? alias ?? '',
      fieldId: fieldId(row.id),
      fieldLabel: t('settings.accountAliases.field', { id: row.id }),
      clearLabel: t('settings.accountAliases.clearName', { id: row.id }),
      placeholder: t('settings.accountAliases.placeholder', { short: row.id.slice(0, ID_START) }),
    }
  })
})

function type(account: string, value: string) {
  drafts.value = { ...drafts.value, [account]: value }
  settings.value.accountAliases = withAlias(settings.value.accountAliases, account, value)
}

function leave(account: string) {
  drafts.value = Object.fromEntries(
    Object.entries(drafts.value).filter(([typed]) => typed !== account),
  )
}

function clear(account: string) {
  leave(account)
  settings.value.accountAliases = withAlias(settings.value.accountAliases, account, '')
  document.querySelector<HTMLElement>(`#${CSS.escape(fieldId(account))}`)?.focus()
}

const status = computed(() => {
  if (state.value === 'loading') return t('settings.accountAliases.loading')
  if (state.value === 'failed') return t('settings.accountAliases.failed')
  return rows.value.length ? '' : t('settings.accountAliases.none')
})
</script>

<template>
  <SettingsGroup :title="t('settings.accountAliases.title')">
    <SettingsRow
      v-for="row in rows"
      :key="row.id"
      :label="row.id"
      :hint="row.hint"
    >
      <template #label>
        <span class="account-id">{{ row.id }}</span>
      </template>
      <div class="account-field">
        <VTextInput
          v-tooltip.detail="t('settings.accountAliases.kept')"
          class="account-input"
          autocomplete="off"
          :control-id="row.fieldId"
          :model-value="row.text"
          :label="row.fieldLabel"
          :maxlength="MAX_ACCOUNT_ALIAS_LENGTH"
          :placeholder="row.placeholder"
          hide-label
          @focusout="leave(row.id)"
          @update:model-value="type(row.id, $event)"
        />
        <VButton
          variant="ghost"
          size="compact"
          :disabled="row.unnamed"
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
        v-if="state === 'failed'"
        size="compact"
        @click="read"
      >
        {{ t('platform.actions.retry') }}
      </VButton>
    </div>
  </SettingsGroup>
</template>

<style scoped>
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
