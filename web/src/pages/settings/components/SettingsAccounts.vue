<script setup lang="ts">
/**
 * The owner's names for the accounts agent work was billed to: a row per account the past year
 * saw, the most agent time first and with its share of it, then any account already named that
 * the year did not see, so that name can still be taken away. A row is the account's whole id,
 * a field for its name and a way to clear it; the Analytics page and the quota alerts say the
 * name wherever they would have said the start of the id, and the id in the hint.
 *
 * The usage rows hold no name for an account, only its organization id, and nothing on this
 * machine names most of them: the name is the owner's, kept in Valkama by that id
 * (`accountNamesStore.ts`), so every device says the same one. The field keeps what is typed
 * until it is left or Enter is pressed, so a space between two words can be typed; then the
 * name is saved, with its spaces collapsed. Saving, a saved name, a save that failed and a
 * cleared name each say so on the group's status line, as its reads do, with a way to try a
 * failed save again; the field keeps what was typed until the save holds. Clearing leaves the
 * field in focus, as a colour's reset does.
 */
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import SettingsGroup from '@/pages/settings/components/SettingsGroup.vue'
import SettingsRow from '@/pages/settings/components/SettingsRow.vue'
import { useSeenAccounts } from '@/pages/settings/composables/useSeenAccounts.ts'

import { accountNamesRefusal } from '@/shared/api/quotaApi.ts'
import { failureMessage, typedFailure } from '@/shared/api/typedFailure.ts'
import { aliasOf, cleanAlias, MAX_ACCOUNT_ALIAS_LENGTH } from '@/shared/lib/accountAliases.ts'
import { useAccountNamesStore } from '@/shared/stores/accountNamesStore.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

/** How much of an id Analytics names an unnamed account by, as an item's card does. */
const ID_START = 8

type Outcome = 'cleared' | 'failed' | 'saved' | 'saving'

const { t, locale } = useI18n()
const namesStore = useAccountNamesStore()
const { names, known, state: namesState } = storeToRefs(namesStore)
const { accounts, read, state } = useSeenAccounts()
const id = useId()

/** What is being typed in a field, until its save holds. */
const drafts = ref<Record<string, string>>({})
/** What the latest write came to, for the group's status line. */
const outcome = ref<{ account: string; kind: Outcome; reason?: string } | null>(null)
/** The latest write, so an earlier one's answer does not speak over it. */
let latest = 0

const fieldId = (account: string) => `${id}-${account}`
const short = (account: string) => account.slice(0, ID_START)

function shareWords(share: number) {
  const digits = share > 0 && share < 0.01 ? 1 : 0
  const said = new Intl.NumberFormat(locale.value, {
    style: 'percent',
    maximumFractionDigits: digits,
  }).format(share)
  return t('settings.accountAliases.share', { share: said })
}

const rows = computed(() => {
  // Until Valkama's names are known a field could not say whether an account has one.
  if (!known.value || state.value !== 'ready') return []
  const listed = accounts.value.map((account) => ({
    id: account.id,
    hint: shareWords(account.share),
  }))
  const seenIds = new Set(listed.map((row) => row.id))
  const unseen = Object.keys(names.value)
    .filter((account) => !seenIds.has(account))
    .sort()
    .map((account) => ({ id: account, hint: t('settings.accountAliases.unseen') }))
  return [...listed, ...unseen].map((row) => {
    const alias = aliasOf(names.value, row.id)
    const draft = drafts.value[row.id]
    return {
      ...row,
      clearable: alias !== null || Boolean(draft),
      text: draft ?? alias ?? '',
      fieldId: fieldId(row.id),
      fieldLabel: t('settings.accountAliases.field', { id: row.id }),
      clearLabel: t('settings.accountAliases.clearName', { id: row.id }),
      placeholder: t('settings.accountAliases.placeholder', { short: short(row.id) }),
    }
  })
})

function type(account: string, value: string) {
  drafts.value = { ...drafts.value, [account]: value }
}

/** The field shows the kept name again, unless more was typed meanwhile. */
function forget(account: string, typed: string) {
  if (drafts.value[account] !== typed) return
  drafts.value = Object.fromEntries(
    Object.entries(drafts.value).filter(([named]) => named !== account),
  )
}

function failureText(error: unknown) {
  const refusal = accountNamesRefusal(error)
  if (refusal !== null) return refusal
  const message = failureMessage(typedFailure(error))
  return t(message.key, message.params ?? {})
}

/** Save what the field holds, where it differs from the name Valkama keeps. */
async function commit(account: string) {
  const typed = drafts.value[account]
  if (typed === undefined) return
  const said = cleanAlias(typed)
  if (said === (aliasOf(names.value, account) ?? '')) {
    forget(account, typed)
    return
  }
  const write = ++latest
  outcome.value = { account, kind: 'saving' }
  try {
    await namesStore.save(account, said)
    forget(account, typed)
    if (write === latest) outcome.value = { account, kind: said ? 'saved' : 'cleared' }
  } catch (error) {
    if (write === latest) outcome.value = { account, kind: 'failed', reason: failureText(error) }
  }
}

function press(account: string, event: KeyboardEvent) {
  if (event.key === 'Enter') void commit(account)
}

function clear(account: string) {
  drafts.value = { ...drafts.value, [account]: '' }
  void commit(account)
  document.querySelector<HTMLElement>(`#${CSS.escape(fieldId(account))}`)?.focus()
}

const retryable = computed(
  () =>
    state.value === 'failed' || namesState.value === 'failed' || outcome.value?.kind === 'failed',
)

function retry() {
  if (state.value === 'failed') void read()
  if (namesState.value === 'failed') void namesStore.read()
  if (outcome.value?.kind === 'failed') void commit(outcome.value.account)
}

const status = computed(() => {
  if (state.value === 'failed') return t('settings.accountAliases.failed')
  if (namesState.value === 'failed') return t('settings.accountAliases.namesFailed')
  if (state.value === 'loading' || !known.value) return t('settings.accountAliases.loading')
  const said = outcome.value
  if (said)
    return t(`settings.accountAliases.${said.kind === 'failed' ? 'saveFailed' : said.kind}`, {
      short: short(said.account),
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
